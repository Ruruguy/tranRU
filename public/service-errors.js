export function classifyServiceError(message) {
 const text=String(message||'');
 if(/no credits remaining|insufficient_quota|exceeded your current quota/i.test(text))return {fatal:true,code:'quota',message:'OpenAI API 額度已用完，已停止送出請求。請改用已設定的 Gemini，或至 OpenAI API 帳務頁儲值；ChatGPT 訂閱不包含此 API 額度。'};
 if(/API 429|rate.limit|too many requests/i.test(text))return {fatal:true,code:'rate_limit',message:'OpenAI 請求過於頻繁，已暫停收音。請稍後重新開始。'};
 if(/API 401|API 403|incorrect api key|invalid_api_key/i.test(text))return {fatal:true,code:'auth',message:'OpenAI API 金鑰無效或沒有權限，已停止送出請求。請檢查設定。'};
 return {fatal:false,code:'unknown',message:text};
}
