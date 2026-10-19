import {apiFetch} from './api-client.js';
export class SSEParser {
 constructor(onEvent){this.buffer='';this.onEvent=onEvent;}
 push(text){this.buffer+=text.replace(/\r\n/g,'\n');let p;while((p=this.buffer.indexOf('\n\n'))>=0){const block=this.buffer.slice(0,p);this.buffer=this.buffer.slice(p+2);let event='message';const data=[];for(const line of block.split('\n')){if(line.startsWith('event:'))event=line.slice(6).trim();if(line.startsWith('data:'))data.push(line.slice(5).trimStart());}if(data.length)this.onEvent(event,JSON.parse(data.join('\n')));}}
}
export class PCMChunks {
 constructor(rate){this.ratio=rate/16000;this.weight=0;this.sum=0;this.samples=[];}
 push(input){const chunks=[];for(const v of input){let remaining=1;while(remaining>1e-9){const used=Math.min(remaining,this.ratio-this.weight);this.sum+=v*used;this.weight+=used;remaining-=used;if(this.weight>=this.ratio-1e-9){this.samples.push(this.sum/this.ratio);this.weight=0;this.sum=0;if(this.samples.length===1600)chunks.push(this.encode());}}}return chunks;}
 encode(){const v=new DataView(new ArrayBuffer(this.samples.length*2));this.samples.forEach((x,i)=>v.setInt16(i*2,Math.max(-1,Math.min(1,x))*(x<0?32768:32767),true));this.samples=[];let s='';for(const b of new Uint8Array(v.buffer))s+=String.fromCharCode(b);return btoa(s);}
 tail(){return this.samples.length?this.encode():null;}
}
export class GeminiLiveClient {
 constructor({token,onEvent,onFailure,fetcher=apiFetch}){Object.assign(this,{token,onEvent,onFailure,fetcher});this.queue=[];this.active=false;this.sending=false;this.stopping=false;}
 async post(path,data,signal){const r=await this.fetcher('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':this.token},body:JSON.stringify(data),signal});if(!r.ok){const d=await r.json();throw Error(d.error||'Gemini 請求失敗');}return r;}
 async connect(target){this.abort=new AbortController();this.active=true;return new Promise((resolve,reject)=>{let ready=false;const timer=setTimeout(()=>{reject(Error('Gemini 啟動逾時'));this.close();},20000);
 const parser=new SSEParser((event,data)=>{if(event==='ready'){ready=true;this.id=data.id;clearTimeout(timer);resolve();}else if(event==='error')throw Error(data.error);else this.onEvent(event,data);});
 this.readTask=(async()=>{try{const response=await this.post('gemini-live',{target},this.abort.signal);const reader=response.body.getReader(),decoder=new TextDecoder();while(true){const {value,done}=await reader.read();if(done)break;parser.push(decoder.decode(value,{stream:true}));}if(!this.stopping&&this.active)throw Error('Gemini 串流已中斷');}catch(e){if(this.active&&!this.stopping){if(!ready)reject(e);else this.fail(e);}}finally{clearTimeout(timer);}})();
 });}
 send(audio){if(!this.active||this.stopping)return;if(this.queue.length>=30){this.fail(Error('Gemini 網路速度落後，已停止串流'));return;}this.queue.push(audio);this.pump();}
 async pump(){if(this.sending)return;this.sending=true;try{while(this.queue.length&&this.active){await this.post('gemini-audio',{id:this.id,audio:this.queue.shift()},AbortSignal.timeout(8000));}}catch(e){if(!this.stopping)this.fail(e);}finally{this.sending=false;}}
 fail(e){if(!this.active||this.stopping)return;this.close();this.onFailure(e);}
 async end(){if(!this.active)return;this.stopping=true;const deadline=Date.now()+3500;while((this.sending||this.queue.length)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,30));try{await this.post('gemini-end',{id:this.id},AbortSignal.timeout(3000));await Promise.race([this.readTask,new Promise(r=>setTimeout(r,3000))]);}catch{}this.close();}
 close(){this.active=false;this.queue=[];this.abort?.abort();}
}
