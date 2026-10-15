import * as P from '../source';
import { sourceId,sourceInfo,type SourceId } from '../sources';
import type { Detail,SearchResult,SourceResult } from '../types';
import * as gequhai from './gequhai';

export interface MusicSource {
  id: SourceId; name: string; origin: string;
  searchPath(query: string,cursor?: string): string;
  detailPath(id: string): string;
  parseSearch(doc: Document): SearchResult;
  parseDetail(html: string): Detail;
  resolveRequest(playId: string): {path: string; fields: Record<string,string>};
  parseResolved(data: Record<string,unknown>): string;
  captchaPath?: string;
}
function searchPath(id: SourceId,query: string,cursor=''){
  const q=P.clean(query);P.searchPath(q); // Shared length validation, not a shared endpoint.
  const {origin}=sourceInfo(id),path=id==='gequbao'?P.searchPath(q):'/search?s='+encodeURIComponent(q);
  if(!cursor)return path;
  let u: URL;try{u=new URL(cursor,origin);}catch{throw new P.SourceError('BAD_QUERY','搜索分页地址无效。');}
  const page=u.searchParams.get('page');
  if(u.origin!==origin||u.username||u.password||u.hash||!page||!/^\d{1,3}$/.test(page)||Number(page)<1||Number(page)>100||
    (id==='gequbao'?u.pathname!==P.searchPath(q):u.pathname!=='/search'||u.searchParams.get('s')!==q)||
    [...u.searchParams.keys()].some(key=>key!=='page'&&(id==='gequbao'||key!=='s')))throw new P.SourceError('BAD_QUERY','搜索分页地址无效。');
  return path+(id==='gequbao'?'?':'&')+'page='+Number(page);
}
const adapters: Record<SourceId,MusicSource>={
  gequbao:{...sourceInfo('gequbao'),searchPath:(q,c)=>searchPath('gequbao',q,c),detailPath:id=>'/music/'+P.songId(id),parseSearch:P.parseSearchDocument,parseDetail:html=>P.metadata(P.parseAppData(html)),
    resolveRequest:id=>({path:'/member/common-play-url',fields:{id,purpose:'play'}}),parseResolved:data=>P.resolvedURL(data as unknown as SourceResult),captchaPath:'/api/captcha'},
  gequhai:{...sourceInfo('gequhai'),searchPath:(q,c)=>searchPath('gequhai',q,c),detailPath:id=>'/play/'+P.songId(id),parseSearch:gequhai.parseSearch,parseDetail:gequhai.parseDetail,
    resolveRequest:id=>({path:'/api/music',fields:{id,type:'0'}}),parseResolved:gequhai.parseResolved}
};
export function musicSource(value: unknown): MusicSource {return adapters[sourceId(value)];}
