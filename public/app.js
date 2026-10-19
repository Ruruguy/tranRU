import {apiFetch as fetch} from './api-client.js';
import {classifyServiceError} from './service-errors.js';
import {GeminiLiveClient, PCMChunks, SSEParser} from './gemini-client.js';
const $ = id => document.getElementById(id);

let token = '';
let configured = false;
let openaiBlocked = false;
let openaiConfigured = false, geminiConfigured = false;
let gemini = null, pcm = null, liveRecord = null;
let geminiSecond = null, secondLiveRecord = null;
const canStart = () => $('engine').value === 'gemini' ? geminiConfigured : (openaiConfigured || geminiConfigured);
function updateKeys(s) {
 openaiConfigured = s.openaiConfigured ?? s.configured; geminiConfigured = !!s.geminiConfigured; configured = openaiConfigured || geminiConfigured;
 if ($('keyStatus')) $('keyStatus').textContent = `Gemini：${geminiConfigured ? '已設定' : '未設定'}；OpenAI：${openaiConfigured ? '已設定' : '未設定'}`;
 if(s.browserOnly && $('keyDescription'))$('keyDescription').textContent='線上版：請填入自己的 API 金鑰。金鑰僅保存在本分頁記憶體，直接送至 Google／OpenAI，不會上傳至本站主機；重新整理後需重填。';
 if (s.translationProvider && $('translationProvider')) $('translationProvider').value = s.translationProvider;
}
let running = false;
let starting = false;
let ctx = null;
let stream = null;
let processor = null;
let sourceNode = null;
let sink = null;
let wake = null;

let frames = [];
let totalSamples = 0;
let silenceSamples = 0;
let isSpeaking = false;
let session = 0;
let startTime = 0;
let elapsed = 0;
let records = [];
let pipWindow = null;
let speechRecognizer = null;
let currentNativeRecord = null;

const status = t => $('status').textContent = t;

// Initial server status & CSRF token
try {
  const s = await fetch('/api/status').then(r => r.json());
  token = s.token;
  updateKeys(s);
  if (s.model && $('model')) $('model').value = s.model;
  if (s.speech && $('speech')) $('speech').value = s.speech;
  status(configured ? '○ 準備就緒' : '○ 請先設定 Gemini 或 OpenAI API 金鑰');
} catch {
  status('無法連線本機伺服器，請重新啟動。');
}

// Settings Dialog
$('settings').onclick = () => $('dialog').showModal();
$('engine').onchange = () => status(canStart() ? '○ 準備就緒' : '○ 請先設定所選服務的 API 金鑰');
$('save').onclick = async () => {
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Session-Token': token},
      body: JSON.stringify({
        key: $('key').value || undefined,
        geminiKey: $('geminiKey').value || undefined,
        translationProvider: $('translationProvider')?.value || undefined,
        model: $('model').value,
        speech: $('speech').value
      })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || '儲存失敗');
    updateKeys(d);
    openaiBlocked = false;
    $('key').value = '';
    $('geminiKey').value = '';
    $('configStatus').textContent = configured ? '已設定，可以開始翻譯。' : '請輸入金鑰';
    if (configured) {
      $('dialog').close();
      status('○ 準備就緒');
    }
  } catch (e) {
    $('configStatus').textContent = e.message;
  }
};

$('clearKeys').onclick=async()=>{
 if(running || starting || convActiveSpeaker){$('configStatus').textContent='請先停止聆聽，再清除金鑰';return;}
 try {
  const response=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':token},body:JSON.stringify({key:'',geminiKey:''})});
  const result=await response.json();if(!response.ok)throw Error(result.error);
  updateKeys(result);$('key').value='';$('geminiKey').value='';
  $('configStatus').textContent='已清除你的工作階段金鑰';status('○ 請設定自己的 API 金鑰');
 }catch(e){$('configStatus').textContent=e.message;}
};

$('checkGemini').onclick = async () => {
  const button = $('checkGemini');button.disabled=true;
  $('configStatus').textContent='正在向 Google 驗證翻譯設定…';
  try {
    const response=await fetch('/api/gemini-check',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':token},body:JSON.stringify({target:$('target').value}),signal:AbortSignal.timeout(25000)});
    const result=await response.json();
    if(!response.ok)throw Error(result.error);
    $('configStatus').textContent=result.message;
  } catch(e){$('configStatus').textContent='連線測試失敗：'+e.message;}
  finally{button.disabled=false;}
};

function syncDualUI() {
 const enabled=$('dualTranslation').checked;
 $('secondTargetLabel').hidden=!enabled;$('dualHint').hidden=!enabled;
 $('secondPanel').hidden=!enabled;
 $('secondTitle').textContent='第二語言譯文 · '+$('secondTarget').selectedOptions[0].textContent;
}
$('dualTranslation').onchange=syncDualUI;
$('secondTarget').onchange=syncDualUI;

// UI Controls
$('font').oninput = () => document.documentElement.style.setProperty('--subtitle', $('font').value + 'px');
function syncCompactControls(){
 $('exitCompact').hidden=!document.body.classList.contains('focus')&&!document.fullscreenElement;
}
$('focus').onclick=()=>{document.body.classList.toggle('focus');syncCompactControls();};
$('fullscreen').onclick=async()=>{
 try {
  if(document.fullscreenElement)await document.exitFullscreen();
  else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();
  else {document.body.classList.add('focus');status('此瀏覽器不支援網頁全螢幕，已開啟演講模式');}
 }catch{document.body.classList.add('focus');status('已開啟演講模式；可使用瀏覽器的全螢幕功能');}
 syncCompactControls();
};
$('exitCompact').onclick=async()=>{
 document.body.classList.remove('focus');
 if(document.fullscreenElement)await document.exitFullscreen().catch(()=>{});
 syncCompactControls();
};
document.addEventListener('fullscreenchange',syncCompactControls);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.body.classList.remove('focus');syncCompactControls();}});

