#!/bin/zsh
# Run the original edition independently of this Terminal window.
cd "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if curl -fsS --max-time 2 http://127.0.0.1:8787/health >/dev/null 2>&1; then
  open http://127.0.0.1:8787/
  print '原版已在執行：http://127.0.0.1:8787/'
  exit 0
fi
if ! command -v node >/dev/null 2>&1; then
  print '找不到 Node.js，請安裝 Node.js 22 以上後再啟動。'
  read '?按 Enter 關閉…'
  exit 1
fi
mkdir -p artifacts
PORT=8787 node --input-type=module -e '
import {spawn} from "node:child_process";
import {openSync} from "node:fs";
const log=openSync("artifacts/local-server.log","a",0o600);
const child=spawn(process.execPath,["server.mjs"],{cwd:process.cwd(),env:process.env,detached:true,stdio:["ignore",log,log]});
child.on("error",()=>process.exit(1));
child.unref();
'
for attempt in {1..30}; do
  if curl -fsS --max-time 1 http://127.0.0.1:8787/health >/dev/null 2>&1; then
    open http://127.0.0.1:8787/
    print '原版已在背景啟動，關閉此視窗不會停止服務。'
    print '網址：http://127.0.0.1:8787/'
    exit 0
  fi
  sleep 0.2
done
print '啟動未成功，請查看 artifacts/local-server.log（請勿公開貼上含金鑰的內容）。'
read '?按 Enter 關閉…'
exit 1
