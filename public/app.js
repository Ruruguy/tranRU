import {apiFetch as fetch} from './api-client.js';
import {classifyServiceError} from './service-errors.js';
import {GeminiLiveClient, PCMChunks, SSEParser} from './gemini-client.js';
import {selectSummaryRecords} from './summary-core.js';
const $ = id => document.getElementById(id);

let token = '';
let configured = false;
let openaiBlocked = false;
let openaiConfigured = false, geminiConfigured = false;
let gemini = null, pcm = null, liveRecord = null;
let geminiSecond = null, secondLiveRecord = null;
let geminiThird = null, thirdLiveRecord = null;
let liveBatch = '', liveTurnCounts = [0, 0, 0];
const canStart = () => $('engine').value === 'free' ? true : $('engine').value === 'gemini' ? geminiConfigured : (openaiConfigured || geminiConfigured);
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
let summarySessionId = 'legacy';
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
$('engine').onchange = () => {
  if ($('engine').value === 'free') {
    status('○ 準備就緒（免金鑰即時模式）');
  } else {
    status(canStart() ? '○ 準備就緒' : '○ 請先設定所選服務的 API 金鑰');
  }
};
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
  const enabled = $('dualTranslation') ? $('dualTranslation').checked : false;
  if ($('secondTargetLabel')) $('secondTargetLabel').hidden = !enabled;
  $('tripleLabel').hidden = !enabled;
  if (!enabled) $('tripleTranslation').checked = false;
  const triple = enabled && $('tripleTranslation').checked;
  $('thirdTargetLabel').hidden = !triple;
  $('colHeadTarget3').hidden = !triple;
  $('colHeadTarget3').textContent = '第三語言 · ' + $('thirdTarget').selectedOptions[0].textContent;
  $('panelHead').classList.toggle('triple-layout', triple);
  if ($('dualHint')) $('dualHint').hidden = !enabled;
  if ($('secondPanel')) $('secondPanel').hidden = true;

  const panelHead = $('panelHead');
  const colHeadTarget2 = $('colHeadTarget2');
  if (panelHead && colHeadTarget2) {
    if (enabled) {
      panelHead.classList.add('dual-3col');
      colHeadTarget2.hidden = false;
      const t1 = $('target')?.selectedOptions?.[0]?.textContent || $('target')?.value || '即時口譯';
      const t2 = $('secondTarget')?.selectedOptions?.[0]?.textContent || $('secondTarget')?.value || '第二語言';
      if ($('colHeadSpeaker')) $('colHeadSpeaker').innerHTML = `講者原文 <small>SPEAKER</small>`;
      if ($('colHeadTarget1')) $('colHeadTarget1').innerHTML = `翻譯語言 · ${escapeHtml(t1)} <small id="headTarget1">TARGET 1</small>`;
      if ($('colHeadTarget2')) $('colHeadTarget2').innerHTML = `另選語言 · ${escapeHtml(t2)} <small id="headTarget2">TARGET 2</small>`;
    } else {
      panelHead.classList.remove('dual-3col');
      colHeadTarget2.hidden = true;
      const t1 = $('target')?.selectedOptions?.[0]?.textContent || $('target')?.value || '即時口譯';
      if ($('colHeadSpeaker')) $('colHeadSpeaker').innerHTML = `講者原文 <small>ORIGINAL SPEECH</small>`;
      if ($('colHeadTarget1')) $('colHeadTarget1').innerHTML = `即時口譯 <small id="headTarget1">${escapeHtml(t1.toUpperCase())}</small>`;
    }
  }
  if (typeof draw === 'function') draw();
}
if ($('dualTranslation')) $('dualTranslation').onchange = syncDualUI;
if ($('secondTarget')) $('secondTarget').onchange = syncDualUI;
if ($('target')) $('target').addEventListener('change', syncDualUI);
$('tripleTranslation').onchange = syncDualUI;
$('thirdTarget').onchange = syncDualUI;
syncDualUI();

// UI Controls
if ($('font')) $('font').oninput = () => document.documentElement.style.setProperty('--subtitle', $('font').value + 'px');
function syncCompactControls() {
  if ($('exitCompact')) {
    $('exitCompact').hidden = !document.body.classList.contains('focus') && !document.fullscreenElement;
  }
}
if ($('focus')) {
  $('focus').onclick = async () => {
    const isFocus = document.body.classList.toggle('focus');
    try {
      if (isFocus) {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen().catch(() => {});
        }
      } else {
        if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen().catch(() => {});
        }
      }
    } catch {}
    syncCompactControls();
  };
}
if ($('fullscreen')) {
  $('fullscreen').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else { document.body.classList.add('focus'); status('已開啟演講模式'); }
    } catch {
      document.body.classList.add('focus');
      status('已開啟演講模式');
    }
    syncCompactControls();
  };
}
if ($('exitCompact')) {
  $('exitCompact').onclick = async () => {
    document.body.classList.remove('focus');
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    syncCompactControls();
  };
}
document.addEventListener('fullscreenchange', syncCompactControls);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.body.classList.remove('focus');
    syncCompactControls();
  }
});

// Audio-Reactive Voice Glow (演講過程隨聲調輕微光影波動)
let voiceGlowEnabled = localStorage.getItem('tranru_voice_glow') !== 'false';
let currentGlowOpacity = 0.28;
let currentGlowScale = 1.0;
let currentGlowSpread = 44;
let currentGlowHue = 242;

