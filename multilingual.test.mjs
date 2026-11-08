import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {SSEParser} from './public/gemini-client.js';
import {toTaiwanTranscript,isTraditionalChineseTarget} from './public/traditional.js';
const app=readFileSync('public/app.js','utf8');
function fixture(fetcher){
 const records=[],requests=[];
 const s={records,requests,openaiBlocked:false,token:'test',SSEParser,toTaiwanTranscript,isTraditionalChineseTarget,TextDecoder,running:false,gemini:null,lectureAutoMode:()=>true,
  $:()=>({textContent:'',value:'gemini'}),draw(){},persist(){},updateStreamingRow(){},getRecentHistory:()=>[],status(){},classifyServiceError:message=>({message,fatal:false}),
  newRecord(data){const r={id:'r'+records.length,translation:'',state:'pending',...data};records.push(r);return r;},
  fetch:async(url,options)=>{const data=JSON.parse(options.body);requests.push({url,...data});return fetcher(data,url);}
 };
 vm.createContext(s);vm.runInContext(app.slice(app.indexOf('function translateOtherLanguages('),app.indexOf('// Flush accumulated VAD audio')),s);
 return s;
}
const done=text=>new Response(`event: done\ndata: ${JSON.stringify({translation:text})}\n\n`);
const tick=()=>new Promise(r=>setTimeout(r,0));
test('all selected targets start even while primary request stalls, without duplicate children',async()=>{
 let release;const s=fixture(data=>data.target==='English'?new Promise(resolve=>release=resolve):done(data.target));
 const r={id:'source',text:'bonjour',language:'auto',target:'English',secondTarget:'Japanese',thirdTarget:'Traditional Chinese (Taiwan)',sessionId:'session',time:'12:01',context:'medical'};s.records.push(r);
 const work=s.streamRecord(r,'translate-stream',{text:r.text,target:r.target});await tick();
 assert.deepEqual(new Set(s.requests.map(x=>x.target)),new Set(['English','Japanese','Traditional Chinese (Taiwan)']));
 assert.equal(s.records.filter(x=>x.secondary&&x.state==='done').length,2);
 release(done('hello'));await work;assert.equal(s.records.length,3);assert.equal(s.requests.length,3);
 for(const child of s.records.slice(1)){assert.equal(child.parentId,'source');assert.equal(child.time,r.time);assert.equal(child.sessionId,'session');}
});
test('a failing primary translation does not prevent siblings from finishing',async()=>{
 const s=fixture(data=>data.target==='English'?new Response('event: error\ndata: {"error":"translation failure"}\n\n'):done('translated'));
 const r={id:'source',text:'test',language:'auto',target:'English',secondTarget:'Japanese',thirdTarget:'Bengali'};s.records.push(r);
 await s.streamRecord(r,'translate-stream',{text:r.text,target:r.target});await tick();assert.equal(r.state,'error');assert.equal(s.records.filter(x=>x.secondary&&x.state==='done').length,2);
});
test('OpenAI final STT event triggers other columns before primary translation completes',async()=>{
 let controller;const s=fixture((data,url)=>url.endsWith('audio-stream')?new Response(new ReadableStream({start(c){controller=c;c.enqueue(new TextEncoder().encode('event: stt\ndata: {"text":"こんにちは"}\n\n'));}})):done(data.target));
 const r={id:'source',text:'',audio:'fake',language:'auto',target:'English',secondTarget:'Japanese',thirdTarget:'Bengali'};s.records.push(r);
 const work=s.streamRecord(r);await tick();assert.equal(s.requests.length,3);assert.equal(s.requests[1].text,'こんにちは');
 controller.enqueue(new TextEncoder().encode('event: done\ndata: {"translation":"hello"}\n\n'));controller.close();await work;assert.equal(s.requests.length,3);
});
test('language switching keeps target order and sends each finalized utterance to all columns',async()=>{
 const s=fixture(data=>done(data.target));
 for(const [language,text,echoSlot] of [['cmn-Hans-CN','我们讨论休克。',0],['en-US','Assess consciousness.',1],['ja-JP','意識状態を確認してください。',2]]){
  const r={id:'source'+s.records.length,text,language,target:'Traditional Chinese (Taiwan)',secondTarget:'English',thirdTarget:'Japanese'};s.records.push(r);
  const before=s.requests.length;await s.streamRecord(r,'translate-stream',{text:r.text,target:r.target});await tick();
  const group=[r,...s.records.filter(x=>x.parentId===r.id)];assert.deepEqual(group.map(x=>x.target),['Traditional Chinese (Taiwan)','English','Japanese']);
  assert.equal(group[echoSlot].language,language);assert.equal(s.requests.length-before,3);for(const request of s.requests.slice(before))assert.equal(request.text,text);
 }
});
