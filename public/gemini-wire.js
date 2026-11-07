import {MEDICAL_GLOSSARY} from './medical-glossary.js';
// Hosted mode keeps the visitor's key in the browser session only.
export function transcriptionSetup(language='auto') {
 const languages={en:'en-US',ja:'ja-JP',ko:'ko-KR',zh:'cmn-Hans-CN',es:'es-ES',fr:'fr-FR',de:'de-DE',bn:'bn-BD'};
 const priority=['休克','意識不清','意識改變','意識喪失','敗血症','敗血性休克','心因性休克','低血容性休克','呼吸暫停','新生兒復甦','正壓通氣','氣管內插管','聲門上呼吸道','格拉斯哥昏迷指數','NRP','MR SOPA','Apgar','CPR'];
 const terms=[...new Set([...priority,...MEDICAL_GLOSSARY.flatMap(item=>[item.zh,item.en,item.ja].filter(Boolean))])].slice(0,100);
 return {setup:{model:'models/gemini-3.5-transcribe-live',generationConfig:{responseModalities:['TEXT']},inputAudioTranscription:{languageCodes:languages[language]?[languages[language]]:[],customVocabulary:terms,mode:'VERBATIM'}}};
}
export function translationSetup(target) {
 const languages={'Traditional Chinese (Taiwan)':'zh-Hant',English:'en',Japanese:'ja',Bengali:'bn'};
 if(!languages[target]) throw Error('不支援的翻譯語言');
 return {setup:{model:'models/gemini-3.5-live-translate-preview',inputAudioTranscription:{},outputAudioTranscription:{},generationConfig:{responseModalities:['AUDIO'],translationConfig:{targetLanguageCode:languages[target],echoTargetLanguage:true}}}};
}
export function openGeminiRelay({key,target,mode,language,emit,finish,Socket=WebSocket}) {
 const setup=mode==='transcribe'?transcriptionSetup(language):translationSetup(target);
 const ws=new Socket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key='+encodeURIComponent(key));
 let ready=false,closed=false,ending=false,lastInput=Date.now();
 const safe=message=>String(message).replaceAll(key,'[redacted]');
 let setupTimer=setTimeout(()=>fail('Gemini 連線逾時'),15000);
 const idle=setInterval(()=>{if(Date.now()-lastInput>45000)fail('音訊連線中斷，Gemini 已停止');},10000);
 function close(){if(closed)return;closed=true;clearTimeout(setupTimer);clearInterval(idle);clearTimeout(endTimer);try{ws.close();}catch{}finish();}
 function fail(message,retryable=false){if(closed)return;emit('error',{error:safe(message),retryable});close();}
 let endTimer;
 ws.addEventListener('open',()=>{if(!closed)ws.send(JSON.stringify(setup));});
 ws.addEventListener('message',async event=>{
  try{
   const raw=typeof event.data==='string'?event.data:await event.data.text();
   if(closed)return;const m=JSON.parse(raw);
   if(m.error)return fail(m.error.message||'Gemini 服務失敗',[500,502,503,504].includes(Number(m.error.code)));
   if(m.setupComplete){ready=true;clearTimeout(setupTimer);emit('ready',{});}
   const c=m.serverContent;
   // Discard audio output deliberately: display subtitles without speaker feedback.
   if(c){if(c.interimInputTranscription)emit('interim',c.interimInputTranscription);if(c.inputTranscription)emit(mode==='transcribe'?'final':'input',c.inputTranscription);if(c.outputTranscription)emit('output',c.outputTranscription);if(c.turnComplete)emit('turn',{});if(c.interrupted)emit('turn',{});}
   if(m.goAway && !ending)emit('rotate',{reason:'session-expiry'});
  }catch{fail('Gemini 訊息格式無法解析');}
 });
 ws.addEventListener('error',()=>fail('Gemini WebSocket 網路連線失敗',true));
 ws.addEventListener('close',event=>{if(!closed){if(ending)close();else fail(`Gemini 連線已關閉 (${event.code})：${event.reason||'連線中斷'}`,[1000,1001,1006,1011,1012,1013].includes(event.code));}});
 return {
  audio(data){if(closed||ending||!ready)throw Error('Gemini 尚未就緒或連線已結束');if(typeof data!=='string'||data.length>100000||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw Error('PCM 音訊格式錯誤');if(ws.bufferedAmount>256000)throw Error('Gemini 上傳速度落後');lastInput=Date.now();ws.send(JSON.stringify({realtimeInput:{audio:{data,mimeType:'audio/pcm;rate=16000'}}}));},
  end(){if(closed||ending)return;ending=true;if(ready)ws.send(JSON.stringify({realtimeInput:{audioStreamEnd:true}}));endTimer=setTimeout(close,2500);},
  close
 };
}
