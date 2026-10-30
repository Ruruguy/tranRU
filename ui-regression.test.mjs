import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {toTaiwanTranscript,isTraditionalChineseTarget} from './public/traditional.js';
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
 let id=0;const nodes={target:{value:'Traditional Chinese (Taiwan)'},secondTarget:{value:'Japanese'},thirdTarget:{value:'English'},secondStatus:{},thirdStatus:{}};
 const sandbox={toTaiwanTranscript,isTraditionalChineseTarget,records:[],liveRecord:null,secondLiveRecord:null,thirdLiveRecord:null,liveBatch:'batch',liveTurnCounts:[0,0,0],$:id=>nodes[id],draw(){},persist(){},updateStreamingRow(){},newRecord(data){const r={id:String(++id),text:'',translation:'',...data};sandbox.records.push(r);return r;}};
 vm.runInNewContext(app.slice(app.indexOf('function finishLiveRecord('),app.indexOf('function handleThirdFailure(')),sandbox);
 sandbox.handleGeminiEvent('input',{text:'first'});sandbox.handleGeminiEvent('output',{text:'甲'});sandbox.handleGeminiEvent('turn',{});
 sandbox.handleGeminiEvent('input',{text:'second'});sandbox.handleGeminiEvent('output',{text:'乙'});
 sandbox.handleGeminiEvent('output',{text:'first translation'},3);
 assert.equal(sandbox.records.find(r=>r.languageSlot===3).parentId,sandbox.records.find(r=>r.text==='first').id);
 sandbox.handleGeminiEvent('turn',{},3);sandbox.handleGeminiEvent('output',{text:'second translation'},3);
 assert.equal(sandbox.records.filter(r=>r.languageSlot===3)[1].parentId,sandbox.records.find(r=>r.text==='second').id);
});
test('tab sharing is requested synchronously and tracks close if Gemini fails to connect',async()=>{
 const ids=['start','source','engine','language','target','dualTranslation','secondTarget','tripleTranslation','thirdTarget','fallback','meterFill'];
 const nodes=Object.fromEntries(ids.map(id=>[id,{value:'',checked:false,style:{},disabled:false}]));
 Object.assign(nodes.source,{value:'tab'});Object.assign(nodes.engine,{value:'gemini'});Object.assign(nodes.language,{value:'en'});Object.assign(nodes.target,{value:'English'});
 let active=true,stopped=false,message='';queueMicrotask(()=>{active=false;});
 const media={getAudioTracks:()=>[{}],getTracks:()=>[{stop(){stopped=true;}}]};
 const sandbox={navigator:{mediaDevices:{getDisplayMedia(){assert.equal(active,true,'screen capture must be requested while the click is active');return Promise.resolve(media);}}},$:id=>nodes[id],status:s=>message=s,canStart:()=>true,running:false,starting:false,openaiBlocked:false,openaiConfigured:false,session:0,crypto:{randomUUID:()=> 'batch'},liveBatch:'',liveTurnCounts:[],gemini:null,geminiSecond:null,geminiThird:null,pcm:null,stream:null,ctx:null,token:'',handleGeminiEvent(){},handleGeminiFailure(){},GeminiLiveClient:class{async connect(){throw Error('connection failed')}close(){}},Array,Error};
 vm.runInNewContext(app.slice(app.indexOf("$('start').onclick = async"),app.indexOf('// Manual Text Translation')),sandbox);
 await nodes.start.onclick();assert.equal(stopped,true);assert.match(message,/connection failed/);
});
test('Chinese lecture with Chinese primary and English second retains both subtitle streams',()=>{
 let id=0;const nodes={target:{value:'Traditional Chinese (Taiwan)'},secondTarget:{value:'English'},thirdTarget:{value:'Japanese'},secondStatus:{},thirdStatus:{}};
 const sandbox={toTaiwanTranscript,isTraditionalChineseTarget,records:[],liveRecord:null,secondLiveRecord:null,thirdLiveRecord:null,liveBatch:'b',liveTurnCounts:[0,0,0],$:id=>nodes[id],draw(){},persist(){},updateStreamingRow(){},newRecord(data){const r={id:String(++id),text:'',translation:'',...data};sandbox.records.push(r);return r;}};
 vm.runInNewContext(app.slice(app.indexOf('function finishLiveRecord('),app.indexOf('function handleThirdFailure(')),sandbox);
 sandbox.handleGeminiEvent('input',{text:'大家好'});sandbox.handleGeminiEvent('output',{text:'大家好'});sandbox.handleGeminiEvent('turn',{});
 sandbox.handleGeminiEvent('input',{text:'大家好'},true);sandbox.handleGeminiEvent('output',{text:'Hello everyone'},true);sandbox.handleGeminiEvent('turn',{},true);
 const primary=sandbox.records.find(r=>!r.secondary),english=sandbox.records.find(r=>r.secondary);
 assert.equal(primary.translation,'大家好');assert.equal(english.translation,'Hello everyone');assert.equal(english.parentId,primary.id);
});
test('live Chinese fragments convert after accumulation while Japanese input remains unchanged',()=>{
 const nodes={target:{value:'English'},secondTarget:{value:'Japanese'},thirdTarget:{value:'Bengali'},secondStatus:{},thirdStatus:{}};let id=0;
 const sandbox={toTaiwanTranscript,isTraditionalChineseTarget,records:[],liveRecord:null,secondLiveRecord:null,thirdLiveRecord:null,liveBatch:'b',liveTurnCounts:[0,0,0],$:id=>nodes[id],draw(){},persist(){},updateStreamingRow(){},newRecord(data){const r={id:String(++id),text:'',translation:'',language:'auto',...data};sandbox.records.push(r);return r;}};
 vm.runInNewContext(app.slice(app.indexOf('function finishLiveRecord('),app.indexOf('function handleThirdFailure(')),sandbox);
 sandbox.handleGeminiEvent('input',{text:'我们今天',languageCode:'zh-CN'});sandbox.handleGeminiEvent('input',{text:'开会'});
 assert.equal(sandbox.records[0].text,'我們今天開會');sandbox.handleGeminiEvent('turn',{});
 sandbox.handleGeminiEvent('input',{text:'日本語の会議',languageCode:'ja-JP'});assert.equal(sandbox.records[1].text,'日本語の会議');
});
