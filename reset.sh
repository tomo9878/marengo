#!/bin/bash
# reset.sh - セーブデータ全削除 & サーバー再起動

cd "$(dirname "$0")"

echo "サーバー停止中..."
/usr/sbin/lsof -ti:3000 | xargs /bin/kill -9 2>/dev/null
/bin/sleep 1

if [ -d "server/saves" ]; then
  echo "セーブデータ削除中: server/saves/"
  /bin/rm -f server/saves/*.json
  echo "削除完了"
else
  echo "server/saves/ なし（スキップ）"
fi

echo "サーバー起動中..."
/opt/homebrew/bin/node server/index.js &
/bin/sleep 1
echo "完了 → http://localhost:3000"
