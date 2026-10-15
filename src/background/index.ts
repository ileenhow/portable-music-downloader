import * as P from '../shared/source';
import { sourceId,type SourceId } from '../shared/sources';
import { musicSource } from '../shared/providers';
import type { SourceResult } from '../shared/types';
import { toError } from '../shared/errors';
import { CHANNEL, type Message } from '../shared/messages';
import { openVerificationWindow, source, readJSON, post, cleanProvider } from './provider';

// Only pending calls live in memory. Window and verification state lives in storage.session.
const lanes=new Map<SourceId,Promise<void>>();
function serialized<T>(id: SourceId,task: ()=>Promise<T>): Promise<T> {
  const previous=lanes.get(id)||Promise.resolve();
  const result=(async()=>{await previous;return task();})();
  lanes.set(id,(async()=>{try{await result;}catch{/* A failed call must release this source's lane. */}})());
  return result;
}
async function perform(message: Message): Promise<unknown> {
  const adapter=musicSource('source' in message.args?message.args.source:undefined),id=adapter.id;
  switch(message.action){
    case 'SEARCH':{
      const a=message.args,response=await source(id,adapter.searchPath(a.query,a.cursor));
      if(response.status===429)throw new P.SourceError('RATE_LIMIT',adapter.name+'搜索较频繁，请稍后重试。');
      if(response.status!==200)throw new P.SourceError('NETWORK',adapter.name+'搜索暂时不可用，请稍后重试。');
      return {html:response.body};
    }
    case 'DETAIL':{
      const songId=P.songId(message.args.id),response=await source(id,adapter.detailPath(songId));
      if(response.status===429)throw new P.SourceError('RATE_LIMIT',adapter.name+'请求较多，请稍后重试。');
      if(response.status!==200)throw new P.SourceError('NETWORK','无法读取歌曲信息，请重试。');
      const track=adapter.parseDetail(response.body);
      if(track.id!==songId||track.source!==id)throw new P.SourceError('PAGE_CHANGED','歌曲信息与所选版本不一致，请重试。');
      return track;
    }
    case 'RESOLVE':{
      const a=message.args,songId=P.songId(a.id);
      if(typeof a.playId!=='string'||!a.playId||a.playId.length>4096||a.purpose!=='play')throw new P.SourceError('BAD_ID','解析参数无效。');
      const request=adapter.resolveRequest(a.playId),fields=request.fields;
      if(adapter.captchaPath&&a.captchaCode&&a.key){fields.captchaCode=String(a.captchaCode).slice(0,10);fields.key=String(a.key).slice(0,500);}
      const result=await post(id,request.path,fields,adapter.detailPath(songId));
      try{return {url:adapter.parseResolved(result)};}catch(caught){
        const error=toError(caught);if(error.code==='VERIFY')await openVerificationWindow(id,adapter.detailPath(songId));throw error;
      }
    }
    case 'CAPTCHA':{
      if(!adapter.captchaPath)throw new P.SourceError('BAD_ACTION','此音源没有图片验证码接口，请使用验证窗口。');
      return readJSON(await source(id,adapter.captchaPath+'?'+Date.now(),{page:adapter.detailPath(message.args.id)}),id) as unknown as SourceResult;
    }
    case 'CONVERT':{
      const url=P.mediaURL(message.args.url);
      if(url.hostname!=='antiserver.kuwo.cn')throw new P.SourceError('BAD_URL','音源转换地址无效。');
      url.searchParams.set('type','convert_url3');url.searchParams.set('callback','portableLibrary');
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
      try{
        const response=await fetch(url.href,{credentials:'omit',signal:controller.signal});if(!response.ok)throw new P.SourceError('NETWORK','音源转换失败。');
        const data=P.unwrapJSONP(await response.text());
        if(!data||typeof data!=='object'||!('code' in data)||data.code!==200||!('url' in data))throw new P.SourceError('PARSE_FAILED','未获得音频文件地址。');
        return {url:P.mediaURL(data.url).href};
      }finally{clearTimeout(timer);}
    }
    case 'VERIFY':{
      const a=message.args,path=a.id?adapter.detailPath(a.id):a.query?adapter.searchPath(a.query):'/';
      await openVerificationWindow(id,path);return true;
    }
    default:throw new P.SourceError('BAD_ACTION','不支持的操作。');
  }
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.channel!==CHANNEL||sender.id!==chrome.runtime.id||sender.url?.split(/[?#]/)[0]!==chrome.runtime.getURL('popup.html'))return;
  void (async()=>{try{
    const id=sourceId(message.args?.source),data=await serialized(id,()=>perform(message));reply({ok:true,data});
  }catch(caught){const error=toError(caught);reply({ok:false,error:{code:error.code,message:error.code==='UNKNOWN'?'连接中断，请重试。':error.message,details:error.details}});}})();
  return true;
});
chrome.action.onClicked.addListener(async()=>{
  const url=chrome.runtime.getURL('popup.html'),tabs=await chrome.tabs.query({});
  const existing=tabs.find(tab=>tab.url===url);
  if(existing){await chrome.tabs.update(existing.id!,{active:true});await chrome.windows.update(existing.windowId,{focused:true});}
  else await chrome.tabs.create({url});
});
chrome.alarms.onAlarm.addListener(alarm=>{
  const id=alarm.name==='provider-cleanup'?'gequbao':alarm.name.startsWith('provider-cleanup:')?alarm.name.slice('provider-cleanup:'.length):null;
  if(id===null)return;
  void (async()=>{try{const source=sourceId(id);await serialized(source,()=>cleanProvider(source));}catch{/* Cleanup may race with closing a source window. */}})();
});
