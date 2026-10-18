import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
// Raw HTTP preserves an explicit Host header when exercising the reverse-proxy contract.
function fetch(url, options={}) {return new Promise((resolve,reject)=>{
 const req=http.request(url,{method:options.method||'GET',headers:options.headers},res=>{
  const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:Object.fromEntries(Object.entries(res.headers).map(([k,v])=>[k,Array.isArray(v)?v.join('; '):v]))})));
 });req.on('error',reject);req.end(options.body);
});}

test('HTTPS mode requires visitor keys, sets secure cookies and rejects foreign hosts',async t=>{
 const port=8790;
 const processHandle=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),APP_ORIGIN:'https://tranru.example.com',GEMINI_API_KEY:'not-a-real-server-default',OPENAI_API_KEY:'not-a-real-server-default',OPEN_BROWSER:''},stdio:'pipe'});
 t.after(()=>processHandle.kill('SIGTERM'));
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('test server startup timeout')),5000);
  processHandle.on('error',reject);
  processHandle.stdout.on('data',data=>{if(data.toString().includes(String(port))){clearTimeout(timer);resolve();}});
 });
 const base=`http://127.0.0.1:${port}`;
 assert.equal((await fetch(base+'/health')).status,200);
 assert.equal((await fetch(base+'/api/status')).status,403);
 const response=await fetch(base+'/api/status',{headers:{Host:'tranru.example.com'}});
 const status=await response.json();
 assert.equal(status.geminiConfigured,false);assert.equal(status.openaiConfigured,false);
 const cookie=response.headers.get('set-cookie');
 assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Secure/);
 const configured=await fetch(base+'/api/config',{method:'POST',headers:{Host:'tranru.example.com',Origin:'https://tranru.example.com',Cookie:cookie.split(';')[0],'X-Session-Token':status.token,'Content-Type':'application/json'},body:JSON.stringify({geminiKey:'visitor-owned-test-key'})});
 assert.equal(configured.status,200);assert.equal((await configured.json()).geminiConfigured,true);
});
