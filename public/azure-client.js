import {MEDICAL_GLOSSARY} from './medical-glossary.js';

export const AZURE_LANGUAGES = {zh:'zh-TW',en:'en-US',ja:'ja-JP',ko:'ko-KR',es:'es-ES',fr:'fr-FR',de:'de-DE',bn:'bn-IN'};
export function validateAzureConfig(key,region,language) {
 if(!key?.trim())throw Error('請設定 Azure Speech 金鑰');
 if(!/^[a-z][a-z0-9]{1,39}$/.test(region||''))throw Error('Azure 區域請填資源的區域代碼，例如 eastasia，不能填網址');
 if(!AZURE_LANGUAGES[language])throw Error('Azure 模式請指定演講語言，目前不使用自動偵測');
}
export function azurePhrases(language) {
 const field=language==='zh'?'zh':language==='ja'?'ja':language==='en'?'en':null;
 if(!field)return [];
 return [...new Set(MEDICAL_GLOSSARY.flatMap(item=>[item[field],...(language==='zh'?item.aliases.filter(x=>/[\u3400-\u9fff]/.test(x)):[])]).filter(Boolean))].slice(0,500);
}
let sdkPromise;
export function loadAzureSDK() {
 if(globalThis.SpeechSDK)return Promise.resolve(globalThis.SpeechSDK);
 if(!sdkPromise)sdkPromise=new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  script.src=new URL('./vendor/azure-speech-1.53.0.js',import.meta.url).href;
  const timer=setTimeout(()=>finish(Error('Azure SDK 載入逾時，請重新整理後重試')),15000);
  function finish(error){clearTimeout(timer);script.onload=script.onerror=null;if(error){script.remove();sdkPromise=null;reject(error);}else resolve(globalThis.SpeechSDK);}
  script.onload=()=>finish(globalThis.SpeechSDK?null:Error('Azure SDK 未正確載入'));
  script.onerror=()=>finish(Error('Azure SDK 無法載入，請確認網站已更新'));
  document.head.append(script);
 });
 return sdkPromise;
}

// Transport adapter for the shared bounded-buffer/reconnection controller.
// Keys stay in this page's memory. No key is put in application storage or logs.
export class AzureSpeechClient {
 constructor({key,region,onEvent,onFailure,loadSDK=loadAzureSDK,timeoutMs=20000,endTimeoutMs=3500}) {
  Object.assign(this,{key,region,onEvent,onFailure,loadSDK,timeoutMs,endTimeoutMs});
  this.active=false;this.queue=[];
 }
 async connect(_target,{language='zh'}={}) {
  validateAzureConfig(this.key,this.region,language);
  this.active=true;this.stopping=false;
  const sdk=await this.loadSDK();
  if(!this.active)throw new DOMException('已取消連線','AbortError');
  sdk.Recognizer.enableTelemetry(false);
  const config=sdk.SpeechConfig.fromSubscription(this.key,this.region);
  config.speechRecognitionLanguage=AZURE_LANGUAGES[language];
  this.input=sdk.AudioInputStream.createPushStream(sdk.AudioStreamFormat.getWaveFormatPCM(16000,16,1));
  this.audio=sdk.AudioConfig.fromStreamInput(this.input);
  const recognizer=this.recognizer=new sdk.SpeechRecognizer(config,this.audio);
  const grammar=sdk.PhraseListGrammar.fromRecognizer(recognizer);
  for(const phrase of azurePhrases(language))grammar.addPhrase(phrase);
  return new Promise((resolve,reject)=>{
   this.rejectConnect=reject;
   this.timer=setTimeout(()=>this.fail(Object.assign(Error('Azure 連線逾時，請檢查網路與資源區域'),{retryable:true})),this.timeoutMs);
   recognizer.sessionStarted=()=>{if(!this.active)return;clearTimeout(this.timer);this.rejectConnect=null;resolve();};
   recognizer.recognizing=(_,event)=>{if(this.active&&event.result.text)this.onEvent('interim',{text:event.result.text,languageCode:AZURE_LANGUAGES[language]});};
   recognizer.recognized=(_,event)=>{
    if(!this.active)return;
    if(event.result.reason===sdk.ResultReason.RecognizedSpeech && event.result.text)this.onEvent('final',{text:event.result.text,languageCode:AZURE_LANGUAGES[language]});
    else if(event.result.reason===sdk.ResultReason.NoMatch)this.onEvent('boundary',{interrupted:true});
   };
   recognizer.canceled=(_,event)=>{
    if(!this.active)return;
    if(this.stopping){this.finishEnd?.();return;}
    const code=event.errorCode;
    const retryable=[sdk.CancellationErrorCode.ConnectionFailure,sdk.CancellationErrorCode.ServiceTimeout,sdk.CancellationErrorCode.ServiceError].includes(code);
    // Never echo SDK errorDetails: upstream diagnostics may include credentials.
    const message=code===sdk.CancellationErrorCode.AuthenticationFailure?'Azure 驗證失敗，請檢查 Speech 金鑰及區域':code===sdk.CancellationErrorCode.TooManyRequests?'Azure 額度或並行數限制，請檢查資源用量':`Azure 語音連線中斷（代碼 ${Number(code)||0}）`;
    this.fail(Object.assign(Error(message),{retryable}));
   };
   recognizer.sessionStopped=()=>{if(this.stopping)this.finishEnd?.();else if(this.active)this.fail(Object.assign(Error('Azure 語音工作階段已結束'),{retryable:true}));};
   recognizer.startContinuousRecognitionAsync(()=>{},()=>this.fail(Object.assign(Error('Azure 啟動失敗，請檢查金鑰、區域及網路'),{retryable:false})));
  });
 }
 send(audio){if(!this.active||this.stopping)return;try{this.input.write(Uint8Array.from(atob(audio),c=>c.charCodeAt(0)).buffer);}catch{this.fail(Object.assign(Error('Azure 音訊傳送失敗'),{retryable:true}));}}
 fail(error){if(!this.active)return;const reject=this.rejectConnect;this.rejectConnect=null;this.close();if(reject)reject(error);else this.onFailure(error);}
 async end(){
  if(!this.active)return;this.stopping=true;
  await new Promise(resolve=>{this.finishEnd=resolve;this.endTimer=setTimeout(resolve,this.endTimeoutMs);this.input?.close();});
  this.close();
 }
 close(){
  this.active=false;this.stopping=true;clearTimeout(this.timer);clearTimeout(this.endTimer);
  this.finishEnd?.();this.finishEnd=null;
  this.rejectConnect?.(new DOMException('已取消連線','AbortError'));this.rejectConnect=null;
  try{this.input?.close();}catch{}
  try{this.recognizer?.close();}catch{}
  try{this.audio?.close();}catch{}
  this.recognizer=null;this.input=null;this.audio=null;
 }
}
