import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AzureSpeechClient,azurePhrases,validateAzureConfig} from './public/azure-client.js';
import {ContinuousGeminiClient} from './public/gemini-client.js';
function fixture(options={}) {
 const events=[],failures=[],instances=[];let settings,format,telemetry;
 const sdk={Recognizer:{enableTelemetry:v=>telemetry=v},SpeechConfig:{fromSubscription:(key,region)=>settings={key,region}},AudioStreamFormat:{getWaveFormatPCM:(...args)=>{format=args;return args;}},AudioInputStream:{createPushStream:()=>({writes:[],write(b){this.writes.push(b);},close(){}})},AudioConfig:{fromStreamInput:()=>({close(){}})},PhraseListGrammar:{fromRecognizer:r=>({addPhrase:p=>r.phrases.push(p)})},ResultReason:{RecognizedSpeech:3,NoMatch:0},CancellationErrorCode:{AuthenticationFailure:1,TooManyRequests:3,ConnectionFailure:4,ServiceTimeout:5,ServiceError:6},SpeechRecognizer:class{constructor(){this.phrases=[];instances.push(this);}startContinuousRecognitionAsync(){queueMicrotask(()=>this.sessionStarted());}close(){this.closed=true;}}};
 const config={key:'test-placeholder',region:'eastasia',loadSDK:async()=>sdk,onEvent:(e,d)=>events.push([e,d]),onFailure:e=>failures.push(e),...options};
 return {sdk,config,events,failures,instances,get settings(){return settings;},get format(){return format;},get telemetry(){return telemetry;}};
}
test('Azure uses Taiwan Chinese, medical hints, PCM16 and disables telemetry',async()=>{
 const f=fixture(),client=new AzureSpeechClient(f.config);
 try{
  await client.connect('English',{language:'zh'});assert.equal(f.settings.speechRecognitionLanguage,'zh-TW');assert.equal(f.telemetry,false);assert.deepEqual(f.format,[16000,16,1]);assert.ok(f.instances[0].phrases.includes('休克'));assert.ok(f.instances[0].phrases.includes('意識不清'));
  client.send(btoa('\x00\x01'));assert.deepEqual([...new Uint8Array(client.input.writes[0])],[0,1]);
  f.instances[0].recognizing(null,{result:{text:'休'}});f.instances[0].recognized(null,{result:{text:'休克',reason:3}});assert.deepEqual(f.events.map(x=>x[0]),['interim','final']);assert.equal(f.events[1][1].languageCode,'zh-TW');
  client.close();f.instances[0].recognized(null,{result:{text:'late',reason:3}});assert.equal(f.events.length,2);
 }finally{client.close();}
});
test('Azure invalid configuration fails before SDK loading, phrases follow source language',async()=>{
 assert.throws(()=>validateAzureConfig('placeholder','https://malicious.invalid','zh'),/區域/);assert.throws(()=>validateAzureConfig('placeholder','eastasia','auto'),/指定/);assert.throws(()=>validateAzureConfig('','eastasia','zh'),/金鑰/);
 assert.ok(azurePhrases('en').includes('shock'));assert.ok(azurePhrases('ja').includes('ショック'));assert.deepEqual(azurePhrases('ko'),[]);
});
test('Azure authentication errors are sanitized and never retried',async()=>{
 const f=fixture();const Client=class extends AzureSpeechClient{constructor(opts){super({...f.config,...opts});}};
 const client=new ContinuousGeminiClient({...f.config,Client});
 try{await client.connect('English',{language:'zh'});f.instances[0].canceled(null,{errorCode:1,errorDetails:'secret-credential'});assert.equal(f.failures.length,1);assert.match(f.failures[0].message,/驗證/);assert.doesNotMatch(f.failures[0].message,/secret/);assert.equal(client.active,false);assert.equal(f.instances.length,1);}finally{client.close();}
});
test('Azure transient disconnect replaces transport and preserves final callbacks',async()=>{
 const f=fixture();const Client=class extends AzureSpeechClient{constructor(opts){super({...f.config,...opts});}};
 const client=new ContinuousGeminiClient({...f.config,Client});
 try{await client.connect('English',{language:'zh'});f.instances[0].canceled(null,{errorCode:4});client.send(btoa('aa'));await client.recovery;assert.equal(f.instances.length,2);assert.equal(client.client.input.writes.length,1);f.instances[1].recognized(null,{result:{text:'恢復',reason:3}});assert.ok(f.events.some(([event])=>event==='final'));assert.ok(f.events.some(([event])=>event==='gap'));assert.equal(f.failures.length,0);}finally{client.close();}
});
test('Azure stop drains final transcript, closes resources and cancels a pending start',async()=>{
 const f=fixture(),client=new AzureSpeechClient(f.config);await client.connect('English',{language:'en'});
 const end=client.end();f.instances[0].recognized(null,{result:{text:'final words',reason:3}});f.instances[0].sessionStopped();await end;assert.equal(client.active,false);assert.equal(f.instances[0].closed,true);assert.equal(f.events[0][1].text,'final words');
 let resolve;const pending=new AzureSpeechClient({...f.config,loadSDK:()=>new Promise(r=>resolve=r)});const connecting=pending.connect('English',{language:'en'});pending.close();resolve(f.sdk);await assert.rejects(connecting,{name:'AbortError'});
});
