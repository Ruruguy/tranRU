import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DesktopCaptionClient,desktopCaptionPayload} from './public/desktop-captions.js';
const tick=()=>new Promise(r=>setTimeout(r,5));
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await tick();}assert.fail('Timed out');}
const code='a'.repeat(32),payload={lanes:[{label:'中文',text:'透明字幕測試'}],style:{color:'#ffffff',size:32,lines:3,outline:true}};
test('desktop payload sends captions and styles only, never keys or audio',()=>{
 const data=desktopCaptionPayload({...payload,geminiKey:'private-secret',audio:'private-recording',style:{...payload.style,apiKey:'another-secret'}});
 assert.doesNotMatch(JSON.stringify(data),/private|secret|recording/);assert.deepEqual(data.lanes,payload.lanes.map(l=>({...l,source:false})));
 const bounded=desktopCaptionPayload({lanes:Array.from({length:8},()=>({text:'😀'.repeat(10000)})),style:{color:'bad',size:999,lines:100}});assert.equal(bounded.lanes.length,4);assert.equal(Array.from(bounded.lanes[0].text).length,6000);assert.equal(bounded.style.size,64);assert.equal(bounded.style.lines,5);assert.equal(bounded.style.color,'#ffffff');
});
test('desktop connection authenticates before sending text and coalesces identical updates',async()=>{
 const calls=[],messages=[];const client=new DesktopCaptionClient({intervalMs:1,fetcher:async(url,options)=>{calls.push({url,...options});return Response.json({app:'tranRU-Mac-Overlay',ok:true});},onStatus:m=>messages.push(m)});
 try{await client.connect(code,payload);await until(()=>calls.length===2);assert.ok(calls[0].url.endsWith('/hello'));assert.deepEqual(JSON.parse(calls[0].body),{});assert.ok(calls[1].url.endsWith('/captions'));assert.equal(calls[1].headers.Authorization,'Bearer '+code);assert.equal(calls[1].credentials,'omit');assert.equal(calls[1].targetAddressSpace,'loopback');
  client.send(payload);await tick();assert.equal(calls.length,2);await client.disconnect();assert.equal(JSON.parse(calls.at(-1).body).visible,false);assert.equal(client.active,false);
 }finally{client.close();}
});
test('wrong local service or pairing code never receives caption data',async()=>{
 for(const wrongService of [false,true]){
  const calls=[];const client=new DesktopCaptionClient({fetcher:async(url,options)=>{calls.push(options);return wrongService?Response.json({app:'another-service'}):Response.json({error:'denied'},{status:401});}});
  await assert.rejects(()=>client.connect(code,payload));assert.equal(calls.length,1);assert.deepEqual(JSON.parse(calls[0].body),{});assert.equal(client.active,false);
 }
});
test('temporary local outages retry with the newest captions and stop cancels retry',async()=>{
 let failed=false;const captions=[],client=new DesktopCaptionClient({intervalMs:1,retryMs:25,fetcher:async(url,options)=>{
  if(url.endsWith('/captions')){if(!failed){failed=true;throw Error('offline');}captions.push(JSON.parse(options.body));}return Response.json({app:'tranRU-Mac-Overlay',ok:true});
 }});
 try{await client.connect(code,payload);await until(()=>failed);client.send({...payload,lanes:[{text:'最新字幕'}]});await until(()=>captions.some(p=>p.lanes[0].text==='最新字幕'));assert.equal(captions.at(-1).lanes[0].text,'最新字幕');client.close();const count=captions.length;await tick();assert.equal(captions.length,count);}finally{client.close();}
});
test('closing during authentication prevents late activation and caption upload',async()=>{
 let resolve;const calls=[];const client=new DesktopCaptionClient({fetcher:(url,options)=>{calls.push(url);return new Promise(r=>resolve=r);}});
 const pending=client.connect(code,payload);client.close();resolve(Response.json({app:'tranRU-Mac-Overlay'}));await pending;await tick();assert.equal(client.active,false);assert.equal(calls.length,1);
});
