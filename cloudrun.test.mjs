import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';

function fetchRaw(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {method: options.method || 'GET', headers: options.headers}, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), {
        status: res.statusCode,
        headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join('; ') : v]))
      })));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

test('Cloud Run contract: accepts *.run.app hosts, strictly isolates server keys, sets secure cookies behind HTTPS proxy', async t => {
  const port = 8792;
  const processHandle = spawn(process.execPath, ['server.mjs'], {
    env: {
      ...process.env,
      PORT: String(port),
      K_SERVICE: 'tranru',
      K_REVISION: 'tranru-00001',
      NODE_ENV: 'production',
      GEMINI_API_KEY: 'owner-private-key-must-never-be-exposed',
      OPENAI_API_KEY: 'owner-private-key-must-never-be-exposed',
      OPEN_BROWSER: ''
    },
    stdio: 'pipe'
  });
  t.after(() => processHandle.kill('SIGTERM'));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Cloud Run test server startup timeout')), 5000);
    processHandle.on('error', reject);
    processHandle.stdout.on('data', data => {
      if (data.toString().includes(String(port))) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  const base = `http://127.0.0.1:${port}`;

  // 1. Health check must pass on any host (Cloud Run probe)
  const healthRes = await fetchRaw(base + '/health');
  assert.equal(healthRes.status, 200);

  // 2. Untrusted random foreign host must be rejected with 403
  const forbiddenRes = await fetchRaw(base + '/api/status', {
    headers: {Host: 'evil-attacker.example.com'}
  });
  assert.equal(forbiddenRes.status, 403);

  // 3. Cloud Run assigned domain (*.run.app) must be accepted
  const cloudRunHost = 'tranru-7x2d-de.a.run.app';
  const statusRes = await fetchRaw(base + '/api/status', {
    headers: {
      Host: cloudRunHost,
      'x-forwarded-proto': 'https'
    }
  });
  assert.equal(statusRes.status, 200);
  const status = await statusRes.json();

  // 4. CRITICAL: Server-level keys must NEVER be exposed or used on Cloud Run (visitor-owned keys only)
  assert.equal(status.geminiConfigured, false, 'Server Gemini key must remain strictly private and unconfigured for visitors');
  assert.equal(status.openaiConfigured, false, 'Server OpenAI key must remain strictly private and unconfigured for visitors');

  // 5. Secure cookie flag must be present behind Cloud Run HTTPS proxy
  const cookie = statusRes.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
});