let targetGlowOpacity = 0.28;
let targetGlowScale = 1.0;
let targetGlowSpread = 44;
let targetGlowHue = 242;

function syncVoiceGlowBtn() {
  const btn = $('btnVoiceGlow');
  if (!btn) return;
  if (voiceGlowEnabled) {
    btn.classList.add('active');
    btn.textContent = '✨ 聲波光影 ON';
    btn.setAttribute('aria-pressed', 'true');
  } else {
    btn.classList.remove('active');
    btn.textContent = '✨ 聲波光影 OFF';
    btn.setAttribute('aria-pressed', 'false');
  }
}

function updateAudioReactiveGlow(rms, zcr) {
  if (!voiceGlowEnabled) return;
  if (rms > 0.005) {
    const normalizedEnergy = Math.min(1.0, Math.pow(rms * 9.5, 0.78));
    targetGlowOpacity = Math.min(0.85, 0.28 + normalizedEnergy * 0.55);
    targetGlowScale = 1.0 + Math.min(0.065, normalizedEnergy * 0.065);
    targetGlowSpread = 44 + Math.min(75, normalizedEnergy * 70);
    // Dynamic hue shift responding to speech tone/pitch frequency proxy (zcr)
    const pitchShift = Math.max(-14, Math.min(38, ((zcr || 0.08) - 0.06) * 320));
    targetGlowHue = 242 + pitchShift;
  }
}

function initVoiceGlow() {
  const btn = $('btnVoiceGlow');
  if (btn) {
    syncVoiceGlowBtn();
    btn.onclick = () => {
      voiceGlowEnabled = !voiceGlowEnabled;
      localStorage.setItem('tranru_voice_glow', voiceGlowEnabled ? 'true' : 'false');
      syncVoiceGlowBtn();
    };
  }

  function renderVoiceGlowLoop() {
    if (!voiceGlowEnabled) {
      targetGlowOpacity = 0;
      targetGlowScale = 1.0;
      targetGlowSpread = 30;
    }

    const lerpFactor = 0.14;
    currentGlowOpacity += (targetGlowOpacity - currentGlowOpacity) * lerpFactor;
    currentGlowScale += (targetGlowScale - currentGlowScale) * (lerpFactor * 0.85);
    currentGlowSpread += (targetGlowSpread - currentGlowSpread) * lerpFactor;
    currentGlowHue += (targetGlowHue - currentGlowHue) * (lerpFactor * 0.7);

    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--voice-glow-opacity', currentGlowOpacity.toFixed(3));
    rootStyle.setProperty('--voice-glow-scale', currentGlowScale.toFixed(3));
    rootStyle.setProperty('--voice-glow-spread', currentGlowSpread.toFixed(1) + 'px');
    rootStyle.setProperty('--voice-glow-hue', currentGlowHue.toFixed(1) + 'deg');

    if (voiceGlowEnabled) {
      if (running || convActiveSpeaker) {
        targetGlowOpacity += (0.24 - targetGlowOpacity) * 0.08;
        targetGlowScale += (1.0 - targetGlowScale) * 0.08;
        targetGlowSpread += (44 - targetGlowSpread) * 0.08;
        targetGlowHue += (242 - targetGlowHue) * 0.05;
      } else {
        targetGlowOpacity += (0.16 - targetGlowOpacity) * 0.05;
        targetGlowScale += (1.0 - targetGlowScale) * 0.05;
        targetGlowSpread += (36 - targetGlowSpread) * 0.05;
      }
    }

    requestAnimationFrame(renderVoiceGlowLoop);
  }
  requestAnimationFrame(renderVoiceGlowLoop);
}
initVoiceGlow();

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
    const serialized = records.map(({audio, ...r}) => ({
      ...r,
      state: r.state === 'streaming' || r.state === 'pending' ? 'error' : r.state,
      error: (r.state === 'streaming' || r.state === 'pending') ? '頁面關閉前未完成' : r.error
    }));
    localStorage.setItem('lecture-lens-transcript', JSON.stringify(serialized));
    $('storageWarning')?.remove();
  } catch {
    if (!$('storageWarning')) {
      const warning=document.createElement('div');warning.id='storageWarning';warning.setAttribute('role','alert');
      warning.textContent='⚠ 逐字稿未完整儲存：瀏覽器空間不足或禁止儲存，請立即匯出逐字稿後再關閉頁面。';
      warning.style.cssText='position:sticky;top:0;z-index:9999;background:#8b1616;color:white;padding:16px;font-weight:bold';
      document.body.prepend(warning);
    }
  }
}

