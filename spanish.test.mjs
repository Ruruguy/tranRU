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

for(const slot of [0,1,2]) test(`lecture streams Spanish in selectable translation slot ${slot+1}`,()=>{
 const targets=['Traditional Chinese (Taiwan)','English','Japanese'];targets[slot]='Spanish';
 const primary={id:'lecture-1',text:'需要協助',language:'zh-TW',target:targets[0],translation:slot===0?'Necesito ayuda.':'',state:'streaming'};
 const records=[primary];
 if(slot>0)records.push({id:'spanish-1',parentId:primary.id,secondary:true,languageSlot:slot+1,target:'Spanish',translation:'Necesito',state:'streaming'});
 let lanes=presentationLanes(records,{dual:true,triple:true,targets,continuous:true,includeSpeaker:true});
 assert.equal(lanes[slot+1].items[0].text,slot===0?'Necesito ayuda.':'Necesito');
 const spanishRecord=records.at(-1);spanishRecord.translation='Necesito ayuda.';
 lanes=presentationLanes(records,{dual:true,triple:true,targets,continuous:true,includeSpeaker:true});
 assert.equal(lanes[slot+1].items[0].text,'Necesito ayuda.');
 const native={id:'native',language:'es-MX',text:'Estoy hablando',target:targets[0],state:'streaming'};
 lanes=presentationLanes([native],{dual:true,triple:true,targets,continuous:true,includeSpeaker:true});
 assert.equal(lanes[slot+1].items[0].text,'Estoy hablando');
});
