const BRIDGE='http://127.0.0.1:8799';
export function desktopCaptionPayload(value={}){
 const style=value.style||{};
 return {visible:value.visible!==false,lanes:(Array.isArray(value.lanes)?value.lanes:[]).slice(0,4).map(lane=>({label:String(lane.label||'').slice(0,100),text:Array.from(String(lane.text||'')).slice(-6000).join(''),source:lane.source===true})),style:{color:/^#[0-9a-f]{6}$/i.test(style.color)?style.color:'#ffffff',size:Math.max(18,Math.min(96,Number(style.size)||48)),lines:Math.max(1,Math.min(5,Number(style.lines)||2)),outline:style.outline!==false,backplate:style.backplate===true}};
}
export class DesktopCaptionClient {
 constructor({fetcher=(...args)=>globalThis.fetch(...args),onStatus=()=>{},intervalMs=250,retryMs=1000}={}){Object.assign(this,{fetcher,onStatus,intervalMs,retryMs});this.active=false;this.generation=0;this.controllers=new Set();}
 async post(path,payload,code=this.code){
  const controller=new AbortController();this.controllers.add(controller);const timer=setTimeout(()=>controller.abort(),path==='/hello'?45000:5000);
  try{
   const response=await this.fetcher(BRIDGE+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+code},body:JSON.stringify(payload),signal:controller.signal,cache:'no-store',credentials:'omit',targetAddressSpace:'loopback'});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Object.assign(Error(response.status===401?'連線碼不正確，請從 Mac 工具重新複製。':'Mac 工具拒絕連線，請確認來源與工具版本。'),{fatal:[400,401,403,404].includes(response.status)});
   if(data.app!=='tranRU-Mac-Overlay')throw Object.assign(Error('這個本機服務不是 tranRU 透明字幕工具。'),{fatal:true});
   return data;
  }finally{clearTimeout(timer);this.controllers.delete(controller);}
 }
 async connect(code,payload){
  this.close();const generation=this.generation;
  if(!/^[0-9a-f]{32}$/i.test(String(code).trim()))throw Error('請貼上 Mac 工具提供的 32 字元連線碼；不是 API 金鑰。');
  this.code=String(code).trim().toLowerCase();this.active=true;this.failures=0;this.lastSignature='';
  try{
   const hello=await this.post('/hello',{});
   this.needsUpdate=!/^1\.[1-9]\d*\./.test(hello.version||'');
   if(!this.active||generation!==this.generation)return;
   this.onStatus(this.needsUpdate?'已連接；Mac 工具為舊版，請下載新版以改善字形與完整行顯示。':'已連接 Mac 透明字幕，可回到 PPT 播放。');this.send(payload);
  }catch(error){if(generation===this.generation){this.close();throw Error(error.fatal?error.message:'尚未連上 Mac 工具。請先開啟工具，並確認瀏覽器已允許連接這台裝置／本機網路。');}}
 }
 send(payload){if(!this.active)return;this.latest=desktopCaptionPayload(payload);if(!this.timer&&!this.sending)this.schedule(this.intervalMs);}
 schedule(delay){this.timer=setTimeout(()=>{this.timer=null;void this.flush();},delay);}
 async flush(){
  if(!this.active||this.sending||!this.latest)return;
  const payload=this.latest,signature=JSON.stringify(payload);if(signature===this.lastSignature)return;
  const generation=this.generation;this.sending=true;
  try{
   await this.post('/captions',payload);
   if(!this.active||generation!==this.generation)return;
   this.lastSignature=signature;if(this.failures)this.onStatus('Mac 字幕連線已恢復。');this.failures=0;
  }catch(error){
   if(!this.active||generation!==this.generation)return;
   if(error.fatal){this.close();this.onStatus(error.message);return;}
   this.failures++;this.onStatus('Mac 工具連線暫停，正在重新連接；網站翻譯持續執行。');
  }finally{
   if(generation===this.generation){this.sending=false;if(this.active&&JSON.stringify(this.latest)!==this.lastSignature)this.schedule(this.failures?Math.min(30000,this.retryMs*2**Math.min(this.failures-1,5)):this.intervalMs);}
  }
 }
 close(){this.active=false;this.generation++;clearTimeout(this.timer);this.timer=null;for(const c of this.controllers)c.abort();this.controllers.clear();this.sending=false;this.code='';this.latest=null;this.lastSignature='';}
 async disconnect(){const code=this.code;this.close();if(code){try{await this.post('/captions',{visible:false,lanes:[],style:{}},code);}catch{}}this.onStatus('已停止 Mac 字幕同步。');}
}
