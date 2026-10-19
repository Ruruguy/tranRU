import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserAPI} from './public/api-client.js';
import {SSEParser} from './public/gemini-client.js';

test('hosted visitors have isolated in-memory keys and never return key values',async()=>{
 const requests=[];
 const a=createBrowserAPI({fetcher:async(url,options)=>{requests.push({url,options});return new Response('data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n');}});
 const b=createBrowserAPI();
 const configure=await a('/api/config',{body:JSON.stringify({geminiKey:'visitor-key'})}).then(r=>r.json());
 assert.equal(configure.geminiConfigured,true);assert.doesNotMatch(JSON.stringify(configure),/visitor-key/);
 assert.equal((await b('/api/status').then(r=>r.json())).geminiConfigured,false);
 const response=await a('/api/translate-stream',{body:JSON.stringify({text:'你好',target:'English'})});
 const events=[];new SSEParser((event,data)=>events.push({event,data})).push(await response.text());
 assert.equal(requests.length,1);assert.match(requests[0].url,/^https:\/\/generativelanguage.googleapis.com\//);
 assert.equal(requests[0].options.headers['x-goog-api-key'],'visitor-key');
 assert.equal(events.at(-1).data.translation,'Hello');
 await a('/api/config',{body:JSON.stringify({geminiKey:''})});
 assert.equal((await a('/api/status').then(r=>r.json())).configured,false);
});
test('hosted errors are stream errors and never expose provider keys',async()=>{
 const api=createBrowserAPI({fetcher:async()=>new Response(JSON.stringify({error:{message:'invalid visitor-secret'}}),{status:403})});
 await api('/api/config',{body:JSON.stringify({geminiKey:'visitor-secret'})});
 const response=await api('/api/translate-stream',{body:JSON.stringify({text:'hello'})});
 const content=await response.text();assert.match(content,/event: error/);assert.doesNotMatch(content,/visitor-secret/);assert.match(content,/redacted/);
});
test('hosted OpenAI audio requires its own key without sending a network request',async()=>{
 let requests=0;const api=createBrowserAPI({fetcher:async()=>{requests++;throw Error('unexpected request');}});
 await api('/api/config',{body:JSON.stringify({geminiKey:'gemini-only'})});
 const result=await api('/api/audio-stream',{body:'{}'});assert.equal(result.status,400);assert.equal(requests,0);
});
test('hosted live bridge uses corrected setup and closes Google when consumer cancels',async()=>{
 class Socket extends EventTarget{
  static last;sent=[];bufferedAmount=0;
  constructor(url){super();this.url=url;Socket.last=this;queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
  send(text){const data=JSON.parse(text);this.sent.push(data);if(data.setup)queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:'{"setupComplete":{}}'})));}
  close(){this.closed=true;}
 }
 const api=createBrowserAPI({Socket});await api('/api/config',{body:JSON.stringify({geminiKey:'owned-key'})});
 const response=await api('/api/gemini-live',{body:JSON.stringify({target:'Japanese'})});const reader=response.body.getReader();const chunk=await reader.read();
 assert.match(new TextDecoder().decode(chunk.value),/event: ready/);
 assert.deepEqual(Socket.last.sent[0].setup.inputAudioTranscription,{});
 assert.equal(Socket.last.sent[0].setup.generationConfig.translationConfig.targetLanguageCode,'ja');
 await reader.cancel();assert.equal(Socket.last.closed,true);
});
