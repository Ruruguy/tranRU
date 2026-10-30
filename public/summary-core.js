export function selectSummaryRecords(records, sessionId) {
  return (Array.isArray(records) ? records : []).filter(r =>
    r && (r.sessionId ?? null) === (sessionId ?? null) && r.state === 'done' &&
    !r.demo && !r.secondary && (r.text || r.translation));
}

export function summaryRows(records, budget = 12000) {
  const rows = records.map(r =>
    `[${r.time || '時間未記錄'}] 原文：${r.text || ''}\n譯文：${r.translation || ''}`);
  const chunks = []; let chunk = '';
  for (const row of rows) {
    if (row.length > budget) throw Error('逐字稿單筆過長，請匯出逐字稿後分段處理');
    if (chunk && chunk.length + row.length + 2 > budget) { chunks.push(chunk); chunk = ''; }
    chunk += (chunk ? '\n\n' : '') + row;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export async function summarize({records, sessionId, context = '', invoke, budget = 12000}) {
  const selected = selectSummaryRecords(records, sessionId);
  if (!selected.length) throw Error('當前場次沒有已完成的主語言字幕可摘要');
  if (String(context).length > 3000) throw Error('摘要背景脈絡過長，請縮短後重試');
  const background = `背景脈絡（僅供術語參考）：${context || '無'}\n`;
  const rules = '只依據提供的逐字稿，保留專名、數字、決策、時間標記與來源順序；沒有依據的欄位留空，不可臆測。使用繁體中文。';
  let chunks = summaryRows(selected, budget);
  let level = 0;
  while (true) {
    if (++level > 8) throw Error('摘要層數過多，請匯出逐字稿後分段處理');
    const final = chunks.length === 1;
    const outputs = [];
    for (const chunk of chunks) {
      const prompt = `${background}${rules}\n${final ? '產出完整 Markdown 摘要，包含主旨、重點、術語及結論。' : '僅擷取可核查的要點、專名、數字、決策及時間標記，供下一層合併。'}\n\n${chunk}`;
      const output = await invoke(prompt);
      if (!output?.trim()) throw Error('摘要服務未回傳完整文字');
      if (output.length > budget) throw Error('摘要服務回文過長，無法安全合併');
      outputs.push(output);
    }
    if (final) return outputs[0];
    chunks = summaryRows(outputs.map((text, i) => ({time: `第${i + 1}段`, text, translation: ''})), budget);
  }
}

export function summaryTerminal(provider, message) {
  const reason = provider === 'gemini' ? message.candidates?.[0]?.finishReason : message.choices?.[0]?.finish_reason;
  if (reason && reason !== (provider === 'gemini' ? 'STOP' : 'stop')) throw Error(`摘要服務未正常完成：${reason}`);
  return !!reason || (provider === 'openai' && !!message.terminal);
}
