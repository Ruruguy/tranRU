import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyServiceError} from './public/service-errors.js';
test('quota is distinguished from temporary rate limiting and stops requests',()=>{
 const q=classifyServiceError('語音辨識失敗: API 429: You have no credits remaining. Add credits to continue using the API');
 assert.equal(q.fatal,true);assert.equal(q.code,'quota');assert.match(q.message,/Gemini/);
 assert.equal(classifyServiceError('API 429: Rate limit exceeded').code,'rate_limit');
 assert.equal(classifyServiceError('API 401: Incorrect API key').code,'auth');
 assert.equal(classifyServiceError('Network offline').fatal,false);
});
