@echo off
setlocal
cd /d "%~dp0"

rem If Typora is installed in a custom location, uncomment and edit this line:
rem set "TYPORA_EXE=C:\Program Files\Typora\Typora.exe"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$client = New-Object Net.Sockets.TcpClient; try { $client.Connect('127.0.0.1', 4173); $client.Close(); Start-Process 'http://127.0.0.1:4173/'; exit 0 } catch { exit 1 }"
if %errorlevel%==0 exit /b 0

python scripts\blog_admin.py
pause
