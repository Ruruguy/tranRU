import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {translationSetup,transcriptionSetup} from './public/gemini-wire.js';
import {sourceForTarget,presentationLanes} from './public/presentation.js';
import {AZURE_LANGUAGES,validateAzureConfig} from './public/azure-client.js';
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

test('every display language selector offers exactly the seven requested languages',()=>{
 const html=readFileSync('public/index.html','utf8');
 for(const id of ['target','secondTarget','thirdTarget','convLangA','convLangB','convLangC','convLangD']){
  const select=html.match(new RegExp('<select\\b[^>]*id="'+id+'"[^>]*>([\\s\\S]*?)</select>'))[1];
  const targets=[...select.matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(targets,id.startsWith('conv')?['zh-TW','en-US','ja-JP','bn-BD','es-ES','de-DE','fr-FR']:['Traditional Chinese (Taiwan)','English','Japanese','Bengali','Spanish','German','French']);
 }

});

for(const [target,code,sentence] of [['Spanish','es-MX','Estoy hablando'],['German','de-AT','Ich spreche'],['French','fr-CA','Je parle']]) for(const slot of [0,1,2]) test(`lecture streams ${target} in selectable translation slot ${slot+1}`,()=>{
 const translation=target==='German'?'Ich brauche Hilfe.':target==='French'?"J’ai besoin d’aide.":'Necesito ayuda.';
 const partial=translation.slice(0,6);
 const targets=['Traditional Chinese (Taiwan)','English','Japanese'];targets[slot]=target;
 const primary={id:'lecture-1',text:'需要協助',language:'zh-TW',target:targets[0],translation:slot===0?translation:'',state:'streaming'};
 const records=[primary];
 if(slot>0)records.push({id:'translation-1',parentId:primary.id,secondary:true,languageSlot:slot+1,target,translation:partial,state:'streaming'});
 let lanes=presentationLanes(records,{dual:true,triple:true,targets,continuous:true,includeSpeaker:true});
 assert.equal(lanes[slot+1].items[0].text,slot===0?translation:partial);
 const translatedRecord=records.at(-1);translatedRecord.translation=translation;
 lanes=presentationLanes(records,{dual:true,triple:true,targets,continuous:true,includeSpeaker:true});
 assert.equal(lanes[slot+1].items[0].text,translation);
 const native={id:'native',language:code,text:sentence,target:targets[0],state:'streaming'};
 lanes=presentationLanes([native],{dual:true,triple:true,targets,continuous:true,includeSpeaker:true});
 assert.equal(lanes[slot+1].items[0].text,sentence);
});

for(const [target,code,locales,sentence] of [
 ['German','de',['de-DE','de-AT','de-CH'],'Ich brauche Hilfe.'],
 ['French','fr',['fr-FR','fr-CA','fr-BE'],"J’ai besoin d’aide."],
]) test(`${target} configures live translation, transcription and regional source routing`,()=>{
 assert.equal(translationSetup(target).setup.generationConfig.translationConfig.targetLanguageCode,code);
 const locale=code+'-'+code.toUpperCase();
 assert.deepEqual(transcriptionSetup(code).setup.inputAudioTranscription.languageCodes,[locale]);
 assert.doesNotThrow(()=>validateAzureConfig('fake-key','eastasia',code));
 assert.equal(AZURE_LANGUAGES[code],locale);
 for(const locale of locales){
  assert.equal(sourceForTarget({language:locale,text:sentence},target),sentence);
  assert.equal(sourceForTarget({language:locale,text:sentence},'Spanish'),'');
 }
});