// Update Clock
function formatTime() {
  const s = Math.floor((elapsed + (running ? Date.now() - startTime : 0)) / 1000);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':');
}
setInterval(() => {
  if ($('clock')) $('clock').textContent = formatTime();
}, 500);

// Persistence
function persist() {
  try {
    const serialized = records.slice(-100).map(({audio, ...r}) => ({
      ...r,
      state: r.state === 'streaming' || r.state === 'pending' ? 'error' : r.state,
      error: (r.state === 'streaming' || r.state === 'pending') ? '頁面關閉前未完成' : r.error
    }));
    localStorage.setItem('lecture-lens-transcript', JSON.stringify(serialized));
  } catch {
    status('瀏覽器儲存空間不足，請匯出逐字稿。');
  }
}

// Load previous history
try {
  records = JSON.parse(localStorage.getItem('lecture-lens-transcript') || '[]');
  if (!Array.isArray(records)) records = [];
  if (records.length) draw();
} catch {
  records = [];
}

function getRecentHistory() {
  return records
    .filter(r => !r.secondary && r.state === 'done' && r.text && r.translation)
    .slice(-3)
    .map(r => ({text: r.text, translation: r.translation}));
}

// Render DOM
function draw() {
  const el = $('rows');
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  el.replaceChildren();
  $('secondRows').replaceChildren();
  $('secondPanel').hidden=!$('dualTranslation').checked;

  if (!records.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = `
      <div class="sound">▂ ▅ ▃ ▇ ▅ ▂ ▄</div>
      <h2>把注意力，留給演講。</h2>
      <p>選擇 Gemini 即時翻譯，或使用 OpenAI 備用。<br>原文與譯文將在這裡呈現。</p>
      <button id="demoBtn">先看看字幕示範 ↗</button>
    `;
    empty.querySelector('#demoBtn').onclick = injectDemo;
    el.append(empty);
    $('count').textContent = '0';
    return;
  }

  for (const r of records) {
    const row = document.createElement('div');
    row.className = 'row' + (r.state === 'streaming' || r.state === 'pending' ? ' live-active' : '');
    row.id = 'row-' + r.id;

    const cellA = document.createElement('div');
    cellA.className = 'cell';
    const timeElem = document.createElement('time');
    timeElem.textContent = r.time + (r.demo ? ' · 示範' : '') + (r.secondary ? ' · '+r.target : '');
    cellA.append(timeElem);

    if (r.text) {
      cellA.append(document.createTextNode(r.text));
    } else if (r.interim) {
      const interimSpan = document.createElement('span');
      interimSpan.className = 'interim-text';
      interimSpan.textContent = r.interim;
      cellA.append(interimSpan);
    } else {
      cellA.append(document.createTextNode(r.state === 'error' ? '未取得原文（服務請求失敗）' : '正在辨識演講語音…'));
    }

    const cellB = document.createElement('div');
    cellB.className = 'cell';

    if (r.state === 'pending' && !r.translation) {
      cellB.textContent = '準備翻譯…';
    } else if (r.state === 'streaming') {
      cellB.textContent = r.translation || '';
      const cursor = document.createElement('span');
      cursor.className = 'streaming-cursor';
      cellB.append(cursor);
    } else if (r.state === 'error') {
      cellB.classList.add('failed');
      cellB.textContent = classifyServiceError(r.error).message || '處理失敗';
      if (r.audio || r.text) {
        const retryBtn = document.createElement('button');
        retryBtn.className = 'retry';
        retryBtn.textContent = '重試這一段';
        retryBtn.onclick = () => retryRecord(r);
        cellB.append(document.createElement('br'), retryBtn);
      }
    } else {
      cellB.textContent = r.translation || '';
    }

    row.append(cellA, cellB);
    (r.secondary ? $('secondRows') : el).append(row);
  }

  $('count').textContent = records.length;
  if ($('autoscroll').checked && nearBottom) {
    el.scrollTop = el.scrollHeight;
  }
  if (typeof updatePiP === 'function') updatePiP();
}

function updateStreamingRow(record) {
  const row = $('row-' + record.id);
  if (!row) {
    draw();
    return;
  }

  const cells = row.querySelectorAll('.cell');
  if (cells.length >= 2) {
    // Original cell
    if (record.text) {
      const timeElem = cells[0].querySelector('time');
      cells[0].replaceChildren(timeElem || '', document.createTextNode(record.text));
    } else if (record.interim) {
      const timeElem = cells[0].querySelector('time');
      const interimSpan = document.createElement('span');
      interimSpan.className = 'interim-text';
      interimSpan.textContent = record.interim;
      cells[0].replaceChildren(timeElem || '', interimSpan);
    }

    // Translation cell
    if (record.state === 'streaming') {
      cells[1].textContent = record.translation || '';
      const cursor = document.createElement('span');
      cursor.className = 'streaming-cursor';
      cells[1].append(cursor);
    } else if (record.state === 'done') {
      cells[1].textContent = record.translation || '';
      row.classList.remove('live-active');
    } else if (record.state === 'error') {
      cells[1].classList.add('failed');
      cells[1].textContent = record.error || '失敗';
      row.classList.remove('live-active');
    }
  }

  if ($('autoscroll').checked) {
    const el = record.secondary ? $('secondRows') : $('rows');
    el.scrollTop = el.scrollHeight;
  }
  if (typeof updatePiP === 'function') updatePiP();
}

function newRecord(data) {
  const r = {
    id: crypto.randomUUID(),
    time: formatTime(),
    state: 'pending',
    text: '',
    translation: '',
    language: $('language').value,
    target: $('target').value,
    secondTarget: $('dualTranslation').checked ? $('secondTarget').value : null,
    context: $('context').value,
    ...data
  };
  records.push(r);
  draw();
  return r;
}