// Load previous history
try {
  records = JSON.parse(localStorage.getItem('lecture-lens-transcript') || '[]');
  if (!Array.isArray(records)) records = [];
  records=records.map(r=>({...r,sessionId:r.sessionId||'legacy'}));
  summarySessionId=records.findLast(r=>!r.secondary && !r.demo)?.sessionId||'legacy';
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
  if ($('secondRows')) $('secondRows').replaceChildren();
  if ($('secondPanel')) $('secondPanel').hidden = true;

  const isDual = $('dualTranslation') ? $('dualTranslation').checked : false;
  const isTriple = isDual && $('tripleTranslation').checked;

  if (!records.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = `
      <div class="sound">▂ ▅ ▃ ▇ ▅ ▂ ▄</div>
      <h2>把注意力，留給演講。</h2>
      <p>選擇 Gemini 即時翻譯，或使用免金鑰/OpenAI 模式。<br>原文與譯文將在這裡呈現。</p>
      <button id="demoBtn">先看看字幕示範 ↗</button>
    `;
    empty.querySelector('#demoBtn').onclick = injectDemo;
    el.append(empty);
    $('count').textContent = '0';
    return;
  }

  const primaryRecords = records.filter(r => !r.secondary);

  for (const r of primaryRecords) {
    const sec = isDual
      ? records.find(s => s.secondary && s.languageSlot !== 3 && (s.parentId === r.id || (!s.parentId && s.id === r.secondId) || (!s.parentId && s.time === r.time && s.sessionId === r.sessionId)))
      : null;

    const row = document.createElement('div');
    const isStreaming = r.state === 'streaming' || r.state === 'pending' || (sec && (sec.state === 'streaming' || sec.state === 'pending'));
    row.className = (isTriple ? 'row triple-layout' : isDual ? 'row row-dual-3col' : 'row') + (isStreaming ? ' live-active' : '');
    row.id = 'row-' + r.id;

    // 1st Column: 講者原文
    const cellA = document.createElement('div');
    cellA.className = 'cell';
    const timeElem = document.createElement('time');
    timeElem.textContent = r.time + (r.demo ? ' · 示範' : '');
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

    // 2nd Column: 翻譯為（目標語言 1）
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

    // 3rd Column: 另一個選擇的語言（目標語言 2）
    if (isDual) {
      const cellC = document.createElement('div');
      cellC.className = 'cell';
      if (sec) {
        if (sec.state === 'pending' && !sec.translation) {
          cellC.textContent = '準備第二語言…';
        } else if (sec.state === 'streaming') {
          cellC.textContent = sec.translation || '';
          const cursor = document.createElement('span');
          cursor.className = 'streaming-cursor';
          cellC.append(cursor);
        } else if (sec.state === 'error') {
          cellC.classList.add('failed');
          cellC.textContent = classifyServiceError(sec.error).message || '第二語言失敗';
        } else {
          cellC.textContent = sec.translation || '';
        }
      } else {
        if (r.state === 'pending' || r.state === 'streaming') {
          cellC.textContent = '等待第二語言…';
        } else {
          cellC.textContent = r.secondTranslation || '';
        }
      }
      row.append(cellC);
    }

    if (isTriple) {
      const third = records.find(s => s.secondary && s.languageSlot === 3 && s.parentId === r.id);
      const cell = document.createElement('div'); cell.className = 'cell';
      cell.textContent = third ? (third.state === 'error' ? (third.error || '第三語言失敗') : (third.translation || '等待第三語言…')) : '等待第三語言…';
      row.append(cell);
    }
    el.append(row);
  }

  $('count').textContent = primaryRecords.length;
  if ($('autoscroll').checked && nearBottom) {
    el.scrollTop = el.scrollHeight;
  }
  if (typeof updatePiP === 'function') updatePiP();
}

function updateStreamingRow(record) {
  if (record.languageSlot === 3 || $('tripleTranslation').checked) { draw(); return; }
  let row = null;
  const isDual = $('dualTranslation') ? $('dualTranslation').checked : false;

  if (record.secondary) {
    if (record.parentId) {
      row = $('row-' + record.parentId);
    }
    if (!row) {
      const primary = records.find(r => !r.secondary && (r.id === record.parentId || (r.time === record.time && r.sessionId === record.sessionId)));
      if (primary) row = $('row-' + primary.id);
    }
    if (!row) {
      draw();
      return;
    }
    const cells = row.querySelectorAll('.cell');
    if (cells.length >= 3) {
      if (record.state === 'streaming') {
        cells[2].textContent = record.translation || '';
        const cursor = document.createElement('span');
        cursor.className = 'streaming-cursor';
        cells[2].append(cursor);
        row.classList.add('live-active');
      } else if (record.state === 'done') {
        cells[2].textContent = record.translation || '';
        const primary = records.find(r => !r.secondary && r.id === (record.parentId || row.id.replace('row-', '')));
        if (!primary || primary.state === 'done' || primary.state === 'error') {
          row.classList.remove('live-active');
        }
      } else if (record.state === 'error') {
        cells[2].classList.add('failed');
        cells[2].textContent = record.error || '第二語言失敗';
        const primary = records.find(r => !r.secondary && r.id === (record.parentId || row.id.replace('row-', '')));
        if (!primary || primary.state === 'done' || primary.state === 'error') {
          row.classList.remove('live-active');
        }
      }
    }
  } else {
    row = $('row-' + record.id);
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

      // Translation cell 1
      if (record.state === 'streaming') {
        cells[1].textContent = record.translation || '';
        const cursor = document.createElement('span');
        cursor.className = 'streaming-cursor';
        cells[1].append(cursor);
        row.classList.add('live-active');
      } else if (record.state === 'done') {
        cells[1].textContent = record.translation || '';
        const sec = records.find(s => s.secondary && s.parentId === record.id);
        if (!sec || sec.state === 'done' || sec.state === 'error') {
          row.classList.remove('live-active');
        }
      } else if (record.state === 'error') {
        cells[1].classList.add('failed');
        cells[1].textContent = record.error || '失敗';
        const sec = records.find(s => s.secondary && s.parentId === record.id);
        if (!sec || sec.state === 'done' || sec.state === 'error') {
          row.classList.remove('live-active');
        }
      }

      // Translation cell 2 if exists
      if (cells.length >= 3) {
        const sec = records.find(s => s.secondary && s.parentId === record.id);
        if (sec) {
          if (sec.state === 'streaming') {
            cells[2].textContent = sec.translation || '';
            const cursor = document.createElement('span');
            cursor.className = 'streaming-cursor';
            cells[2].append(cursor);
          } else if (sec.state === 'done') {
            cells[2].textContent = sec.translation || '';
          } else if (sec.state === 'error') {
            cells[2].classList.add('failed');
            cells[2].textContent = sec.error || '第二語言失敗';
          }
        }
      }
    }
  }

  if ($('autoscroll').checked) {
    const el = $('rows');
    el.scrollTop = el.scrollHeight;
  }
  if (typeof updatePiP === 'function') updatePiP();
}

