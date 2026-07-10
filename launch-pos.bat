@echo off
cd /d "%~dp0"
start "POS Los Pachecos" powershell -NoProfile -ExecutionPolicy Bypass -File ".\start.ps1"
