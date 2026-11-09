import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('progress distinguishes microphone frames, successful send, recognized text, and translated text',()=>{
 const app=readFileSync('public/app.js','utf8'),nodes={speechProgress:{},engine:{value:'gemini'}};let now=0;
 const context={$:id=>nodes[id],Date:{now:()=>now}};
 vm.runInNewContext(app.slice(app.indexOf('let speechProgress='),app.indexOf('// Microphone selection')),context);
 context.reportSpeechProgress('reset');now=13001;context.reportSpeechProgress('frame',.03);
 assert.match(nodes.speechProgress.textContent,/尚未收到辨識文字/);assert.match(nodes.speechProgress.textContent,/音訊已送出 0 段/);
 context.reportSpeechProgress('sent');assert.match(nodes.speechProgress.textContent,/音訊已送出 1 段/);
 context.reportSpeechProgress('recognized',5);assert.match(nodes.speechProgress.textContent,/辨識回傳 5 字/);assert.doesNotMatch(nodes.speechProgress.textContent,/尚未收到辨識文字/);
 context.reportSpeechProgress('translated',8);assert.match(nodes.speechProgress.textContent,/翻譯回傳 8 字/);
});
