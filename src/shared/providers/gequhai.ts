import { clean, decodeLiteral, isChallenge, mediaURL, safeHttp, songId, SourceError } from '../source';
import type { Detail, SearchResult, Song } from '../types';

const ORIGIN='https://www.gequhai.com';
/** Read static string assignments as data; never execute the website's scripts. */
function stringField(html: string,name: string): string {
  const start=new RegExp('window\\.'+name+'\\s*=\\s*([\'"])').exec(html);
  if(!start)return '';
  let raw='',closed=false;
  for(let i=start.index+start[0].length;i<html.length&&raw.length<20000;i++){
    const c=html[i];if(c===start[1]){closed=true;break;}
    raw+=c;if(c==='\\')raw+=html[++i]||'';
  }
  if(!closed)throw new SourceError('PAGE_CHANGED','歌曲海的歌曲信息不完整，请重试。');
  return decodeLiteral(raw);
}
export function parseDetail(html: string): Detail {
  if(isChallenge(html))throw new SourceError('VERIFY','歌曲海需要安全验证，请打开验证窗口后重试。');
  const id=songId(stringField(html,'mp3_id')),playId=stringField(html,'play_id');
  if(!playId||playId.length>4096)throw new SourceError('PAGE_CHANGED','歌曲海缺少播放参数，请重试。');
  const title=clean(stringField(html,'mp3_title')),artist=clean(stringField(html,'mp3_author'));
  if(!title)throw new SourceError('PAGE_CHANGED','歌曲海没有返回歌曲名称，请重试。');
  const type=Number(html.match(/window\.mp3_type\s*=\s*(\d+)\s*;/)?.[1]??1);
  return {source:'gequhai',id,title,artist,playId,type:type===0?0:1,cover:safeHttp(stringField(html,'mp3_cover')),duration:clean(stringField(html,'mp3_duration')),hasCloudLinks:!!stringField(html,'mp3_extra_url')};
}
export function parseSearch(doc: Document): SearchResult {
  if(isChallenge(doc.documentElement?.outerHTML||''))throw new SourceError('VERIFY','歌曲海需要安全验证，请打开验证窗口后重试。');
  const heading=doc.querySelector('h1'),table=doc.querySelector('table');
  if(!heading||!table)throw new SourceError('PAGE_CHANGED','歌曲海搜索页面格式发生变化，请重试。');
  const items: Song[]=[],seen=new Set<string>();
  for(const row of table.querySelectorAll('tr')){
    const a=row.querySelector<HTMLAnchorElement>('a[href*="/play/"]');if(!a)continue;
    let u: URL;try{u=new URL(a.getAttribute('href')||'',ORIGIN);}catch{continue;}
    const id=u.pathname.match(/^\/play\/(\d{1,12})$/)?.[1],title=clean(a.textContent);
    if(u.origin!==ORIGIN||!id||!title||seen.has(id))continue;
    const artist=clean(a.closest('td')?.nextElementSibling?.textContent);
    seen.add(id);items.push({source:'gequhai',id,title,artist,duration:'',cover:''});
  }
  let next='';
  for(const a of doc.querySelectorAll('a[rel="next"],.pagination a')){
    if(a.getAttribute('rel')!=='next'&&!/下一页|next|›|»/i.test(a.textContent||''))continue;
    try{const u=new URL(a.getAttribute('href')||'',ORIGIN);if(u.origin===ORIGIN&&u.pathname==='/search'&&u.searchParams.get('s')===clean(heading.textContent))next=u.pathname+u.search;}catch{}
  }
  return {items,total:Number((heading.parentElement?.textContent||'').match(/共找到\s*(\d+)\s*条/)?.[1]||items.length),next,query:clean(heading.textContent)};
}
export function parseResolved(result: Record<string,unknown>): string {
  const code=result.code,data=result.data;
  if(code===200&&data&&typeof data==='object'&&'url' in data)return mediaURL(data.url).href;
  if(code===429)throw new SourceError('RATE_LIMIT','歌曲海请求较频繁，请稍后重试。');
  if(code===403&&/过期|expired/i.test(clean(result.msg)))throw new SourceError('PLAY_EXPIRED','歌曲海播放参数已过期，请重新获取。');
  if(code===403)throw new SourceError('VERIFY','请在歌曲海小窗完成验证后重试。');
  if(code===430)throw new SourceError('PARSE_FAILED','歌曲海的这个版本没有普通音质播放源，请选择其他版本。');
  // Unknown response codes must not be interpreted as a successful or unrestricted download.
  throw new SourceError('PARSE_FAILED',clean(result.msg)||'歌曲海暂时无法提供普通音质播放源，请重试或选择其他版本。');
}
