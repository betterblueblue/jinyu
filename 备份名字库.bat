@echo off
rem Jinyu name library backup.
rem Zips data\name-library\v2 (live library, review results, drafts, talk scripts)
rem into backups\name-library-<date>-<time>.zip. data\ is not in git, so after every
rem review batch run this once and copy the zip to a USB drive or a cloud drive.
rem To restore: unzip it and put the v2 folder back at data\name-library\v2.
setlocal
cd /d "%~dp0"
if not exist "data\name-library\v2\library.json" (
  echo Not found: data\name-library\v2\library.json
  pause
  exit /b 1
)
if not exist "backups" mkdir "backups"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference = 'SilentlyContinue'; try { $out = 'backups\name-library-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip'; Compress-Archive -Path 'data\name-library\v2' -DestinationPath $out -ErrorAction Stop; $kb = [math]::Ceiling((Get-Item $out).Length / 1KB); Write-Host ('Saved: ' + (Resolve-Path $out).Path + '  (' + $kb + ' KB)') } catch { Write-Host ('Backup failed: ' + $_.Exception.Message); exit 1 }"
if errorlevel 1 (
  pause
  exit /b 1
)
echo Now copy that zip to a USB drive or a cloud drive.
explorer "%~dp0backups"
pause
endlocal
