import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('three-language conversation shares audio, routes transcripts and closes all sessions',async()=>{
 const code=readFileSync('public/app.js','utf8');
 const section=code.slice(code.indexOf('let convLiveGeneration='),code.indexOf('// Firefighting, Rescue & EMS Glossary Management'));
 const ids=['convLiveStart','convLiveClear','convLiveStatus','convDetected','convLiveSource','convLiveZh','convLiveEn','convLiveJa'];
 const nodes=Object.fromEntries(ids.map(id=>[id,{textContent:'',dataset:{},disabled:false}]));
 const clients=[];let stopped=false,processor;
 class Client{constructor(o){Object.assign(this,o);this.sent=[];clients.push(this);}async connect(target){this.target=target;}send(c){this.sent.push(c);}close(){this.closed=true;}}
 class AudioContext{constructor(){this.sampleRate=16000;}async resume(){}createMediaStreamSource(){return {connect(){},disconnect(){}};}createScriptProcessor(){return processor={connect(){},disconnect(){}};}createGain(){return {gain:{},connect(){},disconnect(){}};}async close(){}}
 const track={stop(){stopped=true;}};
 const sandbox={document:{},$:id=>nodes[id],token:'fake',geminiConfigured:true,GeminiLiveClient:Client,PCMChunks:class{push(){return ['pcm'];}},isTraditionalChineseTarget:t=>t.includes('Chinese'),toTaiwanTranscript:t=>t,navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]})}},window:{AudioContext,speechSynthesis:{cancel(){}},addEventListener(){}},stopConvSpeech(){}};
 vm.runInNewContext(section,sandbox);
 await nodes.convLiveStart.onclick();
 assert.deepEqual(clients.map(c=>c.target),['Traditional Chinese (Taiwan)','English','Japanese']);
 processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(2)}});
 assert.ok(clients.every(c=>c.sent[0]==='pcm'));
 clients[0].onEvent('input',{text:'休克',languageCode:'zh-TW'});
 clients[1].onEvent('output',{text:'shock'});
 assert.equal(nodes.convDetected.textContent,'中文');assert.equal(nodes.convLiveSource.textContent,'休克');assert.equal(nodes.convLiveEn.textContent,'shock');
 clients[0].onEvent('turn',{});clients[1].onEvent('output',{text:' delayed'});
 assert.equal(nodes.convLiveEn.textContent,'shock delayed');
 await nodes.convLiveStart.onclick();assert.equal(nodes.convLiveEn.textContent,'shock delayed');assert.ok(stopped);assert.ok(clients.every(c=>c.closed));
});

test('four-language conversation respects reordered selections and independent late outputs',async()=>{
 const code=readFileSync('public/app.js','utf8');
 const section=code.slice(code.indexOf('let convLiveGeneration='),code.indexOf('// Firefighting, Rescue & EMS Glossary Management'));
 const ids=['convLiveStart','convLiveClear','convLiveStatus','convDetected','convLiveSource','convLiveZh','convLiveEn','convLiveJa','convLiveKo'];
 const nodes=Object.fromEntries(ids.map(id=>[id,{textContent:'',dataset:{},disabled:false}]));
 nodes.convLangCount={value:'4'};
 for(const [letter,target,code] of [['A','Japanese','ja-JP'],['B','Traditional Chinese (Taiwan)','zh-TW'],['C','English','en-US'],['D','Korean','ko-KR']])nodes['convLang'+letter]={value:code,selectedOptions:[{dataset:{target}}]};
 const clients=[];let stopped=false,processor;
 class Client{constructor(o){Object.assign(this,o);this.sent=[];clients.push(this);}async connect(target){this.target=target;}send(c){this.sent.push(c);}close(){this.closed=true;}}
 class AudioContext{constructor(){this.sampleRate=16000;}async resume(){}createMediaStreamSource(){return {connect(){},disconnect(){}};}createScriptProcessor(){return processor={connect(){},disconnect(){}};}createGain(){return {gain:{},connect(){},disconnect(){}};}async close(){}}
 const track={stop(){stopped=true;}};
 const sandbox={document:{},$:id=>nodes[id],token:'fake',geminiConfigured:true,GeminiLiveClient:Client,PCMChunks:class{push(){return ['pcm'];}},isTraditionalChineseTarget:t=>t.includes('Chinese'),toTaiwanTranscript:t=>t,navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]})}},window:{AudioContext,speechSynthesis:{cancel(){}},addEventListener(){}},stopConvSpeech(){}};
 vm.runInNewContext(section,sandbox);
 await nodes.convLiveStart.onclick();
 assert.deepEqual(clients.map(c=>c.target),['Japanese','Traditional Chinese (Taiwan)','English','Korean']);
 processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(2)}});
 assert.ok(clients.every(c=>c.sent[0]==='pcm'));
 clients[0].onEvent('input',{text:'休克',languageCode:'zh-TW'});
 clients[2].onEvent('output',{text:'shock'});
 assert.equal(nodes.convDetected.textContent,'中文');assert.equal(nodes.convLiveSource.textContent,'休克');assert.equal(nodes.convLiveJa.textContent,'shock');
 clients[0].onEvent('turn',{});clients[2].onEvent('output',{text:' delayed'});
 assert.equal(nodes.convLiveJa.textContent,'shock delayed');
 await nodes.convLiveStart.onclick();assert.equal(nodes.convLiveJa.textContent,'shock delayed');assert.ok(stopped);assert.ok(clients.every(c=>c.closed));
});