// Convert audio frames to 16-bit PCM WAV Base64
function encodeWav(parts, length, rate) {
  const b = new ArrayBuffer(44 + length * 2);
  const v = new DataView(b);
  const writeStr = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // Mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  writeStr(36, 'data');
  v.setUint32(40, length * 2, true);

  let p = 44;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      const sample = Math.max(-1, Math.min(1, part[i]));
      v.setInt16(p, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      p += 2;
    }
  }

  let s = '';
  const u = new Uint8Array(b);
  const chunkSize = 16384;
  for (let i = 0; i < u.length; i += chunkSize) {
    s += String.fromCharCode(...u.subarray(i, i + chunkSize));
  }
  return btoa(s);
}

// Process record with SSE streaming
async function streamRecord(record, endpoint = 'audio-stream', payload = null) {
  if(openaiBlocked){record.state='error';record.error='OpenAI 已暫停，請檢查額度或金鑰後再開始。';draw();return;}
  record.state = 'streaming';
  record.translation = '';
  updateStreamingRow(record);

  const reqBody = payload || {
    audio: record.audio,
    text: record.text,
    language: record.language,
    target: record.target,
    context: record.context,
    history: getRecentHistory()
  };

  try {
    const response = await fetch('/api/' + endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': token,
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(reqBody)
    });

    if (!response.ok) {
      let errMsg = `請求錯誤 (${response.status})`;
      try {
        const j = await response.json();
        errMsg = j.error || errMsg;
      } catch {}
      throw new Error(errMsg);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let completed = false;
    const parser = new SSEParser((event, data) => {
      if(event === 'error')throw Error(data.error || '串流處理異常');
      if(event === 'stt')record.text = data.text || '';
      if(event === 'delta')record.translation = (record.translation || '') + (data.delta || '');
      if(event === 'done'){
        completed = true;
        if(data.text !== undefined)record.text=data.text;
        if(data.translation !== undefined)record.translation=data.translation;
        record.state='done';record.audio=undefined;
      }
      updateStreamingRow(record);
    });
    while(true){const {done,value}=await reader.read();if(done)break;parser.push(decoder.decode(value,{stream:true}));}
    if(!completed)throw Error('翻譯串流提早中斷，請重試此段');
    if(!record.secondary && record.secondTarget && record.text.trim() && !record.secondRequested){
      record.secondRequested=true;
      const second=newRecord({secondary:true,parentId:record.id,text:record.text,target:record.secondTarget,secondTarget:null});
      streamRecord(second,'translate-stream',{text:second.text,target:second.target,context:second.context,history:[]});
    }
    if(!record.text.trim() && !record.translation.trim()){records=records.filter(r=>r!==record);draw();}
    persist();
  } catch (err) {
    record.state = 'error';
    const issue = classifyServiceError(err.message);
    record.error = issue.message;
    if(record.secondary){$('secondStatus').textContent='第二語言翻譯失敗：'+issue.message;}
    if(!record.secondary && issue.fatal && !openaiBlocked){
      openaiBlocked = true;
      // Discard the unsent tail before stop(), which otherwise flushes another request.
      frames=[];totalSamples=silenceSamples=0;isSpeaking=false;
      if(running && !gemini)await stop();
      status(issue.message);
    }
    draw();
    persist();
  }
}

// Flush accumulated VAD audio
function flushVAD() {
  if (!totalSamples || !ctx) return;
  const parts = frames;
  const count = totalSamples;
  const rate = ctx.sampleRate;

  frames = [];
  totalSamples = 0;
  silenceSamples = 0;
  isSpeaking = false;

  // Discard click/cough noise under 0.4s
  if (count < rate * 0.4) return;

  if (!parts.some(p => p.some(v => Math.abs(v) > 0.007))) return;
  const base64Audio = encodeWav(parts, count, rate);
  const record = newRecord({
    audio: base64Audio,
    text: ''
  });

  streamRecord(record, 'audio-stream');
}

function retryRecord(r) {
  if (r.state === 'streaming') return;
  r.state = 'pending';
  r.error = undefined;
  draw();
  if (r.audio) {
    streamRecord(r, 'audio-stream');
  } else if (r.text) {
    streamRecord(r, 'translate-stream', {
      text: r.text,
      target: r.target,
      context: r.context,
      history: getRecentHistory()
    });
  }
}

// Start Native Web Speech Engine (for Microphone)
function startNativeSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    throw new Error('此瀏覽器不支援原生 Web Speech API，請改選「智慧停頓切段 (OpenAI)」模式。');
  }

  speechRecognizer = new SpeechRecognition();
  speechRecognizer.continuous = true;
  speechRecognizer.interimResults = true;

  const langMap = {
    en: 'en-US',
    ja: 'ja-JP',
    ko: 'ko-KR',
    zh: 'zh-TW',
    es: 'es-ES',
    fr: 'fr-FR',
    de: 'de-DE'
  };
  speechRecognizer.lang = langMap[$('language').value] || 'en-US';

  speechRecognizer.onresult = event => {
    if (!running) return;
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    if (interimTranscript) {
      if (!currentNativeRecord) {
        currentNativeRecord = newRecord({interim: interimTranscript});
      } else {
        currentNativeRecord.interim = interimTranscript;
        updateStreamingRow(currentNativeRecord);
      }
    }

    if (finalTranscript.trim()) {
      const rec = currentNativeRecord || newRecord({});
      currentNativeRecord = null;
      rec.text = finalTranscript.trim();
      rec.interim = '';
      rec.state = 'pending';
      updateStreamingRow(rec);
      streamRecord(rec, 'translate-stream', {
        text: rec.text,
        target: rec.target,
        context: rec.context,
        history: getRecentHistory()
      });
    }
  };

  speechRecognizer.onerror = event => {
    if (event.error !== 'no-speech') {
      status(`語音辨識注意：${event.error}`);
    }
  };

  speechRecognizer.onend = () => {
    if (running && $('engine').value === 'native') {
      try {
        speechRecognizer.start();
      } catch {}
    }
  };

  speechRecognizer.start();
}

