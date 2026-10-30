// Server-side relay: the long-lived Gemini key never reaches the browser.
export function translationSetup(target) {
 const languages={'Traditional Chinese (Taiwan)':'zh-Hant',English:'en',Japanese:'ja',Bengali:'bn'};
 if(!languages[target]) throw Error('不支援的翻譯語言');
 return {setup:{model:'models/gemini-3.5-live-translate-preview',inputAudioTranscription:{},outputAudioTranscription:{},generationConfig:{responseModalities:['AUDIO'],translationConfig:{targetLanguageCode:languages[target],echoTargetLanguage:true}}}};
}
export function openGeminiRelay({key,target,emit,finish,Socket=WebSocket}) {
 const setup=translationSetup(target);
 const ws=new Socket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key='+encodeURIComponent(key));
 let ready=false,closed=false,ending=false,lastInput=Date.now();
 const safe=message=>String(message).replaceAll(key,'[redacted]');
 let setupTimer=setTimeout(()=>fail('Gemini 連線逾時'),15000);
 const idle=setInterval(()=>{if(Date.now()-lastInput>45000)fail('音訊連線中斷，Gemini 已停止');},10000);
 function close(){if(closed)return;closed=true;clearTimeout(setupTimer);clearInterval(idle);clearTimeout(endTimer);try{ws.close();}catch{}finish();}
 function fail(message){if(closed)return;emit('error',{error:safe(message)});close();}
 let endTimer;
 ws.addEventListener('open',()=>{if(!closed)ws.send(JSON.stringify(setup));});
 ws.addEventListener('message',async event=>{
  try{
   const raw=typeof event.data==='string'?event.data:await event.data.text();
   if(closed)return;const m=JSON.parse(raw);
   if(m.error)return fail(m.error.message||'Gemini 服務失敗');
   if(m.setupComplete){ready=true;clearTimeout(setupTimer);emit('ready',{});}
   const c=m.serverContent;
   // Discard audio output deliberately: display subtitles without speaker feedback.
   if(c){if(c.inputTranscription)emit('input',c.inputTranscription);if(c.outputTranscription)emit('output',c.outputTranscription);if(c.turnComplete)emit('turn',{});if(c.interrupted)emit('turn',{});}
   if(m.goAway){if(ending)close();else fail('Gemini 工作階段即將到期，請重新啟動或使用 OpenAI 備用');}
  }catch{fail('Gemini 訊息格式無法解析');}
 });
 ws.addEventListener('error',()=>fail('Gemini WebSocket 連線失敗，請檢查金鑰、模型權限與網路'));
 ws.addEventListener('close',event=>{if(!closed){if(ending)close();else fail(`Gemini 連線已關閉 (${event.code})：${event.reason||'請檢查模型權限或額度'}`);}});
 return {
  audio(data){if(closed||ending||!ready)throw Error('Gemini 尚未就緒或連線已結束');if(typeof data!=='string'||data.length>100000||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw Error('PCM 音訊格式錯誤');if(ws.bufferedAmount>256000)throw Error('Gemini 上傳速度落後');lastInput=Date.now();ws.send(JSON.stringify({realtimeInput:{audio:{data,mimeType:'audio/pcm;rate=16000'}}}));},
  end(){if(closed||ending)return;ending=true;if(ready)ws.send(JSON.stringify({realtimeInput:{audioStreamEnd:true}}));endTimer=setTimeout(close,2500);},
  close
 };
}
