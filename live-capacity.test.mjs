import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {randomBytes} from 'node:crypto';
import vm from 'node:vm';

test('local visitor accepts three live languages, rejects fourth and releases closed sessions',async()=>{
 const source=await readFile(new URL('./server.mjs',import.meta.url),'utf8');
 const relays=[];
 const sandbox={process:{env:{}},Buffer,URL,AbortSignal,TextDecoder,randomBytes,setInterval,clearInterval,
  openGeminiRelay({target,finish}){let closed=false;const relay={target,close(){if(!closed){closed=true;finish();}}};relays.push(relay);return relay;}};
 vm.runInNewContext(source.slice(0,source.indexOf('const expiryTimer')).replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(import.meta.url))+'\nglobalThis.handler=createVisitorHandler();',sandbox);
 let token='';
 async function call(path,data,method='POST'){
  const req=Readable.from([Buffer.from(JSON.stringify(data||{}))]);Object.assign(req,{url:path,method,headers:{host:'127.0.0.1:8787','x-session-token':token}});
  const res=new EventEmitter();Object.assign(res,{status:0,body:'',destroyed:false,writeHead(status){this.status=status;},flushHeaders(){},write(chunk){this.body+=chunk;},end(chunk){if(chunk)this.body+=chunk;}});
  await sandbox.handler.handle(req,res);return res;
 }
 const status=await call('/api/status',{},'GET');token=JSON.parse(status.body).token;
 await call('/api/config',{geminiKey:'test-key'});
 for(const target of ['Traditional Chinese (Taiwan)','English','Bengali'])assert.equal((await call('/api/gemini-live',{target})).status,200);
 assert.equal((await call('/api/gemini-live',{target:'Japanese'})).status,409);
 relays[2].close();assert.equal((await call('/api/gemini-live',{target:'Bengali'})).status,200);
 sandbox.handler.dispose();
});