// Stop Everything
async function stop() {
  running = false;
  session++;
  if (startTime) {
    elapsed += Date.now() - startTime;
    startTime = 0;
  }

  if (speechRecognizer) {
    try {
      speechRecognizer.stop();
    } catch {}
    speechRecognizer = null;
  }
  currentNativeRecord = null;

  if (processor) processor.onaudioprocess = null;
  if (gemini) {
    $('start').disabled = true;
    status('○ 正在完成 Gemini 剩餘字幕…');
    const tail = pcm?.tail(); if(tail){gemini.send(tail);geminiSecond?.send(tail);}
    await Promise.allSettled([gemini.end(),geminiSecond?.end()]);
    geminiSecond=null;finishLiveRecord(false,true);
    gemini = null; pcm = null; finishLiveRecord(false);
    $('start').disabled = false;
  } else if (ctx && totalSamples) flushVAD();

  if (processor) processor.onaudioprocess = null;
  processor?.disconnect();
  sourceNode?.disconnect();
  sink?.disconnect();
  stream?.getTracks().forEach(t => t.stop());
  stream = null;

  if (ctx) {
    await ctx.close().catch(() => {});
    ctx = null;
  }

  await wake?.release().catch(() => {});
  wake = null;

  $('meterFill').style.width = '0%';
  $('start').textContent = '● 開始聆聽';
  for (const id of ['source', 'engine', 'language', 'target', 'dualTranslation', 'secondTarget']) $(id).disabled = false;
  status('○ 已停止聆聽');
  persist();
}

// Start Listening Handler
$('start').onclick = async () => {
  if (running) {
    await stop();
    return;
  }
  if (starting) return;
  if (!canStart()) {
    $('dialog').showModal();
    status('請先設定所選翻譯服務的 API 金鑰');
    return;
  }

  if($('dualTranslation').checked && $('target').value === $('secondTarget').value){status('請選擇兩種不同的目標語言');return;}
  starting = true;
  for(const id of ['source','engine','language','target','dualTranslation','secondTarget'])$(id).disabled=true;
  $('start').disabled = true;
  openaiBlocked = false;
  const currentSession = ++session;
  let fallbackReason = "";

  try {
    if (!navigator.mediaDevices) {
      throw new Error('請以 Chrome 或現代瀏覽器開啟本機網址，方可授權使用音訊。');
    }

    const sourceVal = $('source').value;
    const engineVal = $('engine').value;

    if (sourceVal === 'tab' && engineVal === 'native') {
      status('分頁音訊由智慧切段模式驅動。已自動為您切換。');
      $('engine').value = 'vad';
    }

    if ($('engine').value === 'gemini') {
      status('○ 正在連線 Gemini…');
      gemini = new GeminiLiveClient({token,onEvent:handleGeminiEvent,onFailure:handleGeminiFailure});
      try {await gemini.connect($('target').value);}
      catch(e) {gemini.close();gemini=null;if($('fallback').checked && openaiConfigured && !openaiBlocked){$('engine').value='vad';fallbackReason=e.message;}else throw e;}
    }
    if(gemini && $('dualTranslation').checked){
      $('secondStatus').textContent='正在連線第二語言…';
      geminiSecond=new GeminiLiveClient({token,onEvent:(event,data)=>handleGeminiEvent(event,data,true),onFailure:handleSecondFailure});
      try {await geminiSecond.connect($('secondTarget').value);$('secondStatus').textContent='第二語言已連線，等待音訊';}
      catch(e){geminiSecond?.close();geminiSecond=null;$('secondStatus').textContent='第二語言連線失敗（第一語言可繼續）：'+e.message;}
    }
    stream = sourceVal === 'tab'
      ? await navigator.mediaDevices.getDisplayMedia({video: true, audio: true})
      : await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}, video: false});

    if (!stream.getAudioTracks().length) {
      throw new Error('未取得音訊軌道。請確認已選取有聲音的分頁並勾選「分享分頁音訊」。');
    }

    // AudioContext for VU Meter & VAD
    ctx = new (window.AudioContext || window.webkitAudioContext)({sampleRate:16000});
    await ctx.resume();
    if(gemini)pcm=new PCMChunks(ctx.sampleRate);
    sourceNode = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    processor = ctx.createScriptProcessor(2048, 1, 1);
    sink = ctx.createGain();
    sink.gain.value = 0;

    sourceNode.connect(processor);
    processor.connect(sink);
    sink.connect(ctx.destination);

    frames = [];
    totalSamples = 0;
    silenceSamples = 0;
    isSpeaking = false;
    if($('engine').value === 'gemini' && !gemini)throw Error('Gemini 已中斷，請重新測試連線；尚未開始傳送音訊。');
    running = true;
    startTime = Date.now();

    const vadSilenceThresholdMs = Number($('vadSilenceMs')?.value || 650);
    const rmsThreshold = 0.007; // Voice detection threshold
    const maxSpeechDurationSec = 3.5; // Max duration before auto-flush

    processor.onaudioprocess = e => {
      if (!running || session !== currentSession) return;
      const input = e.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input);

      // Volume & VU Meter calculation
      let sum = 0;
      for (let i = 0; i < copy.length; i++) {
        sum += copy[i] * copy[i];
      }
      const rms = Math.sqrt(sum / copy.length);
      const meterPercent = Math.min(100, Math.round(rms * 450));
      $('meterFill').style.width = meterPercent + '%';

      if (gemini) {for(const chunk of pcm.push(copy)){gemini?.send(chunk);geminiSecond?.send(chunk);} return;}
      if ($('engine').value === 'native') return; // Handled by Web Speech API

      // Intelligent VAD logic
      frames.push(copy);
      totalSamples += copy.length;

      if (rms >= rmsThreshold) {
        isSpeaking = true;
        silenceSamples = 0;
      } else if (isSpeaking) {
        silenceSamples += copy.length;
      }

      // Check Pause Condition: spoken >= 1.0s and silence >= vadSilenceThresholdMs
      const silenceMs = (silenceSamples / ctx.sampleRate) * 1000;
      const totalSec = totalSamples / ctx.sampleRate;

      if (isSpeaking && totalSec >= 1.0 && silenceMs >= vadSilenceThresholdMs) {
        flushVAD();
      } else if (totalSec >= maxSpeechDurationSec) {
        flushVAD();
      }
    };

    if ($('engine').value === 'native') {
      startNativeSpeech();
    }

    for (const t of stream.getTracks()) {
      t.onended = () => {
        if (running) stop();
      };
    }

    $('start').textContent = '■ 停止聆聽';
    for (const id of ['source', 'engine', 'language', 'target', 'dualTranslation', 'secondTarget']) $(id).disabled = true;
    $('badge').textContent = gemini ? 'Gemini 串流' : 'OpenAI 模式';
    status(gemini ? '● Gemini 即時翻譯 · 語言自動偵測' : fallbackReason ? '● Gemini 無法啟動，已切換 OpenAI：'+fallbackReason : '● OpenAI 即時口譯');

    try {
      wake = await navigator.wakeLock?.request('screen');
    } catch {}
  } catch (e) {
    gemini?.close(); gemini=null; pcm=null;
    geminiSecond?.close();geminiSecond=null;
    stream?.getTracks().forEach(t => t.stop());
    if (ctx) await ctx.close().catch(() => {});
    ctx = null;
    stream = null;
    running = false;
    $('meterFill').style.width = '0%';
    status('無法啟動：' + e.message);
  } finally {
    starting = false;
    if(!running)for(const id of ['source','engine','language','target','dualTranslation','secondTarget'])$(id).disabled=false;
    $('start').disabled = false;
  }
};

