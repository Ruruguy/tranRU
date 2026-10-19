import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
const output=new URL('../dist/',import.meta.url);
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
await cp(new URL('../public/',import.meta.url),output,{recursive:true});
let html=await readFile(new URL('index.html',output),'utf8');
html=html.replace('<head>','<head>\n  <meta name="tranru-mode" content="browser">').replaceAll('href="/style.css"','href="./style.css"').replaceAll('src="/app.js"','src="./app.js"').replaceAll('href="/"','href="./"');
await writeFile(new URL('index.html',output),html);
console.log('Browser-only build ready in dist/ (no keys or backend sessions included).');
