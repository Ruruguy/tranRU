import {cp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const output=new URL('../dist/',import.meta.url);
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
await cp(new URL('../public/',import.meta.url),output,{recursive:true});
let html=await readFile(new URL('index.html',output),'utf8');
const files=(await readdir(output)).filter(name=>name.endsWith('.js')||name.endsWith('.css')).sort();
const hash=createHash('sha256').update(html);
for(const name of files)hash.update(await readFile(new URL(name,output)));
const version=hash.digest('hex').slice(0,16);
for(const name of files.filter(name=>name.endsWith('.js'))){
 const url=new URL(name,output);
 const code=await readFile(url,'utf8');
 await writeFile(url,code.replace(/(['"])(\.\/[^'"\n]+\.js)\1/g,(_match,quote,path)=>`${quote}${path}?v=${version}${quote}`));
}
html=html.replace('<head>','<head>\n  <meta name="tranru-mode" content="browser">').replace(/href="\.?\/style.css"/g,`href="./style.css?v=${version}"`).replace(/src="\.?\/boot.js"/g,`src="./boot.js?v=${version}"`).replaceAll('href="/"','href="./"');
await writeFile(new URL('index.html',output),html);
console.log('Browser-only build ready in dist/ (no keys or backend sessions included).');
