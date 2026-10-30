import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {MEDICAL_GLOSSARY,findMedicalTerms,medicalContext} from './public/medical-glossary.js';
import {createBrowserAPI} from './public/api-client.js';
import {SSEParser} from './public/gemini-client.js';
import {toTaiwanTranscript,isTraditionalChineseTarget} from './public/traditional.js';

test('medical glossary matches clinically relevant terms without substring or acronym false positives',()=>{
 assert.ok(MEDICAL_GLOSSARY.length>=120);
 const terms=findMedicalTerms('CPR with ROSC; sepsis and open fracture; pelvic binder',30).map(x=>x.zh);
 for(const term of ['心肺復甦術','自主循環恢復','敗血症','開放性骨折','骨盆固定帶'])assert.ok(terms.includes(term),term);
 assert.equal(findMedicalTerms('the company is processing data',30).some(x=>x.aliases.includes('CPR')),false);
 assert.equal(findMedicalTerms('Sepsiss',30).some(x=>x.zh==='敗血症'),false);
 assert.equal(findMedicalTerms('anaphylaxis',30).some(x=>x.zh==='過敏性休克'),false);
 assert.match(medicalContext('sepsis','context'),/敗血症 = sepsis/);
 assert.equal(medicalContext('music','general background'),'general background');
 assert.ok(medicalContext('sepsis','x'.repeat(6000)).length<=3000);
});

test('browser text translation sends matched terminology and preserves clinical constraints',async()=>{
 let body;const api=createBrowserAPI({fetcher:async(_,options)=>{body=JSON.parse(options.body);return new Response('data: {"candidates":[{"content":{"parts":[{"text":"敗血症"}]},"finishReason":"STOP"}]}\n\n');}});
 await api('/api/config',{body:JSON.stringify({geminiKey:'test-key'})});
 const result=await (await api('/api/translate-stream',{body:JSON.stringify({text:'The patient has sepsis.',target:'Traditional Chinese (Taiwan)'})})).text();
 assert.match(result,/event: done/);assert.match(body.systemInstruction.parts[0].text,/敗血症 = sepsis/);assert.match(body.systemInstruction.parts[0].text,/Preserve negation/);
});

test('optional live terminology refinement replaces text only after complete success',async()=>{
 const app=await readFile(new URL('./public/app.js',import.meta.url),'utf8');
 const record={text:'Patient has sepsis.',target:'Traditional Chinese (Taiwan)',context:'',translation:'初始字幕'};
 const nodes={medicalRefineStatus:{},medicalRefine:{checked:true}};let mode='success',payload;
 const sandbox={records:[record],token:'local',medicalContext,SSEParser,TextDecoder,AbortSignal,toTaiwanTranscript,isTraditionalChineseTarget,$:id=>nodes[id],draw(){},persist(){},fetch:async(_,options)=>{payload=JSON.parse(options.body);return new Response(mode==='success'?'event: done\ndata: {"translation":"病人有敗血症"}\n\n':'event: delta\ndata: {"delta":"partial"}\n\n');}};
 vm.runInNewContext(app.slice(app.indexOf('async function refineMedicalTurn('),app.indexOf('function handleGeminiEvent(')),sandbox);
 await sandbox.refineMedicalTurn(record);assert.match(payload.context,/敗血症 = sepsis/);assert.equal(record.translation,'病人有敗血症');assert.equal(record.translationBeforeMedical,'初始字幕');
 mode='failure';await assert.rejects(sandbox.refineMedicalTurn(record),/未收到完整譯文/);assert.equal(record.translation,'病人有敗血症');
});

test('local streaming applies terminology and refuses incomplete provider output',async()=>{
 const {Readable}=await import('node:stream');const {randomBytes}=await import('node:crypto');const {EventEmitter}=await import('node:events');
 const {summaryTerminal}=await import('./public/summary-core.js');
 const source=await readFile(new URL('./server.mjs',import.meta.url),'utf8');let mode='success',request;
 const sandbox={process:{env:{}},Buffer,URL,AbortSignal,TextDecoder,randomBytes,summaryTerminal,medicalContext,fetch:async(_,options)=>{request=JSON.parse(options.body);const reason=mode==='success'?',"finishReason":"STOP"':'';return new Response(`data: {"candidates":[{"content":{"parts":[{"text":"敗血症"}]}${reason}}]}\n\n`);}};
 vm.runInNewContext(source.slice(0,source.indexOf('const expiryTimer')).replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(import.meta.url))+'\nglobalThis.handler=createVisitorHandler();',sandbox);
 let token='';async function call(path,data,method='POST'){
  const req=Readable.from([Buffer.from(JSON.stringify(data||{}))]);Object.assign(req,{url:path,method,headers:{host:'127.0.0.1:8787','x-session-token':token}});
  const res=new EventEmitter();Object.assign(res,{status:0,body:'',writeHead(s){this.status=s;},write(c){this.body+=c;},end(c){if(c)this.body+=c;}});await sandbox.handler.handle(req,res);return res;
 }
 token=JSON.parse((await call('/api/status',{},'GET')).body).token;await call('/api/config',{geminiKey:'test-key'});
 const good=await call('/api/translate-stream',{text:'A patient has sepsis.',target:'Traditional Chinese (Taiwan)'});assert.match(good.body,/event: done/);assert.match(request.systemInstruction.parts[0].text,/敗血症 = sepsis/);
 mode='failure';const partial=await call('/api/translate-stream',{text:'sepsis',target:'Traditional Chinese (Taiwan)'});assert.match(partial.body,/event: error/);assert.doesNotMatch(partial.body,/event: done/);
});
