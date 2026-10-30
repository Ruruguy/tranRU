# tranRU · 演講即時翻譯

**直接使用：[開啟 tranRU](https://ruruguy.github.io/tranRU/)**。GitHub 儲存庫頁面顯示的是程式碼；網站使用者可自行輸入 Gemini API 金鑰。

支援本機或 HTTPS 部署的雙欄字幕工具，支援 Gemini 即時翻譯與 OpenAI 備用。需要 Node.js 22 以上，無須安裝外部套件。

## 啟動與設定

```sh
npm start
```

以 Chrome 開啟 http://127.0.0.1:8787 ，也可雙擊 `啟動翻譯.command`。

1. 打開「服務設定」，填入 Gemini API 金鑰：https://aistudio.google.com/api-keys 。Google AI Pro 訂閱登入並不取代 API 金鑰。
2. 若要自動備用，再填入 OpenAI API 金鑰，保留「Gemini 中斷時，自動改用 OpenAI」勾選。兩個服務可分別使用，OpenAI 不是使用 Gemini 的必要條件。
3. 每個訪客的金鑰只存於伺服器個人工作階段記憶體；閒置約 30 分鐘或重啟後需重新填入，不會回傳給其他訪客或存入 localStorage。本機模式可選用環境變數 `GEMINI_API_KEY` 與 `OPENAI_API_KEY`；HTTPS 線上模式不使用這些預設金鑰，所有訪客都需自備。
4. 選擇「Gemini 即時翻譯」、目標語言與音訊來源，再點開始。Gemini 自動偵測演講語言；語言下拉選單只控制 OpenAI 的辨識提示。
5. 線上演講選「分頁／電腦音訊」，並勾選 Chrome「分享分頁音訊」；現場選麥克風。
6. 可點擊「🪟 懸浮字幕」開啟置頂畫中畫視窗，覆蓋在 Zoom、Keynote 或 YouTube 全螢幕上方即時觀看。
7. 可調整字幕大小、演講模式（Escape 離開），結束後可點擊「✨ AI 演講摘要」自動提煉重點，或匯出完整 Markdown 雙語逐字稿。

## Gemini 與備用行為

- Gemini 使用 `gemini-3.5-live-translate-preview`，透過本機伺服器 WebSocket 連到 Google。瀏覽器以 100ms 的 16kHz 單聲道 PCM16 封包傳送音訊，再以 SSE 接收原文與譯文。
- 模型要求 AUDIO 回應，本工具僅顯示雙語字幕，丟棄產生的譯音，不播放；不播放仍可能產生音訊輸出費用。
- Gemini 為預覽模型，帳戶、地區、額度與模型權限可能限制使用。API 需要自己的額度；訂閱福利是否可抵用以 Google 帳戶為準。
- 詞彙／背景提示只用於 OpenAI；Gemini Live Translate 不支援自訂系統提示。
- Gemini 啟動失敗或串流中斷，在有 OpenAI 金鑰且啟用自動備用時，切換成 OpenAI 停頓切段模式。介面顯示切換原因。沒有備用時停止收音並提示。
- 備用處理後續音訊，**不回補 Gemini 中斷期間的音訊**。未完成字幕會標示；可能有缺字，原文與譯文不保證逐句對齊。
- 收到 Gemini 工作階段到期通知會切換備用或停止；目前不支援 Gemini 工作階段續接。長演講可使用 OpenAI 備用，或停止後重新開始 Gemini。
- 點停止會送出剩餘音訊與結束訊號，短暫等候最後字幕後關閉連線。關閉分頁會清理上游連線。

## OpenAI 模式

保留智慧停頓切段、瀏覽器原生語音辨識與手動文字翻譯。手動文字翻譯需要 OpenAI 金鑰，Gemini Live Translate 僅接受音訊。

OpenAI 預設 `gpt-4o-mini-transcribe` 與 `gpt-4o-mini`，可在設定修改。辨識失敗時既有程式會嘗試 `whisper-1`。字幕延遲依收音、停頓、網路與模型負載而異，不保證秒數。瀏覽器原生語音依瀏覽器提供的服務與支援程度運作。

## 資料與限制

音訊會傳送至所選服務；啟用自動備用代表中斷後同意改由 OpenAI 處理後續音訊。預設只綁定 127.0.0.1；設定 APP_ORIGIN 後才啟用 HTTPS 網站部署模式。字幕最近 100 段會存於本瀏覽器 localStorage；完整本次紀錄可匯出。失敗音訊僅留在記憶體，重載會失去。

## 驗證

```sh
npm test
```

測試使用假 WebSocket／串流與獨立本機測試伺服器，不呼叫付費 API。包含 Gemini 設定、PCM 格式、雙語事件、SSE 跨封包解析、異常切換通知、正常停止清理、金鑰遮蔽及端點保護。瀏覽器檢查包含引擎選單與缺少金鑰時開啟設定。實際語音辨識、模型權限、長時間穩定性及翻譯品質需填入有效金鑰並授權收音後驗收。

依據：
- https://ai.google.dev/gemini-api/docs/live-api/live-translate
- https://ai.google.dev/api/live
- 原站 REA 觀察與重建範圍見 `docs/reverse-engineering.md`。


## 連線排錯（2026-10-18）

Gemini 的 `inputAudioTranscription` 與 `outputAudioTranscription` 位於 `setup` 直屬欄位；`translationConfig` 位於 `setup.generationConfig`。官方翻譯教學範例曾將字幕欄位放入 generationConfig，與 WebSocket API 參考及實際服務驗證不一致；此處依協定與服務錯誤修正。

設定視窗提供「測試 Gemini 連線（不收音）」，使用已儲存的金鑰連到 Google，等待 `setupComplete` 後立即關閉。成功僅證明金鑰、模型與設定被接受，不等於已驗證語音翻譯品質。開始聆聽也會先完成此握手，再要求麥克風／分頁授權。OpenAI 自動備用預設關閉，需主動開啟。


## 可選雙語譯文

「同時翻譯成兩種語言」預設關閉。開始聆聽前開啟，選擇與第一語言不同的第二目標語言。原字幕區維持不變，下方新增第二語言的原文／譯文區。兩個區域可能分句不同，不保證一一對齊。停止後才能變更開關與語言。

- Gemini：同一份麥克風／分頁 PCM 音訊送到兩個獨立 Live 翻譯連線，會增加音訊輸入及輸出用量。第二連線失敗不停止第一連線；主連線失敗會關閉兩個 Gemini 連線，再依原有備用設定處理後續音訊。
- OpenAI／原生辨識：只辨識一次，主要譯文完成後將原文額外送至文字翻譯端點產生第二語言，會增加文字翻譯用量與延遲。第二譯文失敗不停止主翻譯。
- 逐字稿儲存、Markdown 匯出與懸浮字幕均保留語言標籤。關閉開關會隱藏第二語言區但不刪除紀錄，重新開啟可查看；新翻譯只產生主要語言。
- 字幕示範可在沒有 API 金鑰時檢查兩種語言的顯示。真實雙語音訊翻譯需有效模型權限與 API 額度。


## 部署到網路

本機／Node 版本有 HTTP／SSE 與對 Google 的 WebSocket 後端，不能直接把該版本部署到 GitHub Pages。另提供以下瀏覽器直連建置，可部署至靜態主機。GitHub 儲存庫只保存程式碼；可部署到支援常駐 Node.js 或 Docker、HTTPS 的主機。

### Node.js 主機

1. 連結私人 GitHub 儲存庫 `Ruruguy/tranRU`，選擇 Node.js 24。
2. 無外部依賴，安裝／建置步驟可省略；啟動指令為 `npm start`。
3. 將 `APP_ORIGIN` 設為實際網站的 HTTPS 網域，例如 `https://tranru.example.com`，不要加子路徑。`PORT` 使用平台提供的值。
4. 主機需要允許連線到 Google/OpenAI，反向代理需停用 SSE 緩衝並允許長時間 HTTP 回應；健康檢查網址為 `/health`。
5. 不要替訪客設定共用 API 金鑰。訪客打開網站後，點「服務設定」，輸入自己的 Gemini API 金鑰並測試連線。OpenAI 備用完全可選。

### Docker

```sh
docker build -t tranru .
docker run --rm -p 8787:8787 -e APP_ORIGIN=https://your-app.example.com tranru
```

需在容器前配置 HTTPS 反向代理，公開網域須與 APP_ORIGIN 相符。Docker 設定只開放後端 HTTP 給反向代理，不會自行簽發憑證。

### 金鑰與工作階段

- 每個瀏覽器的個人金鑰由獨立伺服器記憶體處理，使用 HttpOnly、SameSite=Strict Cookie；HTTPS 部署另外啟用 Secure。
- API 變更使用每個工作階段獨立的 CSRF token，並檢查 Origin。多位訪客不會共用金鑰、模型設定或 Gemini 工作階段。
- 金鑰會傳至本站伺服器，再用於呼叫指定 AI 供應商。請只在你信任的部署上輸入金鑰；這不是完全瀏覽器端的處理方式。
- 閒置約 30 分鐘且沒有活動 Gemini 串流時刪除伺服器工作階段；瀏覽器 Cookie 也會隨使用延長有效期。程式重啟會清空所有金鑰。
- 目前工作階段存在單一程序記憶體。部署使用單一實例／單一 Node 程序；水平擴充前需另設具適當加密與存取控制的共用工作階段儲存，或採固定路由。
- `.env`、金鑰檔案、錄音與逐字稿輸出均由 `.gitignore` 排除；範例設定不包含金鑰。

## 專案驗證

GitHub Actions 會在 Node.js 22 與 24 執行測試。測試不呼叫付費 AI API；包含訪客金鑰隔離、跨工作階段 CSRF、跨網站請求拒絕，以及原有的串流／PCM／備用行為。實際 Gemini 模型可用性和翻譯品質仍取決於訪客帳戶與實際音訊。


## Sites 線上部署版本（瀏覽器直連）

`npm run build` 產生 `dist/`，可部署為純靜態網站。Sites 專案識別記錄在 `.openai/hosting.json`；GitHub 程式庫保持私人。

- 線上版的金鑰只保存在訪客自己的分頁記憶體中，重新整理後需重填。金鑰、音訊、譯文請求直接送到 Google／OpenAI，不經過本站 Node 伺服器，也不寫進 GitHub 或 localStorage。
- 本機 `npm start` 仍使用原有 Node 伺服器及個人 Cookie 工作階段；只有 build 產生的 HTML 才帶有瀏覽器模式標記。
- 保留演講、兩種目標語言、雙向對話、摘要、逐字稿匯出與懸浮字幕。雙向對話辨識使用瀏覽器 Web Speech API，依瀏覽器服務與支援程度而定；譯文再使用訪客自己的 AI API 金鑰。
- 開始收音前需設定有效金鑰，Gemini Live 會先驗證握手。API 權限、模型額度、區域與瀏覽器跨來源政策仍可能影響實際使用。
- 新建 Sites 預設僅擁有者可存取。擴大分享範圍需另行設定 Sites 存取權；私人 GitHub 儲存庫與網站存取權是分開的。

### 這次檢視修正

移除對話朗讀按鈕的內嵌 JavaScript，改用事件監聽；對話與摘要共用可跨網路封包解析的 SSE parser；模式切換會停止收音與朗讀，舊辨識工作階段不再影響新收音；行動版保留模式切換按鈕。

自動測試使用假 WebSocket／API 回應，不呼叫付費 API。介面已檢查模式切換與缺少金鑰時的提示；真實語音辨識、翻譯品質及長時間穩定性仍需使用者金鑰實測。
