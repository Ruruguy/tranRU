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
