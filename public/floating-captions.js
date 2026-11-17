export const CAPTION_PRESETS={dark:{color:'#ffffff',background:'#101216',outline:true},light:{color:'#172033',background:'#f5f7fb',outline:false},contrast:{color:'#ffe66d',background:'#07090e',outline:true}};
export const DEFAULT_CAPTION_STYLE={...CAPTION_PRESETS.dark,size:32,lines:3,showSource:false,language:'first',preset:'dark'};
const hex=(value,fallback)=>/^#[0-9a-f]{6}$/i.test(String(value))?value:fallback;
export function captionStyle(value={}){
 return {color:hex(value.color,DEFAULT_CAPTION_STYLE.color),background:hex(value.background,DEFAULT_CAPTION_STYLE.background),size:Math.max(18,Math.min(64,Number(value.size)||32)),lines:Math.max(1,Math.min(5,Math.round(Number(value.lines)||3))),showSource:value.showSource===true,outline:value.outline!==false,language:typeof value.language==='string'&&value.language.length<=100?value.language:'first',preset:Object.hasOwn(CAPTION_PRESETS,value.preset)?value.preset:'custom'};
}
export const escapeCaption=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function visibleCaptionLanes(lanes,settings){
 const s=captionStyle(settings),translations=lanes.filter(l=>!l.source);
 const selected=s.language==='all'?translations:s.language==='first'?translations.slice(0,1):translations.filter(l=>l.id===s.language);
 return [...(s.showSource?lanes.filter(l=>l.source):[]),...(selected.length?selected:translations.slice(0,1))];
}
export function floatingCaptionCSS(settings){
 const s=captionStyle(settings);
 return `:root{color-scheme:${s.preset==='light'?'light':'dark'};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC",sans-serif;background:${s.background};color:${s.color};--caption-size:${s.size}px;--caption-lines:${s.lines};--caption-shadow:${s.outline?'1px 1px 0 #000,-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,0 2px 7px #000':'none'};}
 *{box-sizing:border-box}body{margin:0;padding:14px 20px;height:100vh;overflow:hidden;background:${s.background};color:${s.color}}
 #pipRows{height:100%;display:flex;flex-direction:column;justify-content:flex-end;gap:12px} .pip-lane{min-height:0;display:flex;flex-direction:column;flex:0 1 auto} .pip-label{font-size:11px;opacity:.65;margin-bottom:3px;letter-spacing:.04em;flex:none}.pip-caption{font-size:var(--caption-size);font-weight:650;line-height:1.45;white-space:pre-wrap;overflow:auto;max-height:calc(var(--caption-lines)*1.45em);scrollbar-width:none;text-shadow:var(--caption-shadow);overflow-wrap:anywhere}.pip-caption::-webkit-scrollbar{display:none}.pip-source .pip-caption{font-size:calc(var(--caption-size)*.7);opacity:.8}.pip-empty{font-size:18px;opacity:.6;padding:8px}
 .pip-tools{position:fixed;right:8px;top:6px;z-index:2;display:flex;gap:6px;align-items:center;padding:5px 7px;border-radius:10px;background:rgba(20,23,32,.94);color:#fff;font-size:11px;opacity:0;transition:opacity .15s}.pip-tools:hover,.pip-tools:focus-within,body:hover .pip-tools{opacity:1}.pip-tools button{border:1px solid #5d6272;background:#242938;border-radius:6px;color:#fff;padding:3px 8px;cursor:pointer}
 .pip-settings{display:none;position:fixed;inset:40px 8px 8px;z-index:3;background:#141824;color:#fff;border:1px solid #555d73;border-radius:10px;padding:12px;overflow:auto;font-size:12px}.pip-settings.open{display:block}.caption-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.caption-controls label{display:flex;flex-direction:column;gap:6px;min-width:0}.caption-controls input,.caption-controls select{max-width:100%;width:100%;min-height:32px;background:#252b3a;color:#fff;border:1px solid #5d6272;border-radius:6px}.caption-controls .caption-check{flex-direction:row;align-items:center}.caption-check input{width:18px;min-height:18px}.pip-settings p{font-size:11px;opacity:.7;line-height:1.5}`;
}
export function renderFloatingCaptions(doc,lanes,settings){
 const container=doc.getElementById('pipRows');if(!container)return;
 const visible=visibleCaptionLanes(lanes,settings),signature=JSON.stringify(visible);
 if(container.dataset.captions!==signature){
  container.dataset.captions=signature;
  container.innerHTML=visible.map(l=>`<section class="pip-lane${l.source?' pip-source':''}"><div class="pip-label">${escapeCaption(l.label)}</div><div class="pip-caption">${escapeCaption(l.text||'等待即時字幕…')}</div></section>`).join('')||'<div class="pip-empty">等待即時字幕…</div>';
 }
 for(const el of container.querySelectorAll('.pip-caption'))el.scrollTop=el.scrollHeight;
}
export function captionControlsMarkup(){return `<div class="caption-controls">
 <label>預設風格<select data-caption-key="preset"><option value="dark">暗底白字</option><option value="light">亮底深字</option><option value="contrast">高對比黃字</option><option value="custom">自訂配色</option></select></label>
 <label>顯示語言<select data-caption-key="language"></select></label>
 <label>文字顏色<input data-caption-key="color" type="color" aria-label="懸浮字幕文字顏色"></label>
 <label>網頁視窗底色（Mac 工具保持透明）<input data-caption-key="background" type="color" aria-label="懸浮字幕視窗底色"></label>
 <label>字幕字級<input data-caption-key="size" type="range" min="18" max="64" step="2"><output data-caption-size></output></label>
 <label>每種語言最多顯示幾行<select data-caption-key="lines"><option value="1">1 行</option><option value="2">2 行</option><option value="3">3 行</option><option value="4">4 行</option><option value="5">5 行</option></select></label>
 <label class="caption-check"><input data-caption-key="outline" type="checkbox">文字黑色描邊</label>
 <label class="caption-check"><input data-caption-key="showSource" type="checkbox">另顯示講者原文（演講模式）</label>
 </div>`;}
export function syncCaptionControls(root,settings,lanes){
 const s=captionStyle(settings),languages=[{id:'first',label:'主要翻譯語言'},{id:'all',label:'所有翻譯語言'},...lanes.filter(l=>!l.source)];
 for(const field of root.querySelectorAll('[data-caption-key]')){
  const key=field.dataset.captionKey;
  if(key==='language')field.innerHTML=languages.map(l=>`<option value="${escapeCaption(l.id)}">${escapeCaption(l.label)}</option>`).join('');
  if(field.type==='checkbox')field.checked=s[key];else field.value=String(key==='language'&&!languages.some(l=>l.id===s.language)?'first':s[key]);
 }
 for(const el of root.querySelectorAll('[data-caption-size]'))el.textContent=s.size+' px';
}
export function bindCaptionControls(root,onChange){
 for(const field of root.querySelectorAll('[data-caption-key]'))field.oninput=()=>onChange(field.dataset.captionKey,field.type==='checkbox'?field.checked:field.value);
}
