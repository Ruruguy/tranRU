import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toTaiwanTranscript,isTraditionalChineseTarget} from './public/traditional.js';

test('Chinese speech is rendered in Taiwan traditional characters without altering other languages',()=>{
 assert.equal(toTaiwanTranscript('大家好，我们今天讨论电脑和会议。','zh'),'大家好，我們今天討論電腦和會議。');
 assert.equal(toTaiwanTranscript('台湾的消防车','cmn-Hans-CN'),'臺灣的消防車');
 assert.equal(toTaiwanTranscript('日本語の会議','ja'),'日本語の会議');
 assert.equal(toTaiwanTranscript('Hello world','en'),'Hello world');
 assert.equal(toTaiwanTranscript('会議','auto'),'会議');
 assert.equal(isTraditionalChineseTarget('Traditional Chinese (Taiwan)'),true);
 assert.equal(isTraditionalChineseTarget('Japanese'),false);
});
