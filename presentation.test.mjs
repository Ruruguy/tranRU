import {test} from 'node:test';
import assert from 'node:assert/strict';
import {presentationLanes,renderPresentation} from './public/presentation.js';
test('long translations do not displace latest short Chinese or lose transcript records',()=>{
 const records=Array.from({length:1000},(_,i)=>({id:String(i),text:'中文'+i,translation:'English '.repeat(200)+i,state:'done',time:String(i)}));
 records.push({secondary:true,parentId:'999',languageSlot:2,translation:'日本語'.repeat(500),state:'done'});
 const before=JSON.stringify(records),lanes=presentationLanes(records,{dual:true});
 assert.equal(lanes.length,3);assert.equal(lanes[0].items.at(-1).text,'中文999');assert.equal(lanes[0].items.length,3);assert.ok(lanes[1].items.at(-1).text.endsWith('999'));assert.equal(lanes[2].items.length,1);assert.equal(JSON.stringify(records),before);
});
test('late secondary translations cannot replace a newer translated sentence',()=>{
 const records=[{id:'a',text:'甲'},{id:'b',text:'乙'},{secondary:true,parentId:'b',translation:'newer'},{secondary:true,parentId:'a',translation:'late older'}];
 const lanes=presentationLanes(records,{dual:true});assert.deepEqual(lanes[2].items.map(x=>x.text),['late older','newer']);
 records.push({id:'c',text:'丙',state:'pending'});assert.equal(presentationLanes(records,{dual:true})[2].items.at(-1).text,'newer');
});
test('triple layout has original plus three independent languages and keeps errors visible',()=>{
 const r=[{id:'a',text:'原文',translation:'中文',state:'done'},{secondary:true,parentId:'a',translation:'English',state:'done'},{secondary:true,parentId:'a',languageSlot:3,translation:'日本語',state:'error',error:'連線中斷'}];
 const lanes=presentationLanes(r,{dual:true,triple:true,labels:['原文','中文','英文','日文']});assert.equal(lanes.length,4);assert.equal(lanes[3].label,'日文');assert.equal(lanes[3].items[0].error,'連線中斷');assert.equal(lanes[3].state,'連線中斷');
 assert.equal(presentationLanes([]).length,2);
});
test('each pane independently scrolls to its own end on updates and resize',()=>{
 class Element {
  constructor(){this.children=[];this.dataset={};this.scrollHeight=0;this.scrollTop=0;this.classList={toggle(){}};}
  append(...items){this.children.push(...items);}
  replaceChildren(){this.children=[];}
  setAttribute(){}
 }
 const old=globalThis.document;globalThis.document={createElement:()=>new Element()};
 try{
  const container=new Element(),lanes=presentationLanes([{id:'a',text:'中文',translation:'English'}]);
  renderPresentation(container,lanes);
  container.children[0].children[1].scrollHeight=100;
  container.children[1].children[1].scrollHeight=2000;
  renderPresentation(container,lanes);
  assert.equal(container.children[0].children[1].scrollTop,100);assert.equal(container.children[1].children[1].scrollTop,2000);
  const textBody=container.children[0].children[1],paragraph=textBody.children[0];
  renderPresentation(container,lanes);assert.equal(textBody.children[0],paragraph,'unchanged lane DOM retained');
 }finally{globalThis.document=old;}
});
test('display order follows selected languages instead of original generation slots',()=>{
 const records=[{id:'a',text:'原文',target:'Traditional Chinese (Taiwan)',translation:'中文',state:'done'},{secondary:true,parentId:'a',target:'English',translation:'English',state:'done'},{secondary:true,parentId:'a',languageSlot:3,target:'Japanese',translation:'日本語',state:'done'}];
 const lanes=presentationLanes(records,{dual:true,triple:true,targets:['Japanese','Traditional Chinese (Taiwan)','English']});
 assert.deepEqual(lanes.slice(1).map(lane=>lane.items[0].text),['日本語','中文','English']);
 const missing=presentationLanes(records,{targets:['Bengali']});assert.equal(missing[1].items.length,0);
});
test('normal transcript renders reordered streaming translations under the correct headings',async()=>{
 const {readFileSync}=await import('node:fs');const vm=await import('node:vm');const {indexTranslations}=await import('./public/presentation.js');
 class Element{constructor(){this.children=[];this.classList={add(){},contains:()=>false};}append(...x){this.children.push(...x);}replaceChildren(){this.children=[];}}
 const nodes={rows:new Element(),dualTranslation:{checked:true},tripleTranslation:{checked:true},target:{value:'Japanese'},secondTarget:{value:'English'},thirdTarget:{value:'Traditional Chinese (Taiwan)'},count:{},autoscroll:{checked:true}};
 const records=[{id:'a',text:'原文',target:'Traditional Chinese (Taiwan)',translation:'中文',state:'done'},{secondary:true,parentId:'a',target:'English',translation:'English',state:'done'},{secondary:true,parentId:'a',languageSlot:3,target:'Japanese',translation:'日本語',state:'streaming'}];
 const sandbox={records,indexTranslations,$:id=>nodes[id],refreshPresentation(){},document:{body:new Element(),createElement:()=>new Element(),createTextNode:text=>({textContent:text})}};
 const app=readFileSync('public/app.js','utf8');vm.runInNewContext(app.slice(app.indexOf('function draw()'),app.indexOf('function updateStreamingRow(')),sandbox);sandbox.draw();
 assert.deepEqual(nodes.rows.children[0].children.slice(1).map(cell=>cell.textContent),['日本語','English','中文']);
});
test('continuous lecture has exactly three language columns and retains the entire lecture',()=>{
 const records=Array.from({length:1000},(_,i)=>({id:String(i),target:'zh',translation:'中文'+i,state:'done'}));
 records.push({secondary:true,parentId:'999',target:'en',translation:'English '.repeat(500),state:'done'},{secondary:true,parentId:'999',target:'ja',translation:'日本語',state:'done'});
 const lanes=presentationLanes(records,{dual:true,triple:true,targets:['zh','en','ja'],continuous:true});
 assert.equal(lanes.length,3);assert.equal(lanes[0].items.length,1000);assert.equal(lanes[0].items[0].text,'中文0');assert.equal(lanes[0].items.at(-1).text,'中文999');assert.equal(lanes[2].items.at(-1).text,'日本語');
});
