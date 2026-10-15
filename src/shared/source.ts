import type { Detail, SearchResult, Song, SourceResult } from './types';
import { SourceError } from './errors';
export { SourceError } from './errors';
export const ORIGIN='https://www.gequbao.com';
export const clean=(value: unknown)=>String(value??'').replace(/\s+/g,' ').trim();
export function songId(value: unknown): string {
  const id=String(value??'');
  if(!/^\d{1,12}$/.test(id))throw new SourceError('BAD_ID','歌曲编号无效。');
  return id;
}
export function searchPath(query: string): string {
  query=clean(query);
  if(!query||query.length>35)throw new SourceError('BAD_QUERY','请输入 1–35 个字符的歌名或歌手。');
  return '/s/'+encodeURIComponent(query);
}
export function isChallenge(html: string): boolean {
  return /<title[^>]*>\s*(?:Just a moment|请稍候|Attention Required)/i.test(html)||/window\._cf_chl_opt\s*=|cf-chl-widget|cf-challenge-running/.test(html);
}
/** Decode only a quoted JS string literal; never execute downloaded scripts. */
export function decodeLiteral(source: string): string {
  let out='';const short: Record<string,string>={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0'};
  for(let i=0;i<source.length;i++){
    if(source[i]!=='\\'){out+=source[i];continue;}
    const c=source[++i];if(c===undefined)throw new SourceError('PAGE_CHANGED','歌曲信息不完整。');
    if(c==='u'||c==='x'){
      const count=c==='u'?4:2,hex=source.slice(i+1,i+1+count);
      if(!new RegExp('^[0-9a-f]{'+count+'}$','i').test(hex))throw new SourceError('PAGE_CHANGED','歌曲信息格式发生变化。');
      out+=String.fromCharCode(parseInt(hex,16));i+=count;
    }else if(c==='\n'){ /* line continuation */ }
    else if(c==='\r'){if(source[i+1]==='\n')i++;}
    else out+=Object.prototype.hasOwnProperty.call(short,c)?short[c]:c;
  }
  return out;
}
export function parseAppData(html: string): Record<string,unknown> {
  if(isChallenge(html))throw new SourceError('VERIFY','连接需要安全验证，请打开验证窗口后重试。');
  const start=/(?:window\.)?appData\s*=\s*JSON\.parse\(\s*(['"])/g.exec(html);
  if(!start)throw new SourceError('PAGE_CHANGED','没有找到歌曲信息，请稍后重试。');
  let i=start.index+start[0].length,raw='',closed=false;
  for(;i<html.length&&raw.length<1000000;i++){
    const c=html[i];if(c===start[1]){closed=true;break;}
    raw+=c;if(c==='\\')raw+=html[++i]||'';
  }
  if(!closed)throw new SourceError('PAGE_CHANGED','歌曲信息不完整。');
  let data: unknown;try{data=JSON.parse(decodeLiteral(raw));}catch{throw new SourceError('PAGE_CHANGED','无法读取歌曲信息，请稍后重试。');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw new SourceError('PAGE_CHANGED','缺少音源解析参数。');
  const record=data as Record<string,unknown>;
  if(typeof record.play_id!=='string'||!record.play_id||record.play_id.length>4096)throw new SourceError('PAGE_CHANGED','缺少音源解析参数。');
  songId(record.mp3_id);return record;
}
export function safeHttp(value: unknown): string {
  if(typeof value!=='string')return '';
  try{const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}
}
export function mediaURL(value: unknown): URL {
  const safe=safeHttp(value);if(!safe)throw new SourceError('BAD_URL','音源地址无效。');
  const u=new URL(safe);
  if(!u.hostname.includes('.')||/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)||u.hostname.includes(':')||/\.(?:local|localhost|internal)$/i.test(u.hostname)||u.port&&!["80","443"].includes(u.port))throw new SourceError('BAD_URL','音源地址不是公共音频服务器。');
  return u;
}
export function metadata(data: Record<string,unknown>): Detail {
  return {source:'gequbao',id:songId(data.mp3_id),title:clean(data.mp3_title),artist:clean(data.mp3_author),duration:clean(data.mp3_duration),cover:safeHttp(data.mp3_cover),album:clean(data.mp3_album),type:Number(data.mp3_type||0),playId:String(data.play_id),hasCloudLinks:Array.isArray(data.mp3_extra_urls)&&data.mp3_extra_urls.length>0};
}
export function parseSearchDocument(doc: Document,base=ORIGIN): SearchResult {
  if(isChallenge(doc.documentElement?.outerHTML||''))throw new SourceError('VERIFY','连接需要安全验证，请打开验证窗口后重试。');
  const heading=doc.querySelector('h1');if(!heading)throw new SourceError('PAGE_CHANGED','搜索返回格式发生变化，请重试。');
  const scope=heading.closest('.card')||heading.parentElement?.parentElement||doc;
  let links=[...scope.querySelectorAll<HTMLAnchorElement>('a.hover-zoom[href*="/music/"]')];
  if(!links.length)links=[...scope.querySelectorAll<HTMLAnchorElement>('a[href*="/music/"]')].filter(a=>a.querySelector('small')&&!a.classList.contains('btn'));
  const seen=new Set<string>(),items: Song[]=[];
  for(const a of links){
    let u: URL;try{u=new URL(a.getAttribute('href')||'',base);}catch{continue;}
    const id=u.pathname.match(/^\/music\/(\d{1,12})$/)?.[1];
    if(!id||!['gequbao.com','www.gequbao.com'].includes(u.hostname)||seen.has(id))continue;
    seen.add(id);let title=clean(a.querySelector('.text-primary')?.textContent||a.querySelector('span')?.textContent),artist=clean(a.querySelector('small')?.textContent);
    if(!title){const label=clean(a.title||a.textContent),split=label.lastIndexOf(' - ');title=split>0?label.slice(0,split):label;artist||=split>0?label.slice(split+3):'';}
    if(title)items.push({source:'gequbao',id,title,artist,cover:'',duration:''});
  }
  let next='';
  for(const a of doc.querySelectorAll('a[rel="next"], .pagination a')){
    if(!/下一页|next|›|»/i.test(a.textContent||'')&&a.getAttribute('rel')!=='next')continue;
    try{const u=new URL(a.getAttribute('href')||'',base);if(u.origin===ORIGIN&&u.pathname.startsWith('/s/'))next=u.pathname+u.search;}catch{}
  }
  return {items,total:Number((scope.textContent||'').match(/共\s*(\d+)\s*首/)?.[1]||items.length),next,query:clean(heading.textContent)};
}
export function unwrapJSONP(text: string): unknown {
  try{return JSON.parse(text);}catch{}
  const m=text.trim().match(/^[\w.$]+\s*\(\s*([\s\S]+)\s*\)\s*;?$/);
  if(!m)throw new SourceError('PAGE_CHANGED','音源转换返回格式发生变化。');
  try{return JSON.parse(m[1]);}catch{throw new SourceError('PAGE_CHANGED','无法读取音源转换结果。');}
}
export function resolvedURL(result: SourceResult): string {
  if(result?.code===1&&safeHttp(result.data?.url))return mediaURL(result.data?.url).href;
  const reason=result?.data?.reason;
  if(reason==='parse_quota_exhausted')throw new SourceError('QUOTA','今日免费解析额度已用完，明日再试。');
  if(reason==='parse_busy'||result?.code===5)throw new SourceError('BUSY','音源服务繁忙，请稍后重试。');
  if([2,3].includes(result?.code))throw new SourceError('CAPTCHA',clean(result.msg)||'请输入验证码后继续。');
  throw new SourceError('PARSE_FAILED',clean(result?.msg)||'暂时无法获取音源，请重试或选择其他版本。');
}
export function seconds(value: string): number {
  const p=String(value||'').split(':').map(Number);
  return p.length<=3&&p.every(n=>Number.isFinite(n)&&n>=0)?p.reduce((a,b)=>a*60+b,0):0;
}
