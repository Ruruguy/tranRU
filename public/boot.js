// A failed module import must not leave a silently inert Start button.
const start=document.getElementById('start');
start.disabled=true;
try {
 await import('./app.js');
 start.disabled=false;
} catch {
 document.getElementById('status').textContent='頁面程式載入失敗，請重新整理。若持續發生，請確認網址與網站版本；已有字幕仍保存在此瀏覽器。';
 start.textContent='重新載入頁面';start.disabled=false;
 start.onclick=()=>location.reload();
}
