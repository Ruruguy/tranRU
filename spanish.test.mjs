import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {translationSetup,transcriptionSetup} from './public/gemini-wire.js';
import {sourceForTarget,presentationLanes} from './public/presentation.js';
test('Spanish appears in every lecture and conversation target selector',()=>{
 const html=readFileSync('public/index.html','utf8');
 for(const id of ['target','secondTarget','thirdTarget','convLangA','convLangB','convLangC','convLangD']){
  const select=html.match(new RegExp('<select\\b[^>]*id="'+id+'"[^>]*>([\\s\\S]*?)</select>'))?.[1];
  assert.ok(select,id);assert.equal((select.match(/(?:value="Spanish"|data-target="Spanish")/g)||[]).length,1,id);
 }
});
test('Spanish setup and immediate source routing work with Spain and Latin American speech codes',()=>{
 assert.equal(translationSetup('Spanish').setup.generationConfig.translationConfig.targetLanguageCode,'es');
 assert.deepEqual(transcriptionSetup('es').setup.inputAudioTranscription.languageCodes,['es-ES']);
 for(const language of ['es-ES','es-MX','es-AR']){
  const r={id:'es-1',language,text:'Necesito ayuda.',target:'Spanish',translation:'',state:'streaming'};
  assert.equal(sourceForTarget(r,'Spanish'),'Necesito ayuda.');assert.equal(sourceForTarget(r,'English'),'');
  assert.equal(presentationLanes([r],{targets:['Spanish'],continuous:true,includeSpeaker:true})[1].items[0].text,'Necesito ayuda.');
 }
});

test('every display language selector offers exactly the five requested languages',()=>{
 const html=readFileSync('public/index.html','utf8');
 for(const id of ['target','secondTarget','thirdTarget','convLangA','convLangB','convLangC','convLangD']){
  const select=html.match(new RegExp('<select\\b[^>]*id="'+id+'"[^>]*>([\\s\\S]*?)</select>'))[1];
  const targets=[...select.matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(targets,id.startsWith('conv')?['zh-TW','en-US','ja-JP','bn-BD','es-ES']:['Traditional Chinese (Taiwan)','English','Japanese','Bengali','Spanish']);
 }

});
