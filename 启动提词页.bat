@echo off
rem Jinyu prompter - host-only script window, opens to the right of the live window.
rem The live-stream capture only grabs the live window, so viewers never see this one.
rem Server: http://192.168.31.211:9000/live/prompter   (change URL below if the IP changes)
rem On a phone or tablet, open the same URL in its browser instead.
setlocal enabledelayedexpansion
set "URL=http://192.168.31.211:9000/live/prompter"
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
rem The live window sits at x=0 and is about 600 px wide, so start this one at x=620.
start "" "%BROWSER%" --app="%URL%" --window-size=820,1000 --window-position=620,0
endlocal
