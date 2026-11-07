import {apiFetch} from './api-client.js';
export class SSEParser {
 constructor(onEvent){this.buffer='';this.onEvent=onEvent;}
 push(text){this.buffer=(this.buffer+text).replace(/\r\n/g,'\n');let p;while((p=this.buffer.indexOf('\n\n'))>=0){const block=this.buffer.slice(0,p);this.buffer=this.buffer.slice(p+2);let event='message';const data=[];for(const line of block.split('\n')){if(line.startsWith('event:'))event=line.slice(6).trim();if(line.startsWith('data:'))data.push(line.slice(5).trimStart());}if(data.length)this.onEvent(event,JSON.parse(data.join('\n')));}}
}
export class PCMChunks {
 constructor(rate){this.ratio=rate/16000;this.weight=0;this.sum=0;this.samples=[];}
 push(input){const chunks=[];for(const v of input){let remaining=1;while(remaining>1e-9){const used=Math.min(remaining,this.ratio-this.weight);this.sum+=v*used;this.weight+=used;remaining-=used;if(this.weight>=this.ratio-1e-9){this.samples.push(this.sum/this.ratio);this.weight=0;this.sum=0;if(this.samples.length===1600)chunks.push(this.encode());}}}return chunks;}
 encode(){const v=new DataView(new ArrayBuffer(this.samples.length*2));this.samples.forEach((x,i)=>v.setInt16(i*2,Math.max(-1,Math.min(1,x))*(x<0?32768:32767),true));this.samples=[];let s='';for(const b of new Uint8Array(v.buffer))s+=String.fromCharCode(b);return btoa(s);}
 tail(){return this.samples.length?this.encode():null;}
}
export class GeminiLiveClient {
 constructor({token,onEvent,onFailure,fetcher=apiFetch}){Object.assign(this,{token,onEvent,onFailure,fetcher});this.queue=[];this.active=false;this.sending=false;this.stopping=false;}
 async post(path,data,signal){const r=await this.fetcher('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':this.token},body:JSON.stringify(data),signal});if(!r.ok){const d=await r.json().catch(()=>({}));throw Object.assign(Error(d.error||'Gemini 請求失敗'),{status:r.status,retryable:[408,409,410,500,502,503,504].includes(r.status)});}return r;}
 async connect(target,options={}){this.abort=new AbortController();this.active=true;return new Promise((resolve,reject)=>{let ready=false;const timer=setTimeout(()=>{reject(Error('Gemini 啟動逾時'));this.close();},20000);
 this.rejectConnect=reject;
 const parser=new SSEParser((event,data)=>{if(event==='ready'){ready=true;this.rejectConnect=null;this.id=data.id;clearTimeout(timer);resolve();}else if(event==='error')throw Object.assign(Error(data.error),{retryable:data.retryable});else this.onEvent(event,data);});
 this.readTask=(async()=>{try{const response=await this.post('gemini-live',{target,...options},this.abort.signal);const reader=response.body.getReader(),decoder=new TextDecoder();while(true){const {value,done}=await reader.read();if(done)break;parser.push(decoder.decode(value,{stream:true}));}if(!this.stopping&&this.active)throw Error('Gemini 串流已中斷');}catch(e){if(this.active&&!this.stopping){if(!ready)reject(e);else this.fail(e);}}finally{clearTimeout(timer);}})();
 });}
 send(audio){if(!this.active||this.stopping)return;if(this.queue.length>=30){this.fail(Error('Gemini 網路速度落後，已停止串流'));return;}this.queue.push(audio);this.pump();}
 async pump(){if(this.sending)return;this.sending=true;try{while(this.queue.length&&this.active){await this.post('gemini-audio',{id:this.id,audio:this.queue.shift()},AbortSignal.timeout(8000));}}catch(e){if(!this.stopping)this.fail(e);}finally{this.sending=false;}}
 fail(e){if(!this.active||this.stopping)return;this.close();this.onFailure(e);}
 async end(){if(!this.active)return;this.stopping=true;const deadline=Date.now()+3500;while((this.sending||this.queue.length)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,30));try{await this.post('gemini-end',{id:this.id},AbortSignal.timeout(3000));await Promise.race([this.readTask,new Promise(r=>setTimeout(r,3000))]);}catch{}this.close();}
 close(){this.active=false;this.queue=[];this.abort?.abort();this.rejectConnect?.(new DOMException('連線已取消','AbortError'));this.rejectConnect=null;}
}

