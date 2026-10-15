import * as P from '../shared/source';
import { sourceInfo,type SourceId } from '../shared/sources';
import type { ProviderResponse } from '../shared/types';

const delay=(ms: number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const LEGACY_KEYS=['providerTabId','providerWindowId','providerLastUsed','providerSessionMode','providerNeedsVerification'];
const keys=(id: SourceId)=>({tab:`provider:${id}:tab`,window:`provider:${id}:window`,last:`provider:${id}:last`,mode:`provider:${id}:mode`,verify:`provider:${id}:verify`});
const verifyMessage=(id: SourceId)=>'请在'+sourceInfo(id).name+'小窗中完成安全验证，然后返回重试。';
async function session(id: SourceId){
  const k=keys(id),stored=await chrome.storage.session.get(Object.values(k));
  if(id==='gequbao'&&stored[k.tab]===undefined){
    const old=await chrome.storage.session.get(LEGACY_KEYS);
    if(typeof old.providerTabId==='number'){
      Object.assign(stored,{[k.tab]:old.providerTabId,[k.window]:old.providerWindowId,[k.last]:old.providerLastUsed||0,[k.mode]:!!old.providerSessionMode,[k.verify]:!!old.providerNeedsVerification});
      await chrome.storage.session.set(stored);await chrome.storage.session.remove(LEGACY_KEYS);
    }
  }
  return stored;
}
export async function touchProvider(id: SourceId): Promise<void> {
  await chrome.storage.session.set({[keys(id).last]:Date.now()});
  await chrome.alarms.create('provider-cleanup:'+id,{delayInMinutes:3});
}
export async function getOwnedTab(id: SourceId): Promise<chrome.tabs.Tab|null> {
  const k=keys(id),stored=await session(id),origin=sourceInfo(id).origin;
  const tabId=stored[k.tab];if(typeof tabId!=='number')return null;
  try{
    const tab=await chrome.tabs.get(tabId);
    if(tab.url?.startsWith(origin+'/')||tab.pendingUrl?.startsWith(origin+'/'))return tab;
  }catch{}
  await chrome.storage.session.remove(Object.values(k));return null;
}
async function providerWindow(id: SourceId,path: string): Promise<chrome.tabs.Tab> {
  const owned=await getOwnedTab(id),k=keys(id);
  if(owned){
    const stored=await session(id);
    if(stored[k.window]===owned.windowId){
      const window=await chrome.windows.get(owned.windowId);
      if(window.type==='popup'){await touchProvider(id);return owned;}
    }
  }
  // Each source owns one window; never borrow or close the user's browsing tabs.
  const window=await chrome.windows.create({...(owned?{tabId:owned.id}:{url:sourceInfo(id).origin+path}),type:'popup',state:'minimized',focused:false});
  if(window?.id===undefined)throw new P.SourceError('NETWORK','无法创建音源会话窗口，请重试。');
  const tabs=window.tabs||await chrome.tabs.query({windowId:window.id}),tab=owned?tabs.find(t=>t.id===owned.id):tabs[0];
  if(tab?.id===undefined)throw new P.SourceError('NETWORK','音源会话窗口没有加载，请重试。');
  await chrome.storage.session.set({[k.tab]:tab.id,[k.window]:window.id,[k.mode]:true});
  await touchProvider(id);return tab;
}
async function showVerification(id: SourceId,tab: chrome.tabs.Tab): Promise<void> {
  await chrome.storage.session.set({[keys(id).verify]:true});
  await chrome.windows.update(tab.windowId,{state:'normal',width:520,height:680,focused:true});
  await chrome.tabs.update(tab.id!,{active:true});await touchProvider(id);
}
export async function openVerificationWindow(id: SourceId,path: string,navigate=false): Promise<void> {
  const tab=await providerWindow(id,path),url=sourceInfo(id).origin+path;
  if(navigate&&tab.url!==url)await chrome.tabs.update(tab.id!,{url});
  await showVerification(id,tab);
}
async function minimizeProvider(id: SourceId,tab: chrome.tabs.Tab): Promise<void> {
  const stored=await session(id);if(stored[keys(id).window]!==tab.windowId)return;
  try{
    const window=await chrome.windows.get(tab.windowId,{populate:true});
    if(window.type==='popup'&&window.tabs?.length===1&&window.tabs[0].id===tab.id&&window.state!=='minimized')await chrome.windows.update(tab.windowId,{state:'minimized',focused:false});
  }catch{/* A closed verification window must not discard a received response. */}
}
async function providerTab(id: SourceId,path: string): Promise<chrome.tabs.Tab> {
  const tab=await providerWindow(id,path),deadline=Date.now()+22000;let shown=false;
  while(Date.now()<deadline){
    try{
      const results=await chrome.scripting.executeScript({target:{tabId:tab.id!},func:()=>({url:location.href,ready:document.readyState!=='loading',challenge:/请稍候|Just a moment|Attention Required/i.test(document.title)||!!document.querySelector('#challenge-running,.cf-challenge-running'),hasContent:!!document.querySelector('h1,.js-search-form,#s-input,#s-input-line')})});
      const state=results[0]?.result;
      if(state?.challenge&&!shown){await showVerification(id,tab);shown=true;}
      if(state?.url.startsWith(sourceInfo(id).origin+'/')&&state.ready&&!state.challenge&&state.hasContent){
        await chrome.scripting.executeScript({target:{tabId:tab.id!},files:['assets/content.js']});return tab;
      }
    }catch{/* Navigation may replace the isolated execution context. */}
    await delay(600);
  }
  if(!shown)await showVerification(id,tab);
  throw new P.SourceError('VERIFY',verifyMessage(id));
}
function headers(id: SourceId){
  return {'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':id==='gequhai'?'Http':'XMLHttpRequest',...(id==='gequhai'?{'X-Custom-Header':'Key'}:{})};
}
async function direct(id: SourceId,path: string,method: string,body: string): Promise<ProviderResponse> {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(sourceInfo(id).origin+path,{method,credentials:'include',signal:controller.signal,headers:method==='POST'?headers(id):{},...(method==='POST'?{body}:{})});
    return {ok:true,status:response.status,body:await response.text(),type:response.headers.get('content-type')||''};
  }finally{clearTimeout(timer);}
}
function needsPageContext(id: SourceId,path: string,response: ProviderResponse){
  if(id!=='gequhai'||path!=='/api/music')return false;
  // An expired play token needs fresh details, not a verification window.
  // Other access failures can retry the normal request from our own page session.
  try{const data: unknown=JSON.parse(response.body);return !!data&&typeof data==='object'&&'code' in data&&data.code===403&&(!('msg' in data)||!/过期|expired/i.test(String(data.msg)));}catch{return false;}
}
export async function source(id: SourceId,path: string,{method='GET',body='',page='/'}={}): Promise<ProviderResponse> {
  const owned=await getOwnedTab(id),stored=await session(id);
  if(!stored[keys(id).mode]||!owned){
    try{const r=await direct(id,path,method,body);if(![403,503].includes(r.status)&&!P.isChallenge(r.body)&&!needsPageContext(id,path,r))return r;}catch{/* Use an ordinary page session when direct requests cannot connect. */}
  }
  const fallbackPath=method==='GET'&&!path.startsWith('/api/')?path:page;
  const tab=await providerTab(id,fallbackPath);
  const response: ProviderResponse=await chrome.tabs.sendMessage(tab.id!,{channel:'portable-library-provider',source:id,path,method,body});
  if(!response?.ok)throw new P.SourceError('NETWORK','连接中断，请重试。');
  if(P.isChallenge(response.body)){
    await openVerificationWindow(id,fallbackPath,true);throw new P.SourceError('VERIFY',verifyMessage(id));
  }
  await chrome.storage.session.set({[keys(id).verify]:false});await touchProvider(id);await minimizeProvider(id,tab);
  return response;
}
export function readJSON(response: ProviderResponse,id: SourceId): Record<string,unknown> {
  if(response.status===429)throw new P.SourceError('RATE_LIMIT',sourceInfo(id).name+'请求较多，请稍后重试。');
  if(P.isChallenge(response.body))throw new P.SourceError('VERIFY',verifyMessage(id));
  if(response.status<200||response.status>=300)throw new P.SourceError('NETWORK','音源服务暂时不可用，请稍后重试。');
  try{const data: unknown=JSON.parse(response.body);if(!data||typeof data!=='object'||!('code' in data)||typeof data.code!=='number')throw new Error();return data as Record<string,unknown>;}catch{throw new P.SourceError('PAGE_CHANGED','音源服务返回格式发生变化。');}
}
export async function post(id: SourceId,path: string,fields: Record<string,string>,page: string){
  return readJSON(await source(id,path,{method:'POST',body:new URLSearchParams(fields).toString(),page}),id);
}
export async function cleanProvider(id: SourceId): Promise<void> {
  const k=keys(id),stored=await session(id);
  if(typeof stored[k.tab]!=='number'||Date.now()-Number(stored[k.last]||0)<=120000)return;
  const tab=await getOwnedTab(id);if(!tab)return;
  let window: chrome.windows.Window|null=null;try{window=await chrome.windows.get(tab.windowId);}catch{}
  if(window?.focused||stored[k.verify]){await chrome.alarms.create('provider-cleanup:'+id,{delayInMinutes:3});return;}
  try{await chrome.tabs.remove(tab.id!);}catch{}
  await chrome.storage.session.remove(Object.values(k));
}
