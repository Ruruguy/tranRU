import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captionStyle,DEFAULT_CAPTION_STYLE,CAPTION_PRESETS,visibleCaptionLanes,floatingCaptionCSS,renderFloatingCaptions,bindCaptionControls,syncCaptionControls} from './public/floating-captions.js';
const lanes=[{id:'source',label:'講者原文',text:'hello',source:true},{id:'Chinese',label:'中文',text:'你好'},{id:'French',label:'法文',text:'Bonjour'}];
test('floating captions default to one translation language without repeating the original',()=>{
 assert.deepEqual(visibleCaptionLanes(lanes,DEFAULT_CAPTION_STYLE).map(l=>l.id),['Chinese']);
 assert.deepEqual(visibleCaptionLanes(lanes,{language:'French',showSource:true}).map(l=>l.id),['source','French']);
 assert.deepEqual(visibleCaptionLanes(lanes,{language:'all'}).map(l=>l.id),['Chinese','French']);
 assert.deepEqual(visibleCaptionLanes(lanes,{language:'old-selection'}).map(l=>l.id),['Chinese']);
});
test('caption colors and numeric settings are bounded and cannot inject stylesheet rules',()=>{
 const s=captionStyle({color:'red; } body {display:none}',background:'#abcdef',size:1000,lines:-5});
 assert.equal(s.color,'#ffffff');assert.equal(s.background,'#abcdef');assert.equal(s.size,64);assert.equal(s.lines,1);
 assert.doesNotMatch(floatingCaptionCSS(s),/red;|body \{display:none/);assert.match(floatingCaptionCSS(s),/background:#abcdef/);
 assert.equal(captionStyle({size:-2,lines:100}).size,18);assert.equal(captionStyle({lines:100}).lines,5);
 for(const preset of Object.values(CAPTION_PRESETS))assert.match(preset.color,/^#[a-f0-9]{6}$/i);
});
test('rendering preserves Unicode and escapes transcript and language markup',()=>{
 let writes=0,value='';const body={scrollHeight:800,scrollTop:0};
 const container={dataset:{},get innerHTML(){return value;},set innerHTML(s){writes++;value=s;},querySelectorAll:()=>[body]};
 const doc={getElementById:()=>container};
 const unsafe=[{id:'French',label:'<script>bad</script>',text:'<img onerror=bad> Français বাংলা 日本語'}];
 renderFloatingCaptions(doc,unsafe,{});assert.doesNotMatch(value,/<script>|<img /);assert.match(value,/&lt;img/);assert.match(value,/বাংলা/);assert.equal(body.scrollTop,800);
 renderFloatingCaptions(doc,unsafe,{});assert.equal(writes,1,'unchanged captions retain their DOM');
 renderFloatingCaptions(doc,[{...unsafe[0],text:'New subtitle'}],{});assert.equal(writes,2);assert.match(value,/New subtitle/);
});
test('color, size and checkbox controls stay synchronized and emit the selected setting',()=>{
 const fields=[{dataset:{captionKey:'language'}},{dataset:{captionKey:'color'}},{dataset:{captionKey:'outline'},type:'checkbox'}],output={},changes=[];
 const root={querySelectorAll:q=>q==='[data-caption-key]'?fields:[output]};
 syncCaptionControls(root,{...DEFAULT_CAPTION_STYLE,size:40,language:'French'},lanes);assert.equal(output.textContent,'40 px');assert.equal(fields[0].value,'French');assert.match(fields[0].innerHTML,/法文/);assert.equal(fields[2].checked,true);
 bindCaptionControls(root,(key,value)=>changes.push([key,value]));fields[1].value='#abcdef';fields[1].oninput();fields[2].checked=false;fields[2].oninput();assert.deepEqual(changes,[['color','#abcdef'],['outline',false]]);
});
