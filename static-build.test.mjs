import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,readdir,access} from 'node:fs/promises';
test('static deployment versions the bootstrap and every local JS dependency',async()=>{
 execFileSync(process.execPath,['scripts/build-static.mjs']);
 const html=await readFile('dist/index.html','utf8');
 const version=html.match(/src="\.\/boot.js\?v=([a-f0-9]{16})"/)?.[1];assert.ok(version);assert.match(html,/name="tranru-mode" content="browser"/);
 for(const name of (await readdir('dist')).filter(x=>x.endsWith('.js'))){
  const code=await readFile('dist/'+name,'utf8');
  for(const match of code.matchAll(/['"](\.\/[^'"\n]+\.js)(\?v=[a-f0-9]{16})?['"]/g)){
   assert.equal(match[2],'?v='+version,`${name}: ${match[1]}`);await access(new URL(match[1],new URL('./dist/'+name,import.meta.url)));
  }
 }
 assert.match(await readFile('dist/boot.js','utf8'),/import\('\.\/app.js\?v=/);
});
