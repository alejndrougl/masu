@echo off
title Masu
cd /d "%~dp0"

if not exist node_modules (
  echo Instalando Masu, solo pasa la primera vez...
  call npm install || goto :fallo
)
if not exist public\wasm (
  call node scripts\setup.mjs || goto :fallo
)
if not exist public\models\partes-cara.onnx (
  call node scripts\setup.mjs || goto :fallo
)
if not exist dist\index.html (
  echo Preparando la aplicacion...
  call npm run build || goto :fallo
)

node serve.mjs %*
goto :eof

:fallo
echo.
echo No se pudo preparar Masu. Revisa tu conexion a internet la primera vez.
pause
