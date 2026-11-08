import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {SSEParser} from './public/gemini-client.js';
import {indexTranslations,sourceForTarget} from './public/presentation.js';
test('interim speech streams every selected language before final and ignores late canceled output',async()=>{
 const code=readFileSync('public/app.js','utf8');let scheduled,requests=[],streams=[],refreshes=0;
 const record={id:'one',text:'持續發言不等待停頓',target:'English',secondTarget:'Japanese',time:'0'};
 const sandbox={records:[record],precisionRecord:record,interimPreviews:new WeakMap(),indexTranslations,sourceForTarget,AbortController,SSEParser,TextDecoder,token:'test',isTraditionalChineseTarget:()=>false,toTaiwanTranscript:t=>t,
 setTimeout:fn=>{scheduled=fn;return 1;},clearTimeout(){},refreshPresentation(){refreshes++;},fetch:async(url,options)=>{requests.push(JSON.parse(options.body));let controller;const body=new ReadableStream({start(c){controller=c;}});streams.push(controller);return {ok:true,body};}};
 vm.createContext(sandbox);vm.runInContext(code.slice(code.indexOf('function previewDisplayRecords('),code.indexOf('function handlePrecisionEvent(')),sandbox);
 sandbox.scheduleInterimPreview(record);const job=scheduled();await Promise.resolve();await Promise.resolve();
 assert.deepEqual(requests.map(x=>x.target),['English','Japanese']);
 streams[0].enqueue(new TextEncoder().encode('event: delta\ndata: {"delta":"early English"}\n\n'));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(sandbox.previewDisplayRecords()[0].translation,'early English');
 sandbox.cancelInterimPreview(record);
 streams[1].enqueue(new TextEncoder().encode('event: delta\ndata: {"delta":"late Japanese"}\n\n'));
 for(const stream of streams)stream.close();await job;
 assert.ok(!sandbox.previewDisplayRecords().some(x=>x.translation==='late Japanese'));
 assert.ok(refreshes>0);assert.equal(record.translation,undefined,'previews never overwrite saved final transcript');
});
