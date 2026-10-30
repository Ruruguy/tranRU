import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Readable} from 'node:stream';
import {randomBytes} from 'node:crypto';
import {summarize,selectSummaryRecords,summaryRows,summaryTerminal} from './public/summary-core.js';
import {createBrowserAPI} from './public/api-client.js';
import {SSEParser} from './public/gemini-client.js';
const row={sessionId:'current',state:'done',time:'01:02:03',text:'source',translation:'譯文'};
const long=Array.from({length:201},(_,i)=>({...row,text:`ROW_${i}_ ${'字'.repeat(160)}${i===200?' END_MARKER':''}`}));
const excluded=['demo','secondary','pending','error','old'].map(kind=>({...row,text:`EXCLUDE_${kind}`,demo:kind==='demo',secondary:kind==='secondary',state:['pending','error'].includes(kind)?kind:'done',sessionId:kind==='old'?'old':'current'}));
const input={records:[...long,...excluded],sessionId:'current',context:'CONTEXT_REFERENCE'};
const wire=(provider,text='final',reason=provider==='gemini'?'STOP':'stop')=>'data: '+JSON.stringify(provider==='gemini'?{candidates:[{content:{parts:[{text}]},...(reason?{finishReason:reason}:{})}]}:{choices:[{delta:{content:text},...(reason?{finish_reason:reason}:{})}]})+'\r\n\r\n';
const source=await readFile(new URL('./server.mjs',import.meta.url),'utf8');
// Exercise the real request handler without starting a listener or accessing credentials.
async function serverAPI(fetcher){
 const sandbox={process:{env:{}},Buffer,URL,FormData,AbortSignal,TextDecoder,randomBytes,fetch:fetcher,summarize,selectSummaryRecords,summaryTerminal};
 vm.runInNewContext(source.slice(0,source.indexOf('const expiryTimer')).replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(import.meta.url))+'\nglobalThis.handler=createVisitorHandler();',sandbox);
 const call=async(path,{body='{}',method='POST'}={})=>{
  const req=Readable.from([Buffer.from(body)]);Object.assign(req,{url:path,method,headers:{host:'127.0.0.1:8787','x-session-token':token}});
  let status=200,text='';const res={writeHead:s=>{status=s;},write:c=>{text+=c;},end:c=>{text+=c||'';}};
  await sandbox.handler.handle(req,res);return new Response(text,{status});
 };
 let token='';token=(await (await call('/api/status',{method:'GET'})).json()).token;return call;
}
for(const [name,create] of [['browser',async f=>createBrowserAPI({fetcher:f})],['server',serverAPI]]){
 for(const provider of ['gemini','openai']){
  test(`${name} ${provider}: all 201 records, context, timestamps, filtering and final-only output`,async()=>{
   const prompts=[];const api=await create(async(url,options)=>{assert.match(url,provider==='gemini'?/googleapis/:/openai/);const data=JSON.parse(options.body);prompts.push(data.contents?.[0].parts[0].text||data.messages.at(-1).content);return new Response(provider==='openai'?wire(provider,'final',null)+'data: [DONE]\n\n':wire(provider));});
   await api('/api/config',{body:JSON.stringify({key:'fake-openai',geminiKey:'fake-gemini',translationProvider:provider})});
   const result=await (await api('/api/summary',{body:JSON.stringify(input)})).text();
   assert.match(result,/event: done/);assert.doesNotMatch(result,/event: delta|event: error/);assert.ok(prompts.length>2);
   const joined=prompts.join('\n');for(let i=0;i<201;i++)assert.equal(joined.split(`ROW_${i}_ `).length-1,1);
   assert.match(joined,/END_MARKER/);assert.doesNotMatch(joined,/EXCLUDE_/);for(const prompt of prompts)assert.match(prompt,/CONTEXT_REFERENCE/);assert.match(joined,/01:02:03/);
  });
  for(const failure of ['missing','truncated','map-failure'])test(`${name} ${provider}: ${failure} never yields done`,async()=>{
   let calls=0;const api=await create(async()=>{if(failure==='map-failure' && ++calls===2)return new Response('{"error":{"message":"failed segment"}}',{status:503});return new Response(wire(provider,'partial',failure==='missing'?null:failure==='truncated'?(provider==='gemini'?'MAX_TOKENS':'length'):undefined));});
   await api('/api/config',{body:JSON.stringify({key:'fake-openai',geminiKey:'fake-gemini',translationProvider:provider})});
   const result=await (await api('/api/summary',{body:JSON.stringify(failure==='map-failure'?input:{...input,records:[row]})})).text();
   assert.match(result,/event: error/);assert.doesNotMatch(result,/event: done|event: delta/);
  });
 }
}
test('oversized row/context and non-converging reduction visibly fail',async()=>{
 assert.throws(()=>summaryRows([{...row,text:'x'.repeat(12001)}]),/過長/);
 await assert.rejects(summarize({...input,context:'x'.repeat(3001),invoke:()=>assert.fail()}),/背景脈絡過長/);
 await assert.rejects(summarize({...input,budget:400,invoke:async()=> 'x'.repeat(300)}),/層數過多/);
 assert.equal(selectSummaryRecords(excluded,'current').length,0);
 assert.equal(summaryTerminal('openai',{choices:[{finish_reason:'stop'}]}),true);
 assert.throws(()=>summaryTerminal('openai',{choices:[{finish_reason:'content_filter'}]}),/未正常完成/);
 assert.throws(()=>summaryTerminal('gemini',{candidates:[{finishReason:'SAFETY'}]}),/未正常完成/);
});
test('SSE parser normalizes CRLF split across network chunks',()=>{
 const events=[],parser=new SSEParser((...event)=>events.push(event));
 for(const part of ['event: ready\r','\ndata: {}\r','\n\r','\n'])parser.push(part);
 assert.deepEqual(events,[['ready',{}]]);
});
const app=await readFile(new URL('./public/app.js',import.meta.url),'utf8');
test('persistence reloads over 100 records and exposes a persistent quota warning',()=>{
 const nodes=new Map();let stored='';const body={prepend:n=>nodes.set(n.id,n)};
 const sandbox={records:long,summarySessionId:'legacy',localStorage:{setItem:(key,value)=>{stored=value;},getItem:()=>stored},$:id=>nodes.get(id),draw:()=>{},document:{body,createElement:()=>({setAttribute(){},style:{}})}};
 const code=app.slice(app.indexOf('function persist()'),app.indexOf('function getRecentHistory()'));
 vm.runInNewContext(code.replace('// Load previous history','persist();\n// Load previous history'),sandbox);
 assert.equal(sandbox.records.length,201);assert.equal(sandbox.summarySessionId,'current');
 sandbox.localStorage.setItem=()=>{throw Error('quota');};vm.runInNewContext('persist()',sandbox);
 assert.match(nodes.get('storageWarning').textContent,/未完整儲存.*匯出/);assert.equal(JSON.parse(stored).length,201);
});
test('summary UI sends current eligible records and only enables export on a successful final result',async()=>{
 const nodes=Object.fromEntries(['summaryDialog','summaryContent','copySummary','downloadSummary','context','target'].map(id=>[id,{value:id==='context'?'UI_CONTEXT':'',showModal(){}}]));let sent,message='';
 const sandbox={token:'test-token',records:[row,...excluded],summarySessionId:'current',selectSummaryRecords,SSEParser,TextDecoder,$:id=>nodes[id],status:s=>{message=s;},fetch:async(_,options)=>{sent=JSON.parse(options.body);return new Response(message||'event: done\ndata: {"summary":"完整摘要"}\n\n');}};
 vm.runInNewContext(app.slice(app.indexOf('async function generateSummary()'),app.indexOf("if ($('summaryBtn'))")),sandbox);
 await sandbox.generateSummary();assert.equal(sent.records.length,1);assert.equal(sent.context,'UI_CONTEXT');assert.equal(sent.sessionId,'current');assert.equal(nodes.summaryContent.textContent,'完整摘要');assert.equal(nodes.downloadSummary.disabled,false);
 message='event: delta\ndata: {"delta":"partial"}\n\n';await sandbox.generateSummary();assert.match(nodes.summaryContent.textContent,/中斷/);assert.doesNotMatch(nodes.summaryContent.textContent,/partial/);assert.equal(nodes.downloadSummary.disabled,true);assert.equal(nodes.copySummary.disabled,true);
 sandbox.records=excluded;message='';await sandbox.generateSummary();assert.match(message,/當前場次/);
});
