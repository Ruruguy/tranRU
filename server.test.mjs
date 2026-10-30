import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

const testPort = 8789;
const base = `http://127.0.0.1:${testPort}`;

test('server integration & SSE contract test', async (t) => {
  let cookie = '';
  const fetch = async (url, options={}) => {
    const headers = new Headers(options.headers);
    if(cookie)headers.set('Cookie',cookie);
    const response=await globalThis.fetch(url,{...options,headers});
    const setCookie=response.headers.get('set-cookie');
    if(setCookie)cookie=setCookie.split(';')[0];
    return response;
  };
  // Spawn test server instance
  const serverProcess = spawn('node', ['server.mjs'], {
    env: {...process.env, PORT: String(testPort), OPENAI_API_KEY: '', GEMINI_API_KEY: '', OPEN_BROWSER: '', APP_ORIGIN: ''},
    stdio: 'pipe'
  });

  // Wait for server to be ready
  await new Promise((resolve, reject) => {
    serverProcess.stdout.on('data', (d) => {
      if (d.toString().includes(String(testPort))) resolve();
    });
    serverProcess.on('error', reject);
    setTimeout(() => resolve(), 1500);
  });

  t.after(() => {
    serverProcess.kill('SIGTERM');
  });

  // 1. Status check
  const s = await fetch(base + '/api/status').then(r => r.json());
  assert.equal(typeof s.token, 'string');
  assert.equal(s.configured, false);
  assert.equal(s.geminiConfigured, false);
  const missingCheck=await fetch(base+'/api/gemini-check',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':s.token},body:'{}'});
  assert.equal(missingCheck.status,400);
  assert.equal(s.openaiConfigured, false);
  const post = (path, data) => fetch(base + path, {method:'POST', headers:{'Content-Type':'application/json','X-Session-Token':s.token},body:JSON.stringify(data)});
  assert.equal((await post('/api/gemini-live',{target:'English'})).status,400);
  assert.equal((await post('/api/gemini-audio',{id:'expired',audio:'AAA='})).status,410);
  const configuredGemini = await (await post('/api/config',{geminiKey:'test-key-not-real'})).json();
  assert.equal(configuredGemini.geminiConfigured,true);
  const other=await globalThis.fetch(base+'/api/status');
  const otherStatus=await other.json();
  assert.equal(otherStatus.geminiConfigured,false);
  assert.notEqual(otherStatus.token,s.token);
  const otherCookie=other.headers.get('set-cookie').split(';')[0];
  const cross=await globalThis.fetch(base+'/api/config',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':s.token,Cookie:otherCookie},body:JSON.stringify({geminiKey:'cross-visitor-test'})});
  assert.equal(cross.status,403);
  assert.equal((await fetch(base+'/api/status').then(r=>r.json())).geminiConfigured,true);
  const crossOrigin=await fetch(base+'/api/config',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':s.token,Origin:'https://untrusted.invalid'},body:'{}'});
  assert.equal(crossOrigin.status,403);
  assert.equal(configuredGemini.openaiConfigured,false);
  assert.doesNotMatch(JSON.stringify(configuredGemini),/test-key-not-real/);
  assert.equal((await fetch(base+'/gemini-client.js')).status,200);
  assert.equal(typeof s.model, 'string');
  assert.equal(typeof s.speech, 'string');

  // 2. Static HTML check
  const page = await fetch(base);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /tranRU/);
  assert.equal((await fetch(base + '/summary-core.js')).status, 200);

  // 3. CSRF token protection
  const forbidden = await fetch(base + '/api/translate-stream', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({text: 'hello'})
  });
  assert.equal(forbidden.status, 403);

  // 4. Missing key rejection
  const noKey = await fetch(base + '/api/translate-stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Token': s.token
    },
    body: JSON.stringify({text: 'hello'})
  });
  // Since test-key-not-real was configured above for gemini, let's reset keys
  await post('/api/config', {geminiKey: '', key: ''});
  const noKeyAfterReset = await fetch(base + '/api/translate-stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Token': s.token
    },
    body: JSON.stringify({text: 'hello'})
  });
  assert.equal(noKeyAfterReset.status, 400);
  assert.match((await noKeyAfterReset.json()).error, /金鑰/);

  // 5. Summary validation
  const emptySummary = await post('/api/summary', {records: []});
  assert.equal(emptySummary.status, 400);

  // 6. Config update
  const configRes = await fetch(base + '/api/config', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Token': s.token
    },
    body: JSON.stringify({model: 'gpt-4o', speech: 'whisper-1'})
  });
  assert.equal(configRes.status, 200);
  const updatedStatus = await fetch(base + '/api/status').then(r => r.json());
  assert.equal(updatedStatus.model, 'gpt-4o');
  assert.equal(updatedStatus.speech, 'whisper-1');

  // 7. Security 404 for forbidden paths
  const notFound = await fetch(base + '/server.mjs');
  assert.equal(notFound.status, 404);
});
