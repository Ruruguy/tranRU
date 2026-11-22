import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ConversationRecognition,validateConversationEngine,conversationWav} from './public/conversation-engine.js';
const tick=()=>new Promise(r=>setTimeout(r,5));
async function until(check){for(let i=0;i<100;i++){if(check())return;await tick();}assert.fail('Timed out');}
const captions={English:'Help.',German:'Hilfe.',French:'Au secours.','Traditional Chinese (Taiwan)':'請幫忙。'};
function stream(text){return new Response(`event: delta\ndata: ${JSON.stringify({delta:text.slice(0,2)})}\n\nevent: done\ndata: ${JSON.stringify({translation:text})}\n\n`);}
function fixture(engine='precision',options={}){
 const clients=[],recognizers=[],requests=[],updates=[],failures=[],statuses=[],processors=[];let stopped=0;
 class Client{constructor(config){Object.assign(this,config);clients.push(this);}async connect(target,options){this.target=target;this.options=options;}send(chunk){this.sent=chunk;}close(){this.closed=true;}}
 class Azure{constructor(options){this.credentials=options;}}
 class Recognition{constructor(){recognizers.push(this);}start(){this.started=true;}abort(){this.aborted=true;}}
 class Audio{sampleRate=16000;destination={};async resume(){}createMediaStreamSource(){return {connect(){},disconnect(){}};}createScriptProcessor(){const p={connect(){},disconnect(){}};processors.push(p);return p;}createGain(){return {gain:{},connect(){},disconnect(){}};}async close(){this.closed=true;}}
 const track={stop(){stopped++;}},audioStream={getTracks:()=>[track],getAudioTracks:()=>[track]};
 const fetcher=async(url,opts)=>{const data=JSON.parse(opts.body);requests.push({url,data,signal:opts.signal});if(url.endsWith('audio-stream'))return new Response(`event: stt\ndata: {"text":"請幫忙。"}\n\nevent: delta\ndata: {"delta":"Help."}\n\nevent: done\ndata: {"translation":"Help."}\n\n`);if(url.endsWith('free-translate'))return Response.json({translation:captions[data.target]});return stream(captions[data.target]);};
 const recognition=new ConversationRecognition({engine,language:'zh',targets:['Traditional Chinese (Taiwan)','English','German','French'],token:'fake-session',azureKey:'fake-azure',azureRegion:'eastasia',Client,Azure,Recognition,Audio,mediaDevices:{getUserMedia:async()=>audioStream},fetcher,onCaption:(index,text)=>updates.push({index,text}),onStatus:t=>statuses.push(t),onFailure:e=>failures.push(e),...options});
 return {recognition,clients,recognizers,requests,updates,failures,statuses,processors,audioStream,get stopped(){return stopped;}};
}
test('conversation and lecture offer the curated four recommended recognition engines',()=>{
 const html=readFileSync('public/index.html','utf8');
 const values=id=>[...html.match(new RegExp('<select id="'+id+'">([\\s\\S]*?)</select>'))[1].matchAll(/value="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(values('engine'),['gemini','precision','free','vad']);
 assert.deepEqual(values('convSpeechEngine'),values('engine'));
});
test('engine requirements reject missing keys and unsupported auto detection before microphone capture',()=>{
 const base={language:'zh',geminiConfigured:true,openaiConfigured:true,configured:true,azureKey:'fake',azureRegion:'eastasia',Recognition:class{}};
 for(const engine of ['precision','vad','azure','native','free'])assert.doesNotThrow(()=>validateConversationEngine({...base,engine}));
 assert.throws(()=>validateConversationEngine({...base,engine:'vad',openaiConfigured:false}),/OpenAI/);
 assert.throws(()=>validateConversationEngine({...base,engine:'precision',geminiConfigured:false}),/Gemini/);
 assert.throws(()=>validateConversationEngine({...base,engine:'native',configured:false}),/金鑰/);
 for(const engine of ['native','free','azure'])assert.throws(()=>validateConversationEngine({...base,engine,language:'auto'}),/指定/);
 assert.doesNotThrow(()=>validateConversationEngine({...base,engine:'free',configured:false,geminiConfigured:false,openaiConfigured:false}));
});
for(const engine of ['precision','azure'])test(`${engine} streams source immediately, translates into every selected column and releases capture`,async()=>{
 const f=fixture(engine);try{
  await f.recognition.start();assert.equal(f.clients.length,1);
  assert.equal(f.clients[0].options.language,'zh');
  if(engine==='precision')assert.equal(f.clients[0].options.mode,'transcribe');
  else assert.equal(new f.clients[0].Client({}).credentials.key,'fake-azure');
  f.clients[0].onEvent('interim',{text:'请帮忙',languageCode:'zh-TW'});
  assert.equal(f.updates.at(-1).index,0);assert.equal(f.updates.at(-1).text,'請幫忙');
  f.clients[0].onEvent('final',{text:'请帮忙。',languageCode:'zh-TW'});
  await until(()=>f.updates.some(x=>x.index===3&&x.text==='Au secours.'));
  assert.deepEqual(f.requests.map(r=>r.data.target).sort(),['English','French','German']);
  f.processors[0].onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(1600)}});
  assert.equal(Buffer.from(f.clients[0].sent,'base64').length,3200);
  f.recognition.close();assert.ok(f.clients[0].closed);assert.equal(f.stopped,1);assert.equal(f.failures.length,0);
 }finally{f.recognition.close();}
});
for(const engine of ['native','free'])test(`${engine} shows interim source and uses the selected text translation route`,async()=>{
 const f=fixture(engine);try{
  await f.recognition.start();const recognizer=f.recognizers[0];assert.equal(recognizer.lang,'zh-TW');
  const result=(text,final)=>({resultIndex:0,results:[Object.assign([{transcript:text}],{isFinal:final})]});
  recognizer.onresult(result('请帮忙',false));assert.equal(f.updates.at(-1).text,'請幫忙');
  recognizer.onresult(result('请帮忙。',true));await until(()=>f.updates.some(x=>x.index===3&&x.text==='Au secours.'));
  assert.ok(f.requests.every(r=>r.url.endsWith(engine==='free'?'free-translate':'translate-stream')));
  recognizer.onend();f.recognition.close();assert.ok(recognizer.aborted);assert.equal(f.failures.length,0);
 }finally{f.recognition.close();}
});
test('OpenAI VAD ignores long silence, sends voiced WAV and translates all four columns',async()=>{
 const f=fixture('vad',{targets:['English','Traditional Chinese (Taiwan)','German','French']});try{
  await f.recognition.start();f.recognition.captureSegment(new Float32Array(56000));assert.equal(f.requests.length,0);assert.equal(f.recognition.active,true);
  f.recognition.captureSegment(new Float32Array(16000).fill(.2));f.recognition.captureSegment(new Float32Array(11200));
  await until(()=>f.updates.some(x=>x.index===3&&x.text==='Au secours.'));
  const audio=f.requests.find(r=>r.url.endsWith('audio-stream'));assert.ok(audio);assert.equal(Buffer.from(audio.data.audio,'base64').toString('ascii',0,4),'RIFF');
  assert.ok(f.updates.some(x=>x.index===0&&x.text==='Help.'));assert.ok(f.updates.some(x=>x.index===1&&x.text==='請幫忙。'));
  assert.equal(f.failures.length,0);
 }finally{f.recognition.close();}
});
test('late interim translation cannot replace a finalized translation',async()=>{
 const requests=[];const f=fixture('precision',{targets:['English'],fetcher:(url,opts)=>new Promise(resolve=>requests.push({resolve,signal:opts.signal}))});
 try{await f.recognition.start();f.clients[0].onEvent('interim',{text:'暫定',languageCode:'zh'});const interim=f.recognition.translate(f.recognition.current);await until(()=>requests.length===1);
  f.clients[0].onEvent('final',{text:'完整原文',languageCode:'zh'});await until(()=>requests.length===2);assert.ok(requests[0].signal.aborted);
  requests[1].resolve(stream('Final'));await until(()=>f.updates.at(-1)?.text==='Final');requests[0].resolve(stream('Stale'));await interim;assert.equal(f.updates.at(-1).text,'Final');
 }finally{f.recognition.close();}
});
test('clearing a conversation prevents in-flight captions from reappearing',async()=>{
 let resolve;const f=fixture('precision',{targets:['English'],fetcher:()=>new Promise(r=>resolve=r)});
 try{await f.recognition.start();f.clients[0].onEvent('final',{text:'原文',languageCode:'zh'});await until(()=>!!resolve);f.recognition.clear();resolve(stream('stale'));await tick();assert.equal(f.updates.length,0);assert.equal(f.recognition.active,true);}
 finally{f.recognition.close();}
});
test('canceling pending microphone permission releases a late stream without starting audio',async()=>{
 let resolve;const f=fixture('native',{mediaDevices:{getUserMedia:()=>new Promise(r=>resolve=r)}});const starting=f.recognition.start();f.recognition.close();resolve(f.audioStream);await starting;assert.equal(f.stopped,1);assert.equal(f.processors.length,0);assert.equal(f.recognizers.length,0);
});
test('WAV encoding preserves mono sample rate and signed PCM samples',()=>{
 const wav=Buffer.from(conversationWav([new Float32Array([-.5,.5])],16000),'base64');assert.equal(wav.readUInt16LE(22),1);assert.equal(wav.readUInt32LE(24),16000);assert.equal(wav.readUInt32LE(40),4);assert.equal(wav.readInt16LE(44),-16384);assert.equal(wav.readInt16LE(46),16383);
});