function newRecord(data) {
  const r = {
    id: crypto.randomUUID(),
    sessionId: summarySessionId,
    time: formatTime(),
    state: 'pending',
    text: '',
    translation: '',
    language: $('language').value,
    target: $('target').value,
    secondTarget: $('dualTranslation').checked ? $('secondTarget').value : null,
    thirdTarget: $('dualTranslation').checked && $('tripleTranslation').checked ? $('thirdTarget').value : null,
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
      const second=newRecord({secondary:true,sessionId:record.sessionId,parentId:record.id,text:record.text,target:record.secondTarget,secondTarget:null});
      streamRecord(second,'translate-stream',{text:second.text,target:second.target,context:second.context,history:[]});
    }
    if(!record.secondary && record.thirdTarget && record.text.trim() && !record.thirdRequested){
      record.thirdRequested=true;
      const third=newRecord({secondary:true,languageSlot:3,sessionId:record.sessionId,parentId:record.id,text:record.text,target:record.thirdTarget,secondTarget:null,thirdTarget:null});
      streamRecord(third,'translate-stream',{text:third.text,target:third.target,context:third.context,history:[]});
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
  if (r.engine === 'free' && r.text) {
    translateFreeRecord(r);
  } else if (r.audio) {
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
    de: 'de-DE',
    bn: 'bn-BD'
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
      updateAudioReactiveGlow(0.045, 0.12);
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
      if ($('engine').value === 'free') {
        translateFreeRecord(rec);
      } else {
        streamRecord(rec, 'translate-stream', {
          text: rec.text,
          target: rec.target,
          context: rec.context,
          history: getRecentHistory()
        });
      }
    }
  };

  speechRecognizer.onerror = event => {
    if (event.error !== 'no-speech') {
      status(`語音辨識注意：${event.error}`);
    }
  };

  speechRecognizer.onend = () => {
    if (running && ($('engine').value === 'native' || $('engine').value === 'free')) {
      try {
        speechRecognizer.start();
      } catch {}
    }
  };

  speechRecognizer.start();
}

// Free Non-API Translation (免金鑰即時翻譯：Chrome 內建 AI 翻譯 / 免費網頁翻譯)
function mapToGoogleLang(langStr) {
  if (!langStr) return 'auto';
  const l = String(langStr).trim().toLowerCase();
  const aliases = {'traditional chinese (taiwan)':'zh-TW','chinese':'zh-TW','中文':'zh-TW','繁體中文':'zh-TW',english:'en',japanese:'ja','日文':'ja',korean:'ko','韓文':'ko',spanish:'es','西班牙文':'es',french:'fr','法文':'fr',german:'de','德文':'de',bengali:'bn',bangla:'bn','孟加拉語':'bn'};
  if (aliases[l]) return aliases[l];
  const base = l.split('-')[0];
  return ({zh:'zh-TW',en:'en',ja:'ja',ko:'ko',es:'es',fr:'fr',de:'de',bn:'bn'})[base] || 'auto';
}

function applyGlossaryToText(text, sourceLang, targetLang) {
  const rawGlossary = $('context')?.value || '';
  if (!rawGlossary.trim() || !text) return text;
  let out = text;
  const isZhSource = sourceLang === 'zh-TW' || sourceLang === 'zh';
  const isZhTarget = targetLang === 'zh-TW' || targetLang === 'zh';
  const lines = rawGlossary.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('[') || trimmed.startsWith('【')) continue;
    if (trimmed.includes('=')) {
      const parts = trimmed.split('=');
      const zh = parts[0]?.trim();
      const en = parts[1]?.trim();
      if (zh && en) {
        if (isZhSource) out = out.split(zh).join(' ' + en + ' ');
        else if (isZhTarget) out = out.replace(new RegExp('\\b' + en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), zh);
      }
    } else if (trimmed.startsWith('-')) {
      const match = trimmed.match(/^-\s*([^:]+):\s*([^|]+)(?:\|\s*(.+))?$/);
      if (match) {
        const zh = match[1]?.trim();
        const en = match[2]?.split('/')[0]?.trim();
        const ja = match[3]?.split('・')[0]?.trim();
        if (zh && en) {
          if (isZhSource && (targetLang === 'en' || targetLang === 'en-US')) out = out.split(zh).join(' ' + en + ' ');
          else if (isZhSource && targetLang === 'ja' && ja) out = out.split(zh).join(' ' + ja + ' ');
        }
      }
    }
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

async function translateWithChromeAI(text, sourceLangCode, targetLangCode) {
  if (typeof window !== 'undefined' && 'Translator' in window) {
    try {
      const avail = await window.Translator.availability({
        sourceLanguage: sourceLangCode,
        targetLanguage: targetLangCode
      });
      if (avail === 'readily' || avail === 'available') {
        const tr = await window.Translator.create({
          sourceLanguage: sourceLangCode,
          targetLanguage: targetLangCode
        });
        return await tr.translate(text);
      }
    } catch {}
  }
  return null;
}

