import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ContinuousGeminiClient, GeminiLiveClient} from './public/gemini-client.js';
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(condition){for(let i=0;i<100;i++){if(condition())return;await tick();}assert.fail('Timed out waiting for condition');}
function fixture(options={}){
 const instances=[],events=[],failures=[];
 class Transport {
  constructor(config){Object.assign(this,config);this.queue=[];this.sent=[];this.active=false;instances.push(this);}
  async connect(target,config){this.target=target;this.config=config;this.active=true;await options.connect?.(this,instances.length);}
  send(audio){this.sent.push(audio);}
  async end(){await options.end?.(this);this.active=false;}
  close(){this.active=false;this.closed=true;}
 }
 const client=new ContinuousGeminiClient({token:'fake-token',Client:Transport,onEvent:(event,data)=>events.push([event,data]),onFailure:e=>failures.push(e),rotateMs:60000,retryDelays:[1,2],flushMs:1,...options.settings});
 return {client,instances,events,failures};
}
test('scheduled renewal drains old output, buffers new audio and preserves target/options',async()=>{
 let releaseEnd;const f=fixture({end:t=>new Promise(resolve=>{releaseEnd=()=>{t.onEvent('output',{text:'old subtitle'});t.onEvent('turn',{});resolve();};})});
 try{
  await f.client.connect('English',{mode:'transcribe',language:'zh'});f.client.send('before');
  const recovery=f.client.reconnect(true);await tick();f.client.send('during');
  releaseEnd();await recovery;
  assert.equal(f.instances.length,2);assert.deepEqual(f.instances[0].sent,['before']);assert.deepEqual(f.instances[1].sent,['during']);
  assert.equal(f.instances[1].target,'English');assert.equal(f.instances[1].config.mode,'transcribe');
  assert.ok(f.events.find(([e,d])=>e==='output'&&d.text==='old subtitle'));
  f.instances[0].onEvent('output',{text:'stale'});assert.ok(!f.events.find(([,d])=>d.text==='stale'));
  assert.equal(f.failures.length,0);
 }finally{f.client.close();}
});
test('rotation timer renews repeatedly, and close prevents future renewals',async()=>{
 const f=fixture({settings:{rotateMs:15}});
 await f.client.connect('Japanese');await until(()=>f.instances.length>=3);f.client.close();const count=f.instances.length;
 await new Promise(r=>setTimeout(r,40));assert.equal(f.instances.length,count);
});
test('GoAway coalesces and does not open overlapping replacement sessions',async()=>{
 let release;const f=fixture({end:()=>new Promise(r=>release=r)});
 try{await f.client.connect('English');f.instances[0].onEvent('rotate',{});f.instances[0].onEvent('rotate',{});await tick();assert.equal(f.instances.length,1);release();await f.client.recovery;assert.equal(f.instances.length,2);}finally{f.client.close();}
});
test('transient failures keep retrying until manual stop, but quota and denied keys do not',async()=>{
 const f=fixture({connect:(_,n)=>{if(n===2)throw Error('temporary network failure');}});
 try{await f.client.connect('English');f.instances[0].onFailure(Error('network disconnected'));await f.client.recovery;assert.equal(f.instances.length,3);assert.equal(f.failures.length,0);}finally{f.client.close();}
 for(const message of ['API 429 quota exhausted','Invalid API key','Invalid JSON payload 1007']){
  const g=fixture();await g.client.connect('English');g.instances[0].onFailure(Error(message));assert.equal(g.failures.length,1);assert.equal(g.instances.length,1);g.client.close();
 }
 const exhausted=fixture({connect:(_,n)=>{if(n>1)throw Error('offline');}});
 await exhausted.client.connect('English');exhausted.instances[0].onFailure(Error('offline'));
 await until(()=>exhausted.instances.length>=7);
 assert.equal(exhausted.client.active,true);assert.equal(exhausted.failures.length,0);
 const pending=exhausted.client.recovery;await exhausted.client.end();await pending;
 const count=exhausted.instances.length;await tick();assert.equal(exhausted.instances.length,count);assert.equal(exhausted.client.active,false);
});
test('stop during a pending renewal never revives the session or emits stale text',async()=>{
 let resolveConnect;const f=fixture({connect:(_,n)=>{if(n===2)return new Promise(r=>resolveConnect=r);}});
 await f.client.connect('English');const recovery=f.client.reconnect(true);await until(()=>!!resolveConnect);
 f.client.send('buffered');await f.client.end();resolveConnect();await recovery;
 assert.equal(f.client.active,false);assert.equal(f.instances[1].active,false);assert.equal(f.failures.length,0);
 f.instances[1].onEvent('output',{text:'late'});assert.ok(!f.events.find(([,d])=>d.text==='late'));
});
test('buffer overflow is visible and keeps a bounded queue without replaying sent audio',async()=>{
 let release;const f=fixture({end:()=>new Promise(r=>release=r),settings:{maxBufferedChunks:3}});
 try{await f.client.connect('English');const recovery=f.client.reconnect(true);await tick();for(const chunk of ['a','b','c','d'])f.client.send(chunk);
 assert.equal(f.client.queue.length,3);assert.equal(f.events.filter(([e])=>e==='gap').length,1);release();await recovery;assert.deepEqual(f.instances[1].sent,['b','c','d']);}finally{f.client.close();}
});
test('three simultaneous streams renew independently without exceeding three live transports',async()=>{
 const fixtures=[fixture(),fixture(),fixture()];
 try{await Promise.all(fixtures.map((f,i)=>f.client.connect(['English','Japanese','Bengali'][i])));await Promise.all(fixtures.map(f=>f.client.reconnect(true)));
 assert.equal(fixtures.flatMap(f=>f.instances).filter(t=>t.active).length,3);assert.ok(fixtures.every(f=>f.instances.length===2));}finally{fixtures.forEach(f=>f.client.close());}
});
test('stopping a low-level connection during setup rejects immediately',async()=>{
 const client=new GeminiLiveClient({token:'fake',onEvent(){},onFailure(){},fetcher:(_,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError'))))});
 const promise=client.connect('English');client.close();await assert.rejects(promise,{name:'AbortError'});await client.readTask;
});
test('real SSE transports release the old session before renewal and forward late final output once',async()=>{
 let openSessions=0,total=0;const controllers=new Map(),events=[];
 const client=new ContinuousGeminiClient({token:'fake',rotateMs:60000,onEvent:(e,d)=>events.push([e,d]),onFailure:e=>assert.fail(e.message),fetcher:async(path,options)=>{
  const payload=JSON.parse(options.body);
  if(path.endsWith('gemini-live')){
   assert.equal(openSessions,0);openSessions++;const id=String(++total);
   return new Response(new ReadableStream({start(c){controllers.set(id,c);c.enqueue(new TextEncoder().encode(`event: ready\ndata: {"id":"${id}"}\n\n`));}}));
  }
  if(path.endsWith('gemini-end')){const c=controllers.get(payload.id);c.enqueue(new TextEncoder().encode('event: output\ndata: {"text":"tail"}\n\nevent: turn\ndata: {}\n\n'));c.close();openSessions--;}
  return new Response('{}');
 }});
 try{await client.connect('English');await client.reconnect(true);assert.equal(total,2);assert.equal(events.filter(([e,d])=>e==='output'&&d.text==='tail').length,1);await client.end();assert.equal(openSessions,0);}finally{client.close();}
});

test('repeated brief network outages do not end a lecture before manual stop',async()=>{
 const f=fixture();
 try{
  await f.client.connect('Spanish');
  for(let i=0;i<6;i++){
   f.instances.at(-1).onFailure(Error('temporary disconnect'));
   await f.client.recovery;
   assert.equal(f.client.active,true);assert.equal(f.failures.length,0);
  }
  assert.equal(f.instances.length,7);
  await f.client.end();assert.equal(f.client.active,false);
 }finally{f.client.close();}
});