// Manual Text Translation with Streaming
$('translate').onclick = () => {
  const text = $('manual').value.trim();
  if (!text) return;
  if (!openaiConfigured) {
    $('dialog').showModal();
    return;
  }
  const r = newRecord({text});
  $('manual').value = '';
  streamRecord(r, 'translate-stream', {
    text: r.text,
    target: r.target,
    context: r.context,
    history: getRecentHistory()
  });
};

// Demo Subtitles
function injectDemo() {
  newRecord({
    demo: true,
    state: 'done',
    text: 'The most important thing is not to stop questioning. Curiosity has its own reason for existing.',
    translation: '最重要的是不要停止提問。好奇心本身，就有其存在的理由。'
  });
  if($('dualTranslation').checked)$('secondStatus').textContent='○ 第二語言示範字幕（非即時翻譯）';
  if($('dualTranslation').checked)newRecord({secondary:true,demo:true,state:'done',text:'The most important thing is not to stop questioning. Curiosity has its own reason for existing.',target:$('secondTarget').value,secondTarget:null,translation:({'Japanese':'最も大切なのは、問い続けることです。好奇心そのものに、存在する理由があります。','English':'The most important thing is not to stop questioning. Curiosity has its own reason for existing.','Traditional Chinese (Taiwan)':'最重要的是不要停止提問。好奇心本身，就有其存在的理由。'})[$('secondTarget').value]});
  persist();
  status('○ 示範字幕 · 雙向對照呈現');
}
if ($('demo')) $('demo').onclick = injectDemo;

