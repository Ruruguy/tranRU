import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {toTaiwanTranscript} from './public/traditional.js';
test('browser Chinese recognition supplies interim previews and final text to AI translation, ignoring obsolete recognizers',()=>{
 const app=readFileSync('public/app.js','utf8');const nodes={language:{value:'zh'},engine:{value:'native'}};const records=[],previews=[],finals=[];let recognizer;
 class SpeechRecognition{constructor(){recognizer=this;}start(){}}
 const sandbox={window:{SpeechRecognition},$:id=>nodes[id],speechRecognizer:null,running:true,currentNativeRecord:null,toTaiwanTranscript,updateAudioReactiveGlow(){},updateStreamingRow(){},scheduleInterimPreview:r=>previews.push(r.text),cancelInterimPreview(){},getRecentHistory:()=>[],newRecord(data){const r={target:'English',...data};records.push(r);return r;},streamRecord:(r,path)=>finals.push({text:r.text,path}),translateFreeRecord(){},status(){}};
 vm.runInNewContext(app.slice(app.indexOf('function startNativeSpeech()'),app.indexOf('// Free Non-API Translation')),sandbox);
 sandbox.startNativeSpeech();assert.equal(recognizer.lang,'zh-TW');
 const result=(text,isFinal)=>({resultIndex:0,results:[Object.assign([{transcript:text}],{isFinal})]});
 recognizer.onresult(result('今天介绍救护',false));assert.equal(records[0].text,'今天介紹救護');assert.equal(previews.length,1);assert.equal(finals.length,0);
 recognizer.onresult(result('今天介绍救护。',true));assert.equal(finals[0].text,'今天介紹救護。');assert.equal(finals[0].path,'translate-stream');
 sandbox.speechRecognizer=null;recognizer.onresult(result('obsolete',true));assert.equal(finals.length,1);
});
