@echo off
cd /d "%~dp0"
if not exist dist\index.html (
  echo Pierwsze uruchomienie: buduje aplikacje...
  call npm install
  call npm run build
)
node tools\serve.mjs
