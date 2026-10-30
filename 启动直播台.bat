@echo off
rem Jinyu Live Studio - clean 9:16 portrait window (app mode, no tabs/address bar)
rem Server: http://192.168.31.211:9000/live   (change URL below if the IP changes)
rem After the window opens, tools\fit-window.ps1 snaps the client area to exact 9:16,
rem so you never have to drag it by hand.
setlocal enabledelayedexpansion
set "URL=http://192.168.31.211:9000/live"
set "PF=%ProgramFiles%"
set "PF86=%ProgramFiles(x86)%"
set "LF=%LOCALAPPDATA%"
set "BROWSER="

if exist "%PF86%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%PF86%\Microsoft\Edge\Application\msedge.exe"
if exist "%PF%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%PF%\Microsoft\Edge\Application\msedge.exe"
if exist "%PF%\Google\Chrome\Application\chrome.exe" set "BROWSER=%PF%\Google\Chrome\Application\chrome.exe"
if exist "%PF86%\Google\Chrome\Application\chrome.exe" set "BROWSER=%PF86%\Google\Chrome\Application\chrome.exe"
if exist "%LF%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LF%\Google\Chrome\Application\chrome.exe"

if "%BROWSER%"=="" (
  echo Browser not found.
  echo Edit this file and set BROWSER to your browser path, e.g.
  echo set "BROWSER=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
  pause
  exit /b 1
)

echo Using: %BROWSER%
start "" "%BROWSER%" --app="%URL%" --window-size=600,1100 --window-position=0,0 --hide-scrollbars

rem Snap the client area to exact 9:16 after the window appears
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\fit-window.ps1"
endlocal
