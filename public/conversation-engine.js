import {apiFetch} from './api-client.js';
import {ContinuousGeminiClient,PCMChunks,SSEParser} from './gemini-client.js';
import {AzureSpeechClient,validateAzureConfig} from './azure-client.js';
import {sourceForTarget} from './presentation.js';
import {toTaiwanTranscript,isTraditionalChineseTarget} from './traditional.js';
import {classifyServiceError} from './service-errors.js';

export function validateConversationEngine({engine,language,geminiConfigured,openaiConfigured,configured,azureKey,azureRegion,Recognition=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition}){
 if(engine==='precision'&&!geminiConfigured)throw Error('Gemini 專業精準模式需要 Gemini API 金鑰');
 if(engine==='vad'&&!openaiConfigured)throw Error('OpenAI 智慧停頓切段需要 OpenAI API 金鑰');
 if(['precision','azure','native','vad'].includes(engine)&&!configured)throw Error('此模式需要 Gemini 或 OpenAI 文字翻譯金鑰');
 if(engine==='azure')validateAzureConfig(azureKey,azureRegion,language);
 if(['native','free'].includes(engine)){
  if(!Recognition)throw Error('此瀏覽器不支援原生語音辨識，請使用 Chrome／Edge 或其他辨識引擎');
  if(!language||language==='auto')throw Error('原生／免金鑰辨識請先指定「辨識語言」；輪流使用其他語言時，停止後切換語言再啟動');
 }
 if(!['precision','azure','native','free','vad'].includes(engine))throw Error('不支援的對話辨識引擎');
}
const locales={zh:'zh-TW',en:'en-US',ja:'ja-JP',bn:'bn-BD',es:'es-ES',de:'de-DE',fr:'fr-FR'};
export function conversationWav(parts,rate){
 const length=parts.reduce((n,p)=>n+p.length,0),view=new DataView(new ArrayBuffer(44+length*2));
 const str=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
 str(0,'RIFF');view.setUint32(4,36+length*2,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,length*2,true);
 let offset=44;for(const part of parts)for(const value of part){const v=Math.max(-1,Math.min(1,value));view.setInt16(offset,v*(v<0?32768:32767),true);offset+=2;}
 let binary='';for(const b of new Uint8Array(view.buffer))binary+=String.fromCharCode(b);return btoa(binary);
}

