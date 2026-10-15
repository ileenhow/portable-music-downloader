declare global { var __portableLibraryBridge: boolean | undefined }

// Type-only module marker is erased: this entry must stay a classic, standalone bundle.
if(!globalThis.__portableLibraryBridge){
  globalThis.__portableLibraryBridge=true;
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(sender.id!==chrome.runtime.id||message?.channel!=='portable-library-provider')return;
    void (async()=>{try{
      const {path,method='GET',body='',source='gequbao'}=message;
      const getAllowed=source==='gequbao'?/^\/s\/[^?#]+(?:\?page=\d+)?$|^\/music\/\d{1,12}$|^\/api\/captcha\?\d+$/:/^\/search\?s=[^&#]+(?:&page=\d+)?$|^\/play\/\d{1,12}$/;
      const postPath=source==='gequbao'?'/member/common-play-url':'/api/music';
      if(!['gequbao','gequhai'].includes(source)||typeof path!=='string'||typeof body!=='string'||body.length>10000||!(method==='GET'&&getAllowed.test(path)||method==='POST'&&path===postPath))throw new Error('请求不在音源接口范围内。');
      if(method==='GET'&&path===location.pathname+location.search){reply({ok:true,status:200,body:document.documentElement.outerHTML,type:'text/html'});return;}
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
      try{
        const response=await fetch(path,{method,credentials:'include',signal:controller.signal,headers:method==='POST'?{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':source==='gequhai'?'Http':'XMLHttpRequest',...(source==='gequhai'?{'X-Custom-Header':'Key'}:{})}:{},...(method==='POST'?{body}: {})});
        reply({ok:true,status:response.status,body:await response.text(),type:response.headers.get('content-type')||''});
      }finally{clearTimeout(timer);}
    }catch{reply({ok:false,error:'连接中断，请重试。'});}})();return true;
  });
}
export {};