test('conversation Start dispatches a no-key free engine and Stop closes it while preserving captions',async()=>{
 const {default:vm}=await import('node:vm');
 const source=readFileSync('public/app.js','utf8');const section=source.slice(source.indexOf('let convLiveGeneration='),source.indexOf('// Firefighting, Rescue & EMS Glossary Management'));
 const nodes={};for(const id of ['convLiveStart','convLiveClear','convLiveStatus','convLiveZh','convLiveEn','convLiveJa','convLiveKo','convPanes'])nodes[id]={textContent:'',dataset:{empty:'no'},classList:{add(){},remove(){}}};
 nodes.convSpeechEngine={value:'free'};nodes.convSourceLanguage={value:'zh'};nodes.convLangCount={value:'4'};
 ['Traditional Chinese (Taiwan)','English','German','French'].forEach((target,i)=>nodes['convLang'+String.fromCharCode(65+i)]={selectedOptions:[{dataset:{target}}]});
 let instance,modal=0;nodes.dialog={showModal(){modal++;}};
 class Adapter{constructor(options){this.options=options;instance=this;}async start(){this.options.onCaption(2,'Hilfe.');}close(){this.closed=true;}clear(){}}
 vm.runInNewContext(section,{$:id=>nodes[id],document:{querySelectorAll:()=>[nodes.convSpeechEngine,nodes.convSourceLanguage]},ConversationRecognition:Adapter,validateConversationEngine,geminiConfigured:false,openaiConfigured:false,translationReady:()=>false,azureKey:'',azureRegion:'',token:'fake',window:{SpeechRecognition:class{},speechSynthesis:{cancel(){}},addEventListener(){}},stopConvSpeech(){},updateAudioReactiveGlowFromSamples(){}});
 await nodes.convLiveStart.onclick();assert.equal(modal,0);assert.equal(instance.options.engine,'free');assert.deepEqual([...instance.options.targets],['Traditional Chinese (Taiwan)','English','German','French']);assert.equal(nodes.convLiveJa.textContent,'Hilfe.');
 await nodes.convLiveStart.onclick();assert.ok(instance.closed);assert.equal(nodes.convLiveJa.textContent,'Hilfe.');assert.equal(nodes.convSpeechEngine.disabled,false);
});