// Export Markdown Transcript
$('export').onclick = () => {
  if (!records.length) {
    status('尚無字幕可匯出');
    return;
  }
  const text = '# 演講口譯逐字稿\n\n' +
    records.map(r => `## ${r.time}${r.demo ? '（示範）' : ''} · ${r.target || '譯文'}${r.secondary ? '（第二語言）' : ''}\n\n**原文**：${r.text || '（無語音）'}\n\n**譯文**：${r.translation || r.error || '處理中'}\n`).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type: 'text/markdown;charset=utf-8'}));
  a.download = `lecture-translation-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// Clear Transcripts
$('clear').onclick = () => {
  if (running || starting || records.some(r => r.state === 'streaming')) {
    status('請先停止聆聽並等候翻譯完成後再清除紀錄。');
    return;
  }
  if (records.length && !confirm('確定清除所有即時字幕？已產生的逐字稿將被刪除。')) return;
  records = [];
  elapsed = 0;
  persist();
  draw();
  status('○ 紀錄已清除');
};

window.addEventListener('beforeunload', e => {
  if (running || records.some(r => r.state === 'streaming')) {
    e.preventDefault();
    e.returnValue = '';
  }
});

function finishLiveRecord(interrupted,secondary=false) {
 const r=secondary?secondLiveRecord:liveRecord;
 if(!r)return;
 if(!r.text && !r.translation)records=records.filter(x=>x!==r);
 else {r.state=interrupted || !r.translation?'error':'done';if(r.state==='error')r.error='Gemini 字幕未完成；中斷期間可能缺字。';}
 if(secondary)secondLiveRecord=null;else liveRecord=null;
 draw();persist();
}
function handleGeminiEvent(event,data,secondary=false) {
 if(event==='turn'){finishLiveRecord(false,secondary);return;}
 if((event!=='input' && event!=='output')||!data.text)return;
 let r=secondary?secondLiveRecord:liveRecord;
 if(!r){r=newRecord({provider:'gemini',state:'streaming',secondary,target:secondary?$('secondTarget').value:$('target').value,secondTarget:null});if(secondary)secondLiveRecord=r;else liveRecord=r;}
 if(event==='input')r.text+=data.text;else r.translation+=data.text;
 if(secondary)$('secondStatus').textContent='● 第二語言即時翻譯中';
 updateStreamingRow(r);
}
function handleSecondFailure(error){
 geminiSecond?.close();geminiSecond=null;finishLiveRecord(true,true);
 $('secondStatus').textContent='第二語言已中斷（第一語言繼續）：'+error.message;
}
function handleGeminiFailure(error) {
 const old=gemini;gemini=null;pcm=null;old?.close();finishLiveRecord(true);
 geminiSecond?.close();geminiSecond=null;finishLiveRecord(true,true);
 if(!running)return;
 if($('fallback').checked && openaiConfigured && !openaiBlocked){
  $('engine').value='vad';frames=[];totalSamples=silenceSamples=0;isSpeaking=false;
  $('badge').textContent='OpenAI 備用';
  status('● 已切換 OpenAI 備用；中斷期間可能缺字：'+error.message);
 }else {stop().then(()=>status('Gemini 已中斷：'+error.message+'。請設定 OpenAI 備用，或重新開始。'));}
}

// --- Picture-in-Picture (PiP) Floating Subtitles ---

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function updatePiP() {
  if (!pipWindow || !pipWindow.document) return;
  const container = pipWindow.document.getElementById('pipRows');
  const clockElem = pipWindow.document.getElementById('pipClock');
  if (clockElem && $('clock')) clockElem.textContent = $('clock').textContent;
  if (!container) return;

  const recent = records.slice(-3);
  if (!recent.length) {
    container.innerHTML = '<div style="color:#788b72;padding:24px;text-align:center;">等待演講即時音訊…</div>';
    return;
  }

  container.innerHTML = recent.map(r => `
    <div class="pip-row">
      <div class="pip-original">${escapeHtml(r.text || r.interim || '正在辨識演講語音…')}</div>
      <div class="pip-translation">${r.secondary ? escapeHtml(r.target)+' · ' : ''}${escapeHtml(r.translation || (r.state === 'streaming' ? '正在即時翻譯…' : ''))}</div>
    </div>
  `).join('');
  container.scrollTop = container.scrollHeight;
}

function setupPiPDoc(doc) {
  doc.body.className = 'pip-mode';
  [...document.styleSheets].forEach(sheet => {
    try {
      const rules = [...sheet.cssRules].map(r => r.cssText).join('');
      const style = doc.createElement('style');
      style.textContent = rules;
      doc.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        doc.head.appendChild(link);
      }
    }
  });

  doc.body.innerHTML = `
    <div class="pip-header">
      <span>LECTURE LENS · 即時置頂字幕</span>
      <span id="pipClock">${$('clock')?.textContent || '00:00:00'}</span>
    </div>
    <div id="pipRows"></div>
  `;
}

async function togglePiP() {
  if (pipWindow) {
    pipWindow.close();
    pipWindow = null;
    return;
  }

  if (!('documentPictureInPicture' in window)) {
    const popup = window.open('', 'LectureLensPiP', 'width=520,height=280,menubar=no,toolbar=no,location=no,status=no');
    if (!popup) {
      alert('請允許開啟彈出視窗以啟用懸浮字幕，或使用 Chrome 116+ 桌面版體驗原生置頂懸浮窗。');
      return;
    }
    pipWindow = popup;
    setupPiPDoc(popup.document);
    popup.addEventListener('pagehide', () => { pipWindow = null; });
    updatePiP();
    return;
  }

  try {
    pipWindow = await window.documentPictureInPicture.requestWindow({
      width: 520,
      height: 280
    });
    setupPiPDoc(pipWindow.document);
    pipWindow.addEventListener('pagehide', () => { pipWindow = null; });
    updatePiP();
  } catch (err) {
    status('無法開啟懸浮字幕：' + err.message);
  }
}

if ($('pip')) $('pip').onclick = togglePiP;

// --- One-Click AI Lecture Summary ---
async function generateSummary() {
  if (!records.length) {
    status('尚無演講字幕記錄可產出摘要');
    return;
  }
  const dialog = $('summaryDialog');
  const content = $('summaryContent');
  if (!dialog || !content) return;

  dialog.showModal();
  content.textContent = '✨ AI 正在深入分析演講逐字稿並提煉核心重點，請稍候…\n\n';

  try {
    const res = await fetch('/api/summary', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': token,
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({
        records: records.map(r => ({time: r.time, text: r.text, translation: r.translation})),
        context: $('context')?.value || '',
        target: $('target')?.value || 'Traditional Chinese (Taiwan)'
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `請求失敗 (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let summaryText='',complete=false;
    content.textContent='';
    const parser=new SSEParser((event,data)=>{
      if(event==='error')throw Error(data.error||'摘要生成失敗');
      if(event==='delta')summaryText+=data.delta||'';
      if(event==='done'){complete=true;if(data.summary!==undefined)summaryText=data.summary;}
      content.textContent=summaryText;content.scrollTop=content.scrollHeight;
    });
    while(true){const {done,value}=await reader.read();if(done)break;parser.push(decoder.decode(value,{stream:true}));}
    if(!complete)throw Error('摘要串流提早中斷');
  } catch (e) {
    content.textContent += '\n\n[摘要生成中斷：' + e.message + ']';
  }
}

if ($('summaryBtn')) $('summaryBtn').onclick = generateSummary;

if ($('copySummary')) {
  $('copySummary').onclick = async () => {
    const text = $('summaryContent')?.textContent || '';
    if (!text) return;
    await navigator.clipboard.writeText(text);
    const orig = $('copySummary').textContent;
    $('copySummary').textContent = '✅ 已複製！';
    setTimeout(() => { $('copySummary').textContent = orig; }, 2000);
  };
}

