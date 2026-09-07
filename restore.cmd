@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\cider-wnp.ps1" -Action Restore %*
exit /b %ERRORLEVEL%

