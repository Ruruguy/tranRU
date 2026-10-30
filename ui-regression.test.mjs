import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
const app=await readFile(new URL('./public/app.js',import.meta.url),'utf8');
const html=await readFile(new URL('./public/index.html',import.meta.url),'utf8');
test('page module parses and required controls exist in valid UTF-8',()=>{
 assert.equal(spawnSync(process.execPath,['--check','public/app.js']).status,0);
 assert.ok(!html.includes('\ufffd'));
 for(const id of ['start','newSession','summaryBtn','export','clear','autoscroll','secondStatus'])assert.match(html,new RegExp(`id="${id}"`));
 assert.doesNotMatch(html, /name="tranru-mode"/);
});
test('free language mapping distinguishes French from English and locale codes',()=>{
 const sandbox={};vm.runInNewContext(app.slice(app.indexOf('function mapToGoogleLang'),app.indexOf('function applyGlossaryToText')),sandbox);
 for(const [value,expected] of [['French','fr'],['fr-FR','fr'],['English','en'],['Japanese','ja'],['Traditional Chinese (Taiwan)','zh-TW'],['auto','auto']]) assert.equal(sandbox.mapToGoogleLang(value),expected);
});
test('new session preserves old rows and refuses to interrupt in-flight translations',()=>{
 const nodes={clear:{},newSession:{}};let n=0,msg='';
 const sandbox={records:[{state:'done',text:'old'}],summarySessionId:'old',running:false,starting:false,elapsed:0,crypto:{randomUUID:()=>`new-${++n}`},$:id=>nodes[id],status:s=>msg=s,persist(){},draw(){},confirm:()=>true};
 vm.runInNewContext(app.slice(app.indexOf("$('clear').onclick"),app.indexOf("window.addEventListener('beforeunload'")),sandbox);
 sandbox.running=true;nodes.newSession.onclick();assert.equal(sandbox.summarySessionId,'old');
 sandbox.running=false;nodes.newSession.onclick();assert.equal(sandbox.summarySessionId,'new-1');assert.equal(sandbox.records[0].text,'old');assert.match(msg,/保留/);
});
test('Bengali language choices and unsupported Tuvaluan voice guards',async()=>{
 const {translationSetup}=await import('./public/gemini-wire.js');
 assert.equal(translationSetup('Bengali').setup.generationConfig.translationConfig.targetLanguageCode,'bn');
 assert.throws(()=>translationSetup('Tuvaluan'));
 assert.match(html,/<option value="bn">/);
 assert.equal((html.match(/data-target="Tuvaluan"/g)||[]).length,2);
 const nodes={convEngine:{value:'free'},convLangA:{value:'zh-TW'},convLangB:{value:'tvl'},convTextInput:{value:'hello'}};let message='';
 const sandbox={$:id=>nodes[id],convStatus:s=>message=s,configured:true};
 vm.runInNewContext(app.slice(app.indexOf('function sendManualConv('),app.indexOf("if ($('convSendA'))")),sandbox);
 sandbox.sendManualConv('A');assert.match(message,/AI 大模型/);assert.equal(nodes.convTextInput.value,'hello');
 vm.runInNewContext(app.slice(app.indexOf('function startConvSpeech('),app.indexOf('function stopConvSpeech(')),sandbox);
 sandbox.startConvSpeech('A');assert.match(message,/手動文字/);
});
test('three live streams link delayed subtitle turns to the matching original',()=>{
 let id=0;const nodes={target:{value:'Traditional Chinese (Taiwan)'},secondTarget:{value:'Japanese'},thirdTarget:{value:'English'},secondStatus:{}};
 const sandbox={records:[],liveRecord:null,secondLiveRecord:null,thirdLiveRecord:null,liveBatch:'batch',liveTurnCounts:[0,0,0],$:id=>nodes[id],draw(){},persist(){},updateStreamingRow(){},newRecord(data){const r={id:String(++id),text:'',translation:'',...data};sandbox.records.push(r);return r;}};
 vm.runInNewContext(app.slice(app.indexOf('function finishLiveRecord('),app.indexOf('function handleThirdFailure(')),sandbox);
 sandbox.handleGeminiEvent('input',{text:'first'});sandbox.handleGeminiEvent('output',{text:'甲'});sandbox.handleGeminiEvent('turn',{});
 sandbox.handleGeminiEvent('input',{text:'second'});sandbox.handleGeminiEvent('output',{text:'乙'});
 sandbox.handleGeminiEvent('output',{text:'first translation'},3);
 assert.equal(sandbox.records.find(r=>r.languageSlot===3).parentId,sandbox.records.find(r=>r.text==='first').id);
 sandbox.handleGeminiEvent('turn',{},3);sandbox.handleGeminiEvent('output',{text:'second translation'},3);
 assert.equal(sandbox.records.filter(r=>r.languageSlot===3)[1].parentId,sandbox.records.find(r=>r.text==='second').id);
});