if ($('downloadSummary')) {
  $('downloadSummary').onclick = () => {
    const text = $('summaryContent')?.textContent || '';
    if (!text) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], {type: 'text/markdown;charset=utf-8'}));
    a.download = `lecture-summary-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}

// ==========================================
// ⇄ 雙向即時對話口譯模式 (Bidirectional Mode)
// ==========================================

async function switchMode(mode) {
  if(starting)return;
  if(mode==='conversation' && running)await stop();
  stopConvSpeech();
  convEpoch++;
  window.speechSynthesis?.cancel();
  if (mode === 'conversation') {
    if ($('navLecture')) $('navLecture').classList.remove('active');
    if ($('navConversation')) $('navConversation').classList.add('active');
    if ($('lectureView')) $('lectureView').style.display = 'none';
    if ($('conversationView')) $('conversationView').style.display = 'block';
  } else {
    if ($('navConversation')) $('navConversation').classList.remove('active');
    if ($('navLecture')) $('navLecture').classList.add('active');
    if ($('conversationView')) $('conversationView').style.display = 'none';
    if ($('lectureView')) $('lectureView').style.display = 'block';
  }
}

if ($('navLecture')) $('navLecture').onclick = () => switchMode('lecture');
if ($('navConversation')) $('navConversation').onclick = () => switchMode('conversation');

function updateConvLabels() {
  if (!$('convLangA') || !$('convLangB')) return;
  const optA = $('convLangA').selectedOptions[0];
  const optB = $('convLangB').selectedOptions[0];
  if ($('labelSpeakA') && optA) $('labelSpeakA').textContent = `說${optA.text.split('·')[0].trim()} (我方)`;
  if ($('labelSpeakB') && optB) $('labelSpeakB').textContent = `說${optB.text.split('·')[0].trim()} (對方)`;
}

if ($('convLangA')) $('convLangA').onchange = updateConvLabels;
if ($('convLangB')) $('convLangB').onchange = updateConvLabels;
if ($('convSwapLangs')) {
  $('convSwapLangs').onclick = () => {
    const tempVal = $('convLangA').value;
    $('convLangA').value = $('convLangB').value;
    $('convLangB').value = tempVal;
    updateConvLabels();
  };
}
updateConvLabels();

let convRecords = [];
let convActiveSpeaker = null; // 'A' | 'B' | null
let convRecognizer = null;
let convEpoch = 0;

function convStatus(t) {
  if ($('convStatus')) $('convStatus').textContent = t;
}

function speakTTS(text, langCode) {
  if (!('speechSynthesis' in window) || !text) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = langCode || 'en-US';
    u.rate = 1.0;
    window.speechSynthesis.speak(u);
  } catch {}
}
window.speakTTS = speakTTS;

function getConversationHistory() {
  return convRecords
    .filter(r => r.state === 'done' && r.text && r.translation)
    .slice(-4)
    .map(r => ({
      text: `[${r.speaker === 'A' ? 'Speaker A' : 'Speaker B'}]: ${r.text}`,
      translation: r.translation
    }));
}

function drawConvFeed() {
  const feed = $('convFeed');
  if (!feed) return;
  if (!convRecords.length) {
    feed.innerHTML = `
      <div class="conv-empty">
        <div class="sound">💬</div>
        <h2>隨時開始自然雙向對話</h2>
        <p>點擊下方「說中文」或「說外語」，系統會即時翻譯並由語音朗讀譯文給對方聽。</p>
      </div>
    `;
    if ($('convCount')) $('convCount').textContent = '0 則對話';
    return;
  }

  feed.innerHTML = convRecords.map(r => {
    const isA = r.speaker === 'A';
    const speakerName = isA ? '我方' : '對方';
    return `
      <div class="conv-bubble ${isA ? 'conv-bubble-a' : 'conv-bubble-b'}" id="conv-bubble-${r.id}">
        <div class="conv-bubble-meta">
          <span class="conv-bubble-speaker">${speakerName} · ${r.time}</span>
          ${r.translation ? `<button class="conv-tts-btn" data-record="${r.id}" title="朗讀譯文">🔊 朗讀</button>` : ''}
        </div>
        <div class="conv-original">${escapeHtml(r.text || r.interim || '正在辨識語音…')}</div>
        <div class="conv-translation">${escapeHtml(r.translation || (r.state === 'streaming' ? '正在即時翻譯…' : ''))}</div>
      </div>
    `;
  }).join('');

  for(const button of feed.querySelectorAll('.conv-tts-btn'))button.onclick=()=>{
    const r=convRecords.find(record=>record.id===button.dataset.record);
    if(r)speakTTS(r.translation,r.ttsLangCode);
  };
  if ($('convCount')) $('convCount').textContent = `${convRecords.length} 則對話`;
  feed.scrollTop = feed.scrollHeight;
}

async function translateConvRecord(record, text, targetLangStr, ttsLangCode) {
  record.text = text;
  record.ttsLangCode = ttsLangCode;
  record.translation = '';
  record.state = 'streaming';
  const epoch=convEpoch;
  drawConvFeed();

  try {
    const res = await fetch('/api/translate-stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': token,
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({
        text,
        target: targetLangStr,
        context: $('context')?.value || '',
        history: getConversationHistory()
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `請求失敗 (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let complete=false;
    const parser=new SSEParser((event,data)=>{
      if(event==='error')throw Error(data.error||'翻譯失敗');
      if(event==='delta')record.translation+=data.delta||'';
      if(event==='done'){complete=true;if(data.translation!==undefined)record.translation=data.translation;}
      drawConvFeed();
    });
    while(true){const {done,value}=await reader.read();if(done)break;parser.push(decoder.decode(value,{stream:true}));}
    if(!complete)throw Error('翻譯串流提早中斷，請重新送出');
    record.state='done';drawConvFeed();

    // Auto TTS
    if (epoch===convEpoch && !convActiveSpeaker && $('convAutoTTS')?.checked && record.translation) {
      speakTTS(record.translation, ttsLangCode);
    }
  } catch (err) {
    record.state = 'error';
    record.translation = `[翻譯異常: ${err.message}]`;
    drawConvFeed();
  }
}