// Replace the short-lived transport without resetting the lecture or microphone.
// Buffer only audio not yet handed to a transport: replaying acknowledged audio
// can produce duplicate subtitles and cannot guarantee exactly-once recognition.
export class ContinuousGeminiClient {
 constructor({token,onEvent,onFailure,fetcher=apiFetch,Client=GeminiLiveClient,
  rotateMs=8*60*1000,retryDelays=[1000,2000,4000],maxBufferedChunks=300,flushMs=50}) {
  Object.assign(this,{token,onEvent,onFailure,fetcher,Client,rotateMs,retryDelays,maxBufferedChunks,flushMs});
  this.active=false;this.stopping=false;this.queue=[];this.epoch=0;this.lostChunks=0;
 }
 async connect(target,options={}) {
  this.target=target;this.options=options;this.active=true;this.stopping=false;
  const epoch=++this.epoch;
  try{await this.open(epoch);if(this.active&&epoch===this.epoch)this.arm();}
  catch(error){if(epoch===this.epoch)this.close();throw error;}
 }
 async open(epoch) {
  const client=new this.Client({token:this.token,fetcher:this.fetcher,
   onEvent:(event,data)=>{
    if(!this.active||epoch!==this.epoch||this.client!==client)return;
    if(event==='rotate'){if(!this.stopping)this.reconnect(true);return;}
    this.onEvent(event,data);
   },
   onFailure:error=>{if(this.active&&!this.stopping&&epoch===this.epoch&&this.client===client)this.reconnect(false,error);}
  });
  this.client=client;this.ready=false;
  try{await client.connect(this.target,this.options);}
  catch(error){client.close();throw error;}
  if(!this.active||this.stopping||epoch!==this.epoch){client.close();throw new DOMException('連線已取消','AbortError');}
  if(!client.active)throw Error('Gemini 連線已中斷');
  this.ready=true;
 }
 arm(){clearTimeout(this.rotationTimer);this.rotationTimer=setTimeout(()=>this.reconnect(true),this.rotateMs);this.flush();}
 retryable(error){
  // Do not repeatedly charge/retry an invalid configuration, denied key or quota.
  if(/429|quota|credit|RESOURCE_EXHAUSTED|PERMISSION_DENIED|UNAUTHENTICATED|invalid.*key|API key|額度|金鑰|權限|Invalid JSON|1007|1008/i.test(error?.message||''))return false;
  return error?.retryable!==false;
 }
 reconnect(planned,error) {
  if(!this.active||this.stopping||this.recovery)return this.recovery;
  if(!planned&&!this.retryable(error)){this.fail(error);return;}
  if(!planned){this.failures=(this.failures||[]).filter(time=>Date.now()-time<60000);this.failures.push(Date.now());if(this.failures.length>3){this.fail(Error('網路反覆中斷，已停止重試並保留字幕。'));return;}}
  this.ready=false;clearTimeout(this.rotationTimer);clearTimeout(this.flushTimer);
  this.onEvent('reconnecting',{planned,bufferSeconds:this.maxBufferedChunks/10});
  // Assign before entering async work; duplicate GoAway/failure events coalesce.
  const epoch=this.epoch;
  this.recovery=Promise.resolve().then(()=>this.recover(epoch,planned,error)).catch(e=>{
   if(this.active&&!this.stopping&&epoch===this.epoch)this.fail(e);
  }).finally(()=>{if(epoch===this.epoch)this.recovery=null;});
  return this.recovery;
 }
 async recover(epoch,planned,error) {
  const old=this.client;
  if(planned)await old?.end();else old?.close();
  if(!this.active||this.stopping||epoch!==this.epoch)return;
  old?.close();this.client=null;
  if(!planned)this.onEvent('gap',{reason:'transport-interruption'});
  this.onEvent('boundary',{interrupted:!planned});
  let lastError=error;
  for(let attempt=0;attempt<=this.retryDelays.length;attempt++){
   if(attempt>0)await this.delay(this.retryDelays[attempt-1]);
   if(!this.active||this.stopping||epoch!==this.epoch)return;
   try{
    await this.open(epoch);
    if(!this.active||this.stopping||epoch!==this.epoch)return;
    this.onEvent('reconnected',{bufferedChunks:this.queue.length});this.arm();return;
   }catch(e){lastError=e;if(!this.active||this.stopping||epoch!==this.epoch)return;if(!this.retryable(e))throw e;}
  }
  throw Error('自動重新連線失敗，已保留字幕。'+(lastError?.message||''));
 }
 delay(ms){return new Promise(resolve=>{this.releaseDelay=resolve;this.retryTimer=setTimeout(()=>{this.releaseDelay=null;resolve();},ms);});}
 send(audio){
  if(!this.active||this.stopping)return;
  if(this.queue.length>=this.maxBufferedChunks){this.queue.shift();this.lostChunks++;if(this.lostChunks===1)this.onEvent('gap',{reason:'buffer-full'});}
  this.queue.push(audio);this.flush();
 }
 flush(){
  clearTimeout(this.flushTimer);
  if(!this.active||!this.ready||!this.client?.active)return;
  let sent=0;
  while(this.queue.length && (this.client.queue?.length||0)<10 && sent<5 && this.ready && this.client.active){this.client.send(this.queue.shift());sent++;}
  if(this.queue.length)this.flushTimer=setTimeout(()=>this.flush(),this.flushMs);
 }
 fail(error){if(!this.active||this.stopping)return;this.close();this.onFailure(error);}
 async end(){
  if(!this.active)return;
  this.stopping=true;clearTimeout(this.rotationTimer);clearTimeout(this.retryTimer);this.releaseDelay?.();this.releaseDelay=null;
  // A stop during recovery cancels the new connection; it never restarts capture.
  if(this.recovery){if(this.queue.length)this.onEvent('gap',{reason:'stopped-during-reconnect'});this.close();return;}
  const deadline=Date.now()+3500;
  while(this.queue.length&&this.ready&&Date.now()<deadline){this.flush();await new Promise(r=>setTimeout(r,30));}
  if(this.queue.length)this.onEvent('gap',{reason:'unsent-tail'});
  await this.client?.end();this.close();
 }
 close(){
  this.active=false;this.ready=false;this.stopping=true;this.epoch++;
  clearTimeout(this.rotationTimer);clearTimeout(this.retryTimer);clearTimeout(this.flushTimer);
  this.releaseDelay?.();this.releaseDelay=null;this.client?.close();this.queue=[];this.recovery=null;
 }
}