// A single recognizer feeds every selected language column. Each utterance keeps
// its own translation revision so late preview results cannot overwrite finals.
export class ConversationRecognition {
 constructor({engine,language='auto',targets,token,azureKey,azureRegion,context='',silenceMs=650,onCaption,onStatus,onFailure,onAudio=()=>{},onSource=()=>{},fetcher=apiFetch,Client=ContinuousGeminiClient,Azure=AzureSpeechClient,Recognition=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition,mediaDevices=globalThis.navigator?.mediaDevices,Audio=globalThis.AudioContext||globalThis.webkitAudioContext,previewMs=600}){
  Object.assign(this,{engine,language,targets,token,azureKey,azureRegion,context,silenceMs,onCaption,onStatus,onFailure,onAudio,onSource,fetcher,Client,Azure,Recognition,mediaDevices,Audio,previewMs});
  this.active=false;this.turns=[];this.controllers=new Set();this.nodes=[];this.frames=[];this.jobs=[];this.samples=0;this.silent=0;this.spoken=false;
 }
 async start(){
  this.active=true;
  try{
   this.stream=await this.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
   if(!this.active){this.stream.getTracks().forEach(t=>t.stop());return;}
   if(!this.stream.getAudioTracks().length)throw Error('未取得麥克風音訊');
   if(['precision','azure'].includes(this.engine)){
    const key=this.azureKey,region=this.azureRegion,Azure=this.Azure;
    const Transport=this.engine==='azure'?class extends Azure{constructor(options){super({...options,key,region});}}:undefined;
    this.client=new this.Client({token:this.token,...(Transport?{Client:Transport}:{}),onEvent:(event,data)=>this.recognitionEvent(event,data),onFailure:error=>this.fail(error)});
    await this.client.connect(this.targets[0],this.engine==='precision'?{mode:'transcribe',language:this.language}:{language:this.language});
    if(!this.active)return;
   }
   this.audio=new this.Audio({sampleRate:16000});await this.audio.resume();if(!this.active){await this.audio.close();return;}
   const input=this.audio.createMediaStreamSource(this.stream),processor=this.audio.createScriptProcessor(2048,1,1),sink=this.audio.createGain();
   this.nodes=[input,processor,sink];sink.gain.value=0;input.connect(processor);processor.connect(sink);sink.connect(this.audio.destination);
   const pcm=new PCMChunks(this.audio.sampleRate);
   processor.onaudioprocess=e=>{
    if(!this.active)return;const samples=e.inputBuffer.getChannelData(0);this.onAudio(samples);
    if(this.client){for(const chunk of pcm.push(samples))this.client.send(chunk);}
    else if(this.engine==='vad')this.captureSegment(samples);
   };
   if(['native','free'].includes(this.engine))this.startNative();
   for(const track of this.stream.getAudioTracks())track.onended=()=>this.fail(Error('麥克風已停止，請重新授權收音'));
   this.onStatus('● 正在聆聽 · 暫停說話不會結束；文字翻譯會隨辨識結果更新');
  }catch(error){this.close();throw error;}
 }
 turn(){const turn={values:this.targets.map(()=>''),source:'',language:this.language,revision:0};this.turns.push(turn);return turn;}
 emit(turn,index,text){if(!this.active||!this.turns.includes(turn))return;turn.values[index]=isTraditionalChineseTarget(this.targets[index])?toTaiwanTranscript(text,'zh'):text;this.onCaption(index,this.turns.map(t=>t.values[index]).filter(Boolean).join('\n'));}
 recognitionEvent(event,data={}){
  if(!this.active)return;
  if(['reconnecting','reconnected','gap'].includes(event)){this.onStatus(event==='reconnected'?'● 已恢復辨識連線，字幕保留':event==='gap'?'部分音訊可能缺字，既有字幕保留':'正在重新連線，持續收音中');return;}
  if(event==='boundary'){if(this.current){clearTimeout(this.current.timer);this.current.controller?.abort();this.current.revision++;this.current=null;}return;}
  if(!['interim','final'].includes(event)||!data.text?.trim())return;
  const turn=this.current||=this.turn();turn.source=toTaiwanTranscript(data.text,data.languageCode||this.language);turn.language=data.languageCode||this.language;
  this.onSource({text:turn.source,language:turn.language});
  this.targets.forEach((target,index)=>{const original=sourceForTarget({language:turn.language,text:turn.source},target);if(original)this.emit(turn,index,original);});
  if(event==='final'){clearTimeout(turn.timer);this.current=null;void this.translate(turn);}
  else if(!turn.timer)turn.timer=setTimeout(()=>{turn.timer=null;void this.translate(turn);},this.previewMs);
 }
 async request(path,data,signal){
  const response=await this.fetcher('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':this.token},body:JSON.stringify(data),signal});
  if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.error||`API ${response.status}`);}return response;
 }
 async read(response,onEvent){
  const reader=response.body.getReader(),decoder=new TextDecoder(),parser=new SSEParser((event,data)=>{if(event==='error')throw Error(data.error||'翻譯失敗');onEvent(event,data);});
  try{while(this.active){const {value,done}=await reader.read();if(done)break;parser.push(decoder.decode(value,{stream:true}));}}
  finally{await reader.cancel().catch(()=>{});}
 }
 async translate(turn,indices=this.targets.map((_,i)=>i)){
  if(!this.active||(this.current===turn&&turn.previewBusy))return;turn.previewBusy=true;clearTimeout(turn.timer);turn.controller?.abort();const controller=new AbortController();turn.controller=controller;this.controllers.add(controller);const revision=++turn.revision,text=turn.source;
  const valid=()=>this.active&&!controller.signal.aborted&&turn.revision===revision;
  try{await Promise.all(indices.map(async index=>{
   const target=this.targets[index],native=sourceForTarget({language:turn.language,text},target);if(native){if(valid())this.emit(turn,index,native);return;}
   if(this.engine==='free'){
    const response=await this.request('free-translate',{text,source:turn.language||'auto',target},controller.signal);const result=await response.json();if(valid())this.emit(turn,index,result.translation||'');
   }else{
    const response=await this.request('translate-stream',{text,target,context:this.context,history:[]},controller.signal);let translated='',complete=false;
    await this.read(response,(event,data)=>{if(event==='delta')translated+=data.delta||'';if(event==='done'){complete=true;if(data.translation!==undefined)translated=data.translation;}if(valid())this.emit(turn,index,translated);});
    if(valid()&&!complete)throw Error('譯文連線提早結束，請核對原聲');
   }
  }));}catch(error){if(valid())this.report(error);}finally{this.controllers.delete(controller);if(turn.revision===revision)turn.previewBusy=false;}
 }
 report(error){if(error.name==='AbortError')return;const classified=classifyServiceError(error.message);if(classified.fatal||/API 40[13]|金鑰無效|quota|RESOURCE_EXHAUSTED|PERMISSION_DENIED/i.test(error.message))this.fail(error);else this.onStatus('翻譯未完成，請核對原文：'+error.message);}
 startNative(){
  if(!this.active)return;const recognition=this.recognizer=new this.Recognition();recognition.lang=locales[this.language]||this.language;recognition.continuous=true;recognition.interimResults=true;
  recognition.onresult=e=>{if(!this.active)return;let interim='';for(let i=e.resultIndex;i<e.results.length;i++){const result=e.results[i];if(result.isFinal)this.recognitionEvent('final',{text:result[0].transcript,languageCode:recognition.lang});else interim+=result[0].transcript;}if(interim)this.recognitionEvent('interim',{text:interim,languageCode:recognition.lang});};
  recognition.onerror=e=>{if(!this.active)return;if(['not-allowed','service-not-allowed','audio-capture','language-not-supported'].includes(e.error))this.fail(Error('瀏覽器語音辨識失敗：'+e.error));else this.onStatus('原生辨識暫時中斷，正在重新連線：'+e.error);};
  recognition.onend=()=>{if(this.active)this.nativeTimer=setTimeout(()=>{try{this.startNative();}catch(error){this.fail(error);}},1000);};recognition.start();
 }
 captureSegment(input){
  let energy=0;for(const v of input)energy+=v*v;const voiced=Math.sqrt(energy/input.length)>=.007;
  this.frames.push(new Float32Array(input));this.samples+=input.length;if(voiced){this.spoken=true;this.silent=0;}else if(this.spoken)this.silent+=input.length;
  const rate=this.audio.sampleRate;
  if(this.samples>=rate*3.5||(this.spoken&&this.samples>=rate&&this.silent>=rate*this.silenceMs/1000)){
   if(this.spoken){if(this.jobs.length>=8){this.jobs.shift();this.onStatus('辨識速度落後，部分音訊可能缺字；既有字幕保留');}this.jobs.push(conversationWav(this.frames,rate));void this.drain();}
   this.frames=[];this.samples=this.silent=0;this.spoken=false;
  }
 }
 async drain(){
  if(this.processing)return;this.processing=true;
  try{while(this.active&&this.jobs.length){
   const controller=new AbortController();this.controllers.add(controller);const timeout=setTimeout(()=>controller.abort(),60000);
   try{
    const response=await this.request('audio-stream',{audio:this.jobs.shift(),language:this.language,target:this.targets[0],context:this.context,history:[]},controller.signal);let turn,translated='',complete=false;
    await this.read(response,(event,data)=>{
     if(event==='stt'&&data.text?.trim()){turn=this.turn();turn.source=toTaiwanTranscript(data.text,this.language);turn.language=this.language;this.onSource({text:turn.source,language:turn.language});this.targets.forEach((target,index)=>{const native=sourceForTarget({language:turn.language,text:turn.source},target);if(native)this.emit(turn,index,native);});void this.translate(turn,this.targets.map((_,i)=>i).slice(1));}
     if(turn){if(event==='delta')translated+=data.delta||'';if(event==='done'){complete=true;if(data.translation!==undefined)translated=data.translation;}if(['delta','done'].includes(event)&&!sourceForTarget({language:turn.language,text:turn.source},this.targets[0]))this.emit(turn,0,translated);}
    });
    if(this.active&&turn&&!complete)throw Error('語音辨識串流未完成，請核對原聲');
   }catch(error){if(this.active)this.report(error);}finally{clearTimeout(timeout);this.controllers.delete(controller);}
  }}finally{this.processing=false;}
 }
 clear(){for(const turn of this.turns){clearTimeout(turn.timer);turn.revision++;turn.controller?.abort();}for(const controller of this.controllers)controller.abort();this.turns=[];this.current=null;this.jobs=[];this.frames=[];this.samples=this.silent=0;this.spoken=false;}
 fail(error){if(!this.active)return;this.close();this.onFailure(error);}
 close(){
  this.active=false;clearTimeout(this.nativeTimer);for(const turn of this.turns)clearTimeout(turn.timer);
  for(const controller of this.controllers)controller.abort();this.controllers.clear();this.client?.close();
  if(this.recognizer){this.recognizer.onend=null;this.recognizer.onresult=null;this.recognizer.onerror=null;try{this.recognizer.abort();}catch{}}
  for(const node of this.nodes){try{node.disconnect();}catch{}}this.nodes=[];
  for(const track of this.stream?.getTracks()||[]){track.onended=null;track.stop();}
  this.audio?.close().catch(()=>{});this.jobs=[];this.frames=[];
 }
}