function sendManualConv(speaker) {
  const input = $('convTextInput');
  const text = input?.value.trim();
  if (!text) return;
  if(!configured){$('dialog').showModal();convStatus('請先設定自己的 API 金鑰');return;}
  input.value = '';

  const isA = speaker === 'A';
  const targetOpt = isA ? $('convLangB').selectedOptions[0] : $('convLangA').selectedOptions[0];
  const targetStr = targetOpt.dataset.target || targetOpt.text;
  const ttsCode = targetOpt.value;

  const rec = {
    id: crypto.randomUUID(),
    speaker,
    time: formatTime(),
    text,
    translation: '',
    state: 'pending'
  };
  convRecords.push(rec);
  translateConvRecord(rec, text, targetStr, ttsCode);
}

if ($('convSendA')) $('convSendA').onclick = () => sendManualConv('A');
if ($('convSendB')) $('convSendB').onclick = () => sendManualConv('B');
if ($('convTextInput')) {
  $('convTextInput').onkeydown = e => {
    if (e.key === 'Enter') sendManualConv('A');
  };
}

function toggleTalk(speaker) {
  if (convActiveSpeaker === speaker) {
    stopConvSpeech();
    return;
  }
  if (convActiveSpeaker) {
    stopConvSpeech();
  }
  startConvSpeech(speaker);
}

function startConvSpeech(speaker) {
  if(!configured){$('dialog').showModal();convStatus('請先設定自己的 API 金鑰');return;}
  if($('convLangA').value===$('convLangB').value){convStatus('請選擇不同的雙方語言');return;}
  window.speechSynthesis?.cancel();
  const epoch=++convEpoch;
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isA = speaker === 'A';
  const langOpt = isA ? $('convLangA').selectedOptions[0] : $('convLangB').selectedOptions[0];
  const targetOpt = isA ? $('convLangB').selectedOptions[0] : $('convLangA').selectedOptions[0];
  const langCode = langOpt.value;
  const targetStr = targetOpt.dataset.target || targetOpt.text;
  const ttsCode = targetOpt.value;

  convActiveSpeaker = speaker;
  const btn = isA ? $('btnSpeakA') : $('btnSpeakB');
  if (btn) {
    btn.classList.add('recording');
    const titleEl = btn.querySelector('.talk-title');
    if (titleEl) titleEl.textContent = '■ 正在收音 (點擊結束)';
  }
  convStatus(`● 正在聆聽${isA ? '我方' : '對方'}說話…`);

  if (SpeechRec) {
    convRecognizer = new SpeechRec();
    convRecognizer.continuous = true;
    convRecognizer.interimResults = true;
    convRecognizer.lang = langCode;

    const recognizer=convRecognizer;
    let currentRec = null;

    convRecognizer.onresult = e => {
      if(epoch!==convEpoch)return;
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += transcript;
        else interim += transcript;
      }

      if (!currentRec) {
        currentRec = {
          id: crypto.randomUUID(),
          speaker,
          time: formatTime(),
          text: '',
          interim: interim,
          translation: '',
          state: 'pending'
        };
        convRecords.push(currentRec);
      } else {
        currentRec.interim = interim;
      }
      drawConvFeed();

      if (final.trim()) {
        currentRec.text = final.trim();
        currentRec.interim = '';
        const toTranslate = currentRec;
        currentRec = null;
        stopConvSpeech();
        translateConvRecord(toTranslate, toTranslate.text, targetStr, ttsCode);
      }
    };

    convRecognizer.onerror = err => {
      if(epoch!==convEpoch)return;
      if (err.error !== 'no-speech') {
        convStatus('收音提示：' + err.error);
      }
    };

    convRecognizer.onend = () => {
      if (convRecognizer===recognizer && convActiveSpeaker === speaker) {
        stopConvSpeech();
      }
    };

    try {
      convRecognizer.start();
    } catch (e) {
      convStatus('無法啟動麥克風：' + e.message);
      stopConvSpeech();
    }
  } else {
    alert('此瀏覽器不支援原生 Web Speech API，請使用 Chrome 桌面版進行語音收音，或使用手動打字發送。');
    stopConvSpeech();
  }
}

function stopConvSpeech() {
  if (convRecognizer) {
    const recognizer=convRecognizer;convRecognizer=null;
    try { recognizer.stop(); } catch {}
  }
  convActiveSpeaker = null;
  if ($('btnSpeakA')) $('btnSpeakA').classList.remove('recording');
  if ($('btnSpeakB')) $('btnSpeakB').classList.remove('recording');
  updateConvLabels();
  convStatus('○ 準備就緒，點擊下方按鈕即可開口說話');
}

if ($('btnSpeakA')) $('btnSpeakA').onclick = () => toggleTalk('A');
if ($('btnSpeakB')) $('btnSpeakB').onclick = () => toggleTalk('B');

if ($('convClear')) {
  $('convClear').onclick = () => {
    if (convRecords.length && !confirm('確定清除目前的對話紀錄？')) return;
    stopConvSpeech();convEpoch++;window.speechSynthesis?.cancel();
    convRecords = [];
    drawConvFeed();
    convStatus('○ 對話紀錄已清空');
  };
}

if ($('convExport')) {
  $('convExport').onclick = () => {
    if (!convRecords.length) {
      alert('尚無對話紀錄可匯出');
      return;
    }
    const text = '# 雙向即時口譯對話紀錄\n\n' +
      convRecords.map(r => `### [${r.time}] ${r.speaker === 'A' ? '我方' : '對方'}\n- **原文**：${r.text}\n- **譯文**：${r.translation}\n`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], {type: 'text/markdown;charset=utf-8'}));
    a.download = `conversation-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}


window.addEventListener("pagehide",()=>{stopConvSpeech();window.speechSynthesis?.cancel();});
