@echo off
chcp 65001 >nul
rem BluePink han-geul - stop website and tunnel
echo 正在停止网站和公网隧道...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>nul
taskkill /IM SakuraFrpService.exe /F >nul 2>nul
taskkill /IM SakuraLauncher.exe /F >nul 2>nul
taskkill /IM cpolar.exe /F >nul 2>nul
echo 已停止
pause