async function translateFree(text, sourceLang, targetLang) {
  const s = mapToGoogleLang(sourceLang);
  const t = mapToGoogleLang(targetLang);
  const preparedText = applyGlossaryToText(text, s, t);

  const chromeResult = await translateWithChromeAI(preparedText, s === 'zh-TW' ? 'zh-Hant' : s, t === 'zh-TW' ? 'zh-Hant' : t);
  if (chromeResult) return chromeResult;

  try {
    const res = await fetch('/api/free-translate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Session-Token': token},
      body: JSON.stringify({
        text: preparedText,
        source: s,
        target: t
      })
    });
    if (!res.ok) throw new Error('免費翻譯端點回應 ' + res.status);
    const data = await res.json();
    return data.translation;
  } catch {
    const directUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${s}&tl=${t}&q=${encodeURIComponent(preparedText)}`;
    const dRes = await globalThis.fetch(directUrl);
    if (!dRes.ok) throw new Error('免費翻譯連線失敗 HTTP ' + dRes.status);
    const j = await dRes.json();
    return (j[0] || []).map(x => x[0]).join('');
  }
}

async function translateFreeRecord(record) {
  record.engine = 'free';
  record.translation = '';
  record.state = 'streaming';
  updateStreamingRow(record);
  try {
    const translation = await translateFree(record.text, $('language').value, record.target);
    record.translation = translation;
    record.state = 'done';
    updateStreamingRow(record);
    if (!record.secondary && record.secondTarget && record.text.trim() && !record.secondRequested) {
      record.secondRequested = true;
      const second = newRecord({
        secondary: true,
        sessionId: record.sessionId,
        parentId: record.id,
        text: record.text,
        target: record.secondTarget,
        secondTarget: null
      });
      translateFreeRecord(second);
    }
    if (!record.secondary && record.thirdTarget && record.text.trim() && !record.thirdRequested) {
      record.thirdRequested = true;
      const third = newRecord({secondary:true,languageSlot:3,sessionId:record.sessionId,parentId:record.id,text:record.text,target:record.thirdTarget,secondTarget:null,thirdTarget:null});
      translateFreeRecord(third);
    }
    persist();
  } catch (err) {
    record.state = 'error';
    record.error = `免費翻譯失敗：${err.message}`;
    record.translation = '';
    updateStreamingRow(record);
    persist();
  }
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
    const tail = pcm?.tail(); if(tail){gemini.send(tail);geminiSecond?.send(tail);geminiThird?.send(tail);}
    await Promise.allSettled([gemini.end(),geminiSecond?.end(),geminiThird?.end()]);
    geminiSecond=null;finishLiveRecord(false,true);geminiThird=null;finishLiveRecord(false,3);
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
  for (const id of ['source', 'engine', 'language', 'target', 'dualTranslation', 'secondTarget', 'tripleTranslation', 'thirdTarget']) $(id).disabled = false;
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
  if ($('engine').value === 'free' && $('source').value === 'tab') {
    status('免金鑰模式僅支援麥克風；分頁音訊請選 Gemini 或 OpenAI。');return;
  }
  if (['free','native'].includes($('engine').value) && $('language').value === 'auto') {
    status('瀏覽器語音辨識不支援自動偵測，請選擇演講語言。');return;
  }
  if ($('dualTranslation').checked && $('tripleTranslation').checked && [$('target').value,$('secondTarget').value].includes($('thirdTarget').value)) {status('請選擇三種不同的目標語言');return;}
  starting = true;
  for(const id of ['source','engine','language','target','dualTranslation','secondTarget','tripleTranslation','thirdTarget'])$(id).disabled=true;
  $('start').disabled = true;
  openaiBlocked = false;
  const currentSession = ++session;
  liveBatch = crypto.randomUUID();
  liveTurnCounts = [0, 0, 0];
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
    if (gemini && $('dualTranslation').checked && $('tripleTranslation').checked) {
      geminiThird = new GeminiLiveClient({token,onEvent:(event,data)=>handleGeminiEvent(event,data,3),onFailure:error=>handleThirdFailure(error)});
      try { await geminiThird.connect($('thirdTarget').value); }
      catch(e) { geminiThird?.close();geminiThird=null; $('secondStatus').textContent='第三語言連線失敗：'+e.message; }
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

      // Volume & VU Meter calculation + Voice Tone Zero-Crossing calculation
      let sum = 0;
      let zeroCrossings = 0;
      for (let i = 0; i < copy.length; i++) {
        sum += copy[i] * copy[i];
        if (i > 0 && ((copy[i] >= 0 && copy[i - 1] < 0) || (copy[i] < 0 && copy[i - 1] >= 0))) {
          zeroCrossings++;
        }
      }
      const rms = Math.sqrt(sum / copy.length);
      const zcr = zeroCrossings / copy.length;
      const meterPercent = Math.min(100, Math.round(rms * 450));
      $('meterFill').style.width = meterPercent + '%';

      // Audio-reactive ambient light ripples (動態聲波光影波動)
      updateAudioReactiveGlow(rms, zcr);

      if (gemini) {for(const chunk of pcm.push(copy)){gemini?.send(chunk);geminiSecond?.send(chunk);geminiThird?.send(chunk);} return;}
      if ($('engine').value === 'native' || $('engine').value === 'free') return; // Handled by Web Speech API

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

    if ($('engine').value === 'native' || $('engine').value === 'free') {
      startNativeSpeech();
    }

    for (const t of stream.getTracks()) {
      t.onended = () => {
        if (running) stop();
      };
    }

    $('start').textContent = '■ 停止聆聽';
    for (const id of ['source', 'engine', 'language', 'target', 'dualTranslation', 'secondTarget', 'tripleTranslation', 'thirdTarget']) $(id).disabled = true;
    $('badge').textContent = gemini ? 'Gemini 串流' : $('engine').value === 'free' ? '免金鑰模式' : 'OpenAI 模式';
    status(gemini ? '● Gemini 即時翻譯 · 語言自動偵測' : $('engine').value === 'free' ? '● 免金鑰即時模式 · 語音由瀏覽器即時辨識' : fallbackReason ? '● Gemini 無法啟動，已切換 OpenAI：'+fallbackReason : '● OpenAI 即時口譯');

    try {
      wake = await navigator.wakeLock?.request('screen');
    } catch {}
  } catch (e) {
    gemini?.close(); gemini=null; pcm=null;
    geminiSecond?.close();geminiSecond=null;geminiThird?.close();geminiThird=null;
    stream?.getTracks().forEach(t => t.stop());
    if (ctx) await ctx.close().catch(() => {});
    ctx = null;
    stream = null;
    running = false;
    $('meterFill').style.width = '0%';
    status('無法啟動：' + e.message);
  } finally {
    starting = false;
    if(!running)for(const id of ['source','engine','language','target','dualTranslation','secondTarget','tripleTranslation','thirdTarget'])$(id).disabled=false;
    $('start').disabled = false;
  }
};

// Manual Text Translation with Streaming
if ($('translate')) {
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
}

// Demo Subtitles
function injectDemo() {
  const primary = newRecord({
    demo: true,
    state: 'done',
    text: 'The most important thing is not to stop questioning. Curiosity has its own reason for existing.',
    translation: '最重要的是不要停止提問。好奇心本身，就有其存在的理由。'
  });
  if ($('dualTranslation').checked) {
    newRecord({
      secondary: true,
      parentId: primary.id,
      demo: true,
      state: 'done',
      text: primary.text,
      target: $('secondTarget').value,
      secondTarget: null,
      translation: ({
        'Japanese': '最も大切なのは、問い続けることです。好奇心そのものに、存在する理由があります。',
        'English': 'The most important thing is not to stop questioning. Curiosity has its own reason for existing.',
        'Traditional Chinese (Taiwan)': '最重要的是不要停止提問。好奇心本身，就有其存在的理由。'
      })[$('secondTarget').value] || '最も大切なのは、問い続けることです。'
    });
  }
  persist();
  status($('dualTranslation').checked ? '○ 示範字幕 · 三欄對照呈現' : '○ 示範字幕 · 雙向對照呈現');
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
  summarySessionId = crypto.randomUUID();
  elapsed = 0;
  persist();
  draw();
  status('○ 紀錄已清除');
};

$('newSession').onclick = () => {
  if (running || starting || records.some(r => r.state === 'streaming' || r.state === 'pending')) {
    status('請先停止聆聽並等候翻譯完成，再開始新場次。');return;
  }
  summarySessionId = crypto.randomUUID();
  status('○ 已開始新場次；先前字幕仍保留，可匯出逐字稿。');
};

window.addEventListener('beforeunload', e => {
  if (running || records.some(r => r.state === 'streaming')) {
    e.preventDefault();
    e.returnValue = '';
  }
});

function finishLiveRecord(interrupted,secondary=false) {
 const r=secondary===3?thirdLiveRecord:secondary?secondLiveRecord:liveRecord;
 if(!r)return;
 if(!r.text && !r.translation)records=records.filter(x=>x!==r);
 else {r.state=interrupted || !r.translation?'error':'done';if(r.state==='error')r.error='Gemini 字幕未完成；中斷期間可能缺字。';}
 if(secondary===3)thirdLiveRecord=null;else if(secondary)secondLiveRecord=null;else liveRecord=null;
 draw();persist();
}
function handleGeminiEvent(event,data,secondary=false) {
 if(event==='turn'){finishLiveRecord(false,secondary);return;}
 if((event!=='input' && event!=='output')||!data.text)return;
 let r=secondary===3?thirdLiveRecord:secondary?secondLiveRecord:liveRecord;
 if(!r){
   const slot=secondary===3?3:secondary?2:1;
   const turn=liveTurnCounts[slot-1]++;
   const primary=records.find(item=>!item.secondary && item.liveBatch===liveBatch && item.liveTurn===turn);
   r=newRecord({
     provider:'gemini',
     state:'streaming',
     secondary:!!secondary,
     languageSlot:slot, liveBatch, liveTurn:turn,
     parentId: secondary ? (primary?.id || null) : null,
     target:secondary===3?$('thirdTarget').value:secondary?$('secondTarget').value:$('target').value,
     secondTarget:null
   });
   if(secondary===3){
     thirdLiveRecord=r;
   } else if(secondary){
     secondLiveRecord=r;
   } else {
     liveRecord=r;
     for (const item of records) if(item.secondary && item.liveBatch===liveBatch && item.liveTurn===turn && !item.parentId) item.parentId=r.id;
   }
 }
 if(event==='input')r.text+=data.text;else r.translation+=data.text;
 if(secondary)$('secondStatus').textContent='● 第二語言即時翻譯中';
 updateStreamingRow(r);
}
function handleThirdFailure(error){
 geminiThird?.close();geminiThird=null;finishLiveRecord(true,3);
 $('secondStatus').textContent='第三語言已中斷：'+error.message;
}
function handleSecondFailure(error){
 geminiSecond?.close();geminiSecond=null;finishLiveRecord(true,true);
 $('secondStatus').textContent='第二語言已中斷（第一語言繼續）：'+error.message;
}
function handleGeminiFailure(error) {
 const old=gemini;gemini=null;pcm=null;old?.close();finishLiveRecord(true);
 geminiSecond?.close();geminiSecond=null;finishLiveRecord(true,true);
 geminiThird?.close();geminiThird=null;finishLiveRecord(true,3);
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
  const selected=selectSummaryRecords(records,summarySessionId);
  if (!selected.length) {
    status('當前場次沒有已完成的主語言字幕可摘要');
    return;
  }
  const dialog = $('summaryDialog');
  const content = $('summaryContent');
  if (!dialog || !content) return;

  dialog.showModal();
  for(const id of ['copySummary','downloadSummary'])if($(id))$(id).disabled=true;
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
        records: selected.map(({audio,...r})=>r), sessionId: summarySessionId,
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
    const parser=new SSEParser((event,data)=>{
      if(event==='error')throw Error(data.error||'摘要生成失敗');
      if(event==='delta')return;
      if(event==='done' && data.summary?.trim()){complete=true;summaryText=data.summary;}
      content.textContent=summaryText;content.scrollTop=content.scrollHeight;
    });
    while(true){const {done,value}=await reader.read();if(done)break;parser.push(decoder.decode(value,{stream:true}));}
    if(!complete)throw Error('摘要串流提早中斷');
    for(const id of ['copySummary','downloadSummary'])if($(id))$(id).disabled=false;
  } catch (e) {
    content.textContent = '[摘要生成中斷：' + e.message + ']';
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
  if (langCode === 'tvl') { convStatus('吐瓦魯語朗讀尚不支援。'); return; }
  if (!('speechSynthesis' in window) || !text) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = langCode || 'en-US';
    u.rate = 1.0;
    u.onstart = () => updateAudioReactiveGlow(0.045, 0.12);
    u.onboundary = () => updateAudioReactiveGlow(0.048, 0.14);
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
          ${r.translation && r.ttsLangCode !== 'tvl' ? `<button class="conv-tts-btn" data-record="${r.id}" title="朗讀譯文">🔊 朗讀</button>` : ''}
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

async function translateConvRecord(record, text, targetLangStr, ttsLangCode, sourceLangCode) {
  record.text = text;
  record.ttsLangCode = ttsLangCode;
  record.translation = '';
  record.state = 'streaming';
  const epoch=convEpoch;
  drawConvFeed();

  const isFree = $('convEngine')?.value === 'free';
  if (isFree) {
    try {
      const translation = await translateFree(text, sourceLangCode || 'auto', targetLangStr);
      if (epoch !== convEpoch) return;
      record.translation = translation;
      record.state = 'done';
      drawConvFeed();

      // Auto TTS
      if (epoch === convEpoch && !convActiveSpeaker && $('convAutoTTS')?.checked && record.translation) {
        speakTTS(record.translation, ttsLangCode);
      }
    } catch (err) {
      if (epoch !== convEpoch) return;
      record.state = 'error';
      record.translation = `[免費翻譯異常: ${err.message}]`;
      drawConvFeed();
    }
    return;
  }

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
  const isFree = $('convEngine')?.value === 'free';
  if (isFree && [$('convLangA').value, $('convLangB').value].includes('tvl')) {
    convStatus('吐瓦魯語請選 AI 大模型，使用手動文字翻譯；結果尚需人工確認。');return;
  }
  if (!isFree && !configured) {
    $('dialog').showModal();
    convStatus('請先設定自己的 API 金鑰，或切換為「免金鑰即時翻譯」');
    return;
  }
  input.value = '';

  const isA = speaker === 'A';
  const targetOpt = isA ? $('convLangB').selectedOptions[0] : $('convLangA').selectedOptions[0];
  const sourceOpt = isA ? $('convLangA').selectedOptions[0] : $('convLangB').selectedOptions[0];
  const targetStr = targetOpt.dataset.target || targetOpt.text;
  const ttsCode = targetOpt.value;
  const sourceCode = sourceOpt.value;

  const rec = {
    id: crypto.randomUUID(),
    speaker,
    time: formatTime(),
    text,
    translation: '',
    state: 'pending'
  };
  convRecords.push(rec);
  translateConvRecord(rec, text, targetStr, ttsCode, sourceCode);
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
  const isFree = $('convEngine')?.value === 'free';
  if ([$('convLangA').value, $('convLangB').value].includes('tvl')) {
    convStatus('吐瓦魯語目前僅支援 AI 手動文字翻譯，請輸入文字並選擇 AI 大模型。');return;
  }
  if (!isFree && !configured) {
    $('dialog').showModal();
    convStatus('請先設定自己的 API 金鑰，或切換為「免金鑰即時翻譯」');
    return;
  }
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
  convStatus(`● 正在聆聽${isA ? '我方' : '對方'}說話${isFree ? '（免金鑰模式）' : ''}…`);

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
        updateAudioReactiveGlow(0.045, 0.12);
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
        updateAudioReactiveGlow(0.04, 0.11);
        currentRec.interim = interim;
      }
      drawConvFeed();

      if (final.trim()) {
        currentRec.text = final.trim();
        currentRec.interim = '';
        const toTranslate = currentRec;
        currentRec = null;
        stopConvSpeech();
        translateConvRecord(toTranslate, toTranslate.text, targetStr, ttsCode, langCode);
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

// Firefighting, Rescue & EMS Glossary Management
const DEFAULT_FIRE_EMS_GLOSSARY = `【消防·救護·急診醫療中英日專業術語庫】
[初階評估 ABCDE & 生命徵象]
- 意識狀態: Level of consciousness (LOC) / Mental status | 意識レベル
- 呼吸道(Airway): Airway / Patent airway | 気道・気道確保
- 呼吸(Breathing): Breathing / Respiration | 呼吸・呼吸状態
- 循環(Circulation): Circulation / Pulse | 循環・脈拍
- 失能評估(Disability): Disability / Neurological status | 神経学的異常・意識障害
- 暴露與體溫(Exposure): Exposure & environmental control | 全身観察・体温管理
- 生命徵象: Vital signs | バイタルサイン
- 昏迷指數: GCS (Glasgow Coma Scale) | グラスゴー・コーマ・スケール
- 意識評估: AVPU (Alert, Verbal, Pain, Unresponsive) | AVPU評価
- 血氧飽和度: SpO2 (Oxygen saturation) | 経皮的動脈血酸素飽和度

[外傷搶救與出血控制 Trauma & Hemorrhage]
- 止血: Bleeding control / Hemostasis | 止血・止血処置
- 直接加壓止血: Direct pressure / Pressure dressing | 直接圧迫止血・圧迫包帯
- 填塞止血: Wound packing / Hemostatic packing | パッキング止血・創傷パッキング
- 止血帶: CAT Tourniquet | 止血帶・ターニケット
- 骨折/開放性骨折: Bone fracture / Open fracture | 骨折・開放骨折
- 頸圈/長背板: Cervical collar (C-collar) / Long spine board | 頸椎カラー・バックボード
- 骨盆固定帶: Pelvic binder | 骨盤バインダー

[救護現場問診 EMS Dialogue]
- 你哪裡不舒服？/哪裡痛？: Where does it hurt? / Where are you feeling discomfort? | どこが痛いですか？ / どこか苦しいですか？
- 請深呼吸: Take a deep breath with me | 深呼吸してください
- 有藥物過敏嗎？: Any drug allergies? | お薬のアレルギーはありますか？
- 有何病史？: What medical history do you have? | 既往歴はありますか？

[心肺急症與復甦 Resuscitation]
- OHCA (到院前心肺停止): Out-of-Hospital Cardiac Arrest | 心肺停止 (CPA/OHCA)
- ROSC (自主循環恢復): Return of Spontaneous Circulation | 自己心拍再開
- CPR/壓胸: CPR / Chest compressions | 心肺蘇生法・胸骨圧迫
- AED (去顫電擊器): Automated External Defibrillator | 自動体外式除細動器 (AED)
- 甦醒球(BVM): Bag-Valve-Mask | バッグバルブマスク
- 聲門上呼吸道: SGA / LMA (Laryngeal mask) | 声門上エアウェイ
- 氣管插管: Endotracheal intubation (ETT) | 気管挿管・気管チューブ
- 骨針(IO)/腎上腺素: IO (Intraosseous) / Epinephrine | 骨髄針・アドレナリン
- 心肌梗塞/過敏性休克: AMI (Myocardial infarction) / Anaphylactic shock | 心筋梗塞・アナフィラキシー

[消防滅火與搶救 Fire & Rescue]
- 消防衣/防護裝備: Turnout gear / Bunker gear | 防火衣
- 空氣呼吸器(SCBA): SCBA (Breathing apparatus) | 空気呼吸器
- 瞄子/水帶: Fire nozzle / Fire hose | 筒先・消防ホース
- 分歧管/泵浦車: Wye / Pumper (fire engine) | 分岐管・消防ポンプ車
- 雲梯車/破壞器材: Aerial ladder truck / Forcible entry tools (Halligan) | はしご車・破壊器具
- 熱顯像儀(TIC): Thermal Imaging Camera (TIC) | 熱画像直視装置
- 火場/入室搜索: Fire scene / Interior search | 火災現場・屋内進入検索
- 閃燃/爆燃: Flashover / Backdraft | フラッシュオーバー・バックドラフト
- 局限空間/繩索救援: Confined space / Technical rope rescue | 閉鎖空間救助・ロープ救助

[人員體系與大量傷患 EMS & Triage]
- 救護技術員(EMT): Emergency Medical Technician | 救急隊員
- 高級救護技術員(專救): Paramedic (EMT-P) | 救急救命士
- 救護車/派遣中心: Ambulance / 911 dispatch | 救急車・指令センター
- 大量傷病患(MCI): Mass Casualty Incident | 多数傷病者事故
- 檢傷分類: Triage (START triage) | トリアージ (赤・黄・緑・黑)
- 後送醫院/創傷中心: Receiving hospital / Trauma center | 搬送先病院・トラウマセンター`;

if ($('btnResetGlossary')) {
  $('btnResetGlossary').onclick = () => {
    if ($('context')) $('context').value = DEFAULT_FIRE_EMS_GLOSSARY;
  };
}
if ($('btnClearGlossary')) {
  $('btnClearGlossary').onclick = () => {
    if ($('context')) $('context').value = '';
  };
}
if ($('context') && !$('context').value.trim()) {
  $('context').value = DEFAULT_FIRE_EMS_GLOSSARY;
}
