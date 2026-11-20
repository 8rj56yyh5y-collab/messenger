#!/bin/bash
# Gobsek Chat — запуск на MacBook. Двойной клик по файлу (или в Терминале: bash start-mac.command).
# Остановить — закрыть окно Терминала.

cd "$(dirname "$0")" || exit 1
echo ""
echo "=== Gobsek Chat ==="

if ! command -v node >/dev/null 2>&1; then
  echo "Не найден Node.js. Сейчас откроется сайт nodejs.org — скачайте версию LTS, установите и запустите этот файл снова."
  open "https://nodejs.org" 2>/dev/null
  read -r -p "Нажмите Enter, чтобы закрыть…"
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
NODE_MINOR=$(node -p "process.versions.node.split('.')[1]")
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 13 ]; }; then
  echo "Нужен Node.js 22.13 или новее (сейчас $(node -v)). Установите LTS с nodejs.org и запустите снова."
  open "https://nodejs.org" 2>/dev/null
  read -r -p "Нажмите Enter, чтобы закрыть…"
  exit 1
fi

if [ -f .env.local ]; then set -a; . ./.env.local; set +a; fi
[ -d node_modules ] || npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1

PORT="${PORT:-3000}"
IP=$(ipconfig getifaddr en0 2>/dev/null)
echo ""
echo "Мессенджер:          http://localhost:$PORT"
[ -n "$IP" ] && echo "Для коллег в сети:   http://$IP:$PORT   (звонки по сети работают только через HTTPS)"
echo ""
(sleep 1.5; open "http://localhost:$PORT") &
PORT="$PORT" npm start
