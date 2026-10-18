import {test} from 'node:test';
import assert from 'node:assert/strict';
import {translationSetup,openGeminiRelay} from './gemini-live.mjs';
import {SSEParser,PCMChunks,GeminiLiveClient} from './public/gemini-client.js';
test('default fetch preserves the browser global receiver (Illegal invocation regression)',async()=>{
 const original = globalThis.fetch;
 let calls = 0;
 globalThis.fetch = async function(url, options) {
  assert.equal(this,globalThis,'browser fetch must be called on the global object');
  assert.equal(url,'/api/gemini-end');
  assert.equal(options.headers['X-Session-Token'],'local-token');
  calls++;
  return new Response('{}');
 };
 try {
  const client = new GeminiLiveClient({token:'local-token',onEvent:()=>{},onFailure:()=>{}});
  await client.post('gemini-end',{id:'expired'});
  assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
class FakeSocket extends EventTarget {
 static last; sent=[];bufferedAmount=0;
 constructor(url){super();this.url=url;FakeSocket.last=this;}
 send(x){this.sent.push(JSON.parse(x));}
 close(){this.closed=true;}
 message(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
}
test('Gemini setup uses translation protocol, zh-Hant and no unsupported system prompt',()=>{
 const setup=translationSetup('Traditional Chinese (Taiwan)').setup;
 assert.equal(setup.generationConfig.translationConfig.targetLanguageCode,'zh-Hant');
 assert.deepEqual(setup.inputAudioTranscription,{});
 assert.deepEqual(setup.outputAudioTranscription,{});
 assert.equal(setup.generationConfig.inputAudioTranscription,undefined);
 assert.equal(setup.generationConfig.outputAudioTranscription,undefined);
 // Wire-level field allowlist from Google's BidiGenerateContentSetup/GenerationConfig,
 // independent of the implementation's object nesting.
 assert.deepEqual(Object.keys(setup).sort(),['generationConfig','inputAudioTranscription','model','outputAudioTranscription']);
 assert.deepEqual(Object.keys(setup.generationConfig).sort(),['responseModalities','translationConfig']);
 assert.equal(setup.systemInstruction,undefined);
 assert.throws(()=>translationSetup('unknown'));
});
test('relay waits for setup, forwards both transcripts, discards audio, closes upstream',async()=>{
 const events=[];let finished=0;
 const relay=openGeminiRelay({key:'test-secret',target:'English',Socket:FakeSocket,emit:(e,d)=>events.push([e,d]),finish:()=>finished++});
 const ws=FakeSocket.last;
 try{
 assert.throws(()=>relay.audio('AAA='),/尚未/);
 ws.dispatchEvent(new Event('open'));
 assert.equal(ws.sent[0].setup.generationConfig.translationConfig.targetLanguageCode,'en');
 ws.message({setupComplete:{}});relay.audio('AAA=');
 assert.equal(ws.sent[1].realtimeInput.audio.mimeType,'audio/pcm;rate=16000');
 ws.message({serverContent:{inputTranscription:{text:'Hello'},outputTranscription:{text:'你好'},turnComplete:true,modelTurn:{parts:[{inlineData:{data:'SECRET_AUDIO'}}]}}});
 assert.deepEqual(events.map(e=>e[0]),['ready','input','output','turn']);
 assert.doesNotMatch(JSON.stringify(events),/SECRET_AUDIO/);
 relay.end();assert.deepEqual(ws.sent.at(-1),{realtimeInput:{audioStreamEnd:true}});
 }finally{relay.close();}
 assert.equal(finished,1);assert.equal(ws.closed,true);
});
test('Gemini errors redact keys and clean up exactly once',()=>{
 const events=[];let finished=0;
 const relay=openGeminiRelay({key:'secret',target:'Japanese',Socket:FakeSocket,emit:(e,d)=>events.push(d),finish:()=>finished++});
 FakeSocket.last.message({error:{message:'invalid secret'}});
 assert.equal(events[0].error,'invalid [redacted]');assert.equal(finished,1);relay.close();assert.equal(finished,1);
});
test('SSE survives network fragments including split event/data lines',()=>{
 const events=[];const p=new SSEParser((event,data)=>events.push([event,data]));
 for(const fragment of ['event: delta\n','data: {"delta":"繁','體"}\n','\nevent: done\ndata: {}\n\n'])p.push(fragment);
 assert.deepEqual(events,[['delta',{delta:'繁體'}],['done',{}]]);
});
test('PCM outputs independent 100ms mono PCM16 chunks across input blocks',()=>{
 for(const rate of [16000,44100,48000]){
  const pcm=new PCMChunks(rate);let out=[];for(let i=0;i<10;i++)out.push(...pcm.push(new Float32Array(rate/10).fill(.5)));
  assert.equal(out.length,10);assert.equal(Buffer.from(out[0],'base64').length,3200);
  assert.equal(Buffer.from(out[0],'base64').readInt16LE(0),16383);assert.equal(pcm.tail(),null);
 }
});
test('browser client surfaces missing key without calling fallback twice',async()=>{
 let failures=0;const client=new GeminiLiveClient({token:'x',onEvent:()=>{},onFailure:()=>failures++,fetcher:async()=>new Response(JSON.stringify({error:'請先設定 Gemini API 金鑰'}),{status:400})});
 await assert.rejects(client.connect('English'),/金鑰/);client.close();assert.equal(failures,0);
});
test('browser client falls back once on unexpected stream disconnect',async()=>{
 let controller,failures=0;const body=new ReadableStream({start(c){controller=c;c.enqueue(new TextEncoder().encode('event: ready\ndata: {"id":"local"}\n\n'));}});
 const client=new GeminiLiveClient({token:'x',onEvent:()=>{},onFailure:()=>failures++,fetcher:async()=>new Response(body)});
 await client.connect('English');controller.close();await client.readTask;assert.equal(failures,1);assert.equal(client.active,false);
});

test('intentional browser stop drains relay without triggering fallback',async()=>{
 let controller;let failures=0;const calls=[];
 const client=new GeminiLiveClient({token:'x',onEvent:()=>{},onFailure:()=>failures++,fetcher:async(path)=>{
  calls.push(path);
  if(path.endsWith('gemini-live'))return new Response(new ReadableStream({start(c){controller=c;c.enqueue(new TextEncoder().encode('event: ready\ndata: {"id":"local"}\n\n'));}}));
  if(path.endsWith('gemini-end'))controller.close();
  return new Response('{}');
 }});
 await client.connect('English');client.send('AAA=');await client.end();
 assert.equal(failures,0);assert.equal(client.active,false);assert.ok(calls.includes('/api/gemini-end'));
});

test('two target clients share PCM but keep transcripts and failure isolated',async()=>{
 const events=[[],[]], failures=[0,0], controllers=[], uploads=[];
 const clients=[0,1].map(i=>new GeminiLiveClient({token:'x',onEvent:(e,d)=>events[i].push([e,d.text]),onFailure:()=>failures[i]++,fetcher:async(path,options)=>{
  if(path.endsWith('gemini-live'))return new Response(new ReadableStream({start(c){controllers[i]=c;c.enqueue(new TextEncoder().encode(`event: ready\ndata: {"id":"session-${i}"}\n\n`));}}));
  if(path.endsWith('gemini-audio'))uploads.push(JSON.parse(options.body));
  if(path.endsWith('gemini-end'))controllers[i].close();
  return new Response('{}');
 }}));
 try{
  await clients[0].connect('Traditional Chinese (Taiwan)');await clients[1].connect('Japanese');
  clients.forEach(c=>c.send('AAAA'));
  controllers[0].enqueue(new TextEncoder().encode('event: output\ndata: {"text":"你好"}\n\n'));
  controllers[1].enqueue(new TextEncoder().encode('event: output\ndata: {"text":"こんにちは"}\n\n'));
  controllers[1].close();await clients[1].readTask;
  assert.equal(failures[1],1);assert.equal(failures[0],0);assert.equal(clients[0].active,true);
  assert.deepEqual(events[0],[['output','你好']]);assert.deepEqual(events[1],[['output','こんにちは']]);
  assert.deepEqual(uploads.map(x=>x.id).sort(),['session-0','session-1']);
  await clients[0].end();
 }finally{clients.forEach(c=>c.close());}
});
