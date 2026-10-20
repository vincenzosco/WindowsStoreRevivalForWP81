@echo off
rem Restart the lab in one command: this wrapper raises the UAC prompt, the script does the
rem rest. See tools\restart-lab.ps1 for why the lab has to be stopped by port and why a
rem code change never reaches a running lab through POST /__lab/reload.
rem
rem Two things this wrapper learned the hard way (2026-10-20 17:0x):
rem   - a declined UAC prompt is an ERROR, not a silent no-op: Start-Process -Verb RunAs
rem     throws "Operazione annullata dall'utente" and the window closes before anyone can
rem     read it, which looks exactly like a restart that did nothing. It is now caught and
rem     printed, with a non-zero exit.
rem   - the exit code says which of the three things happened: 0 = the elevated script ran
rem     (read logs\lab-restart.txt for its result), 3 = the prompt was declined or could not
rem     be shown, anything else = the wrapper itself failed.
setlocal
set "PS1=%~dp0restart-lab.ps1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ps1='%PS1%'; $admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); if ($admin) { & $ps1; exit $LASTEXITCODE }; Write-Host 'UAC: accept the prompt to restart the lab.'; try { Start-Process powershell -Verb RunAs -ErrorAction Stop -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File',$ps1); Write-Host 'elevated restart launched - the report is logs\lab-restart.txt'; exit 0 } catch { Write-Host ('UAC not granted: ' + $_.Exception.Message); Write-Host 'Nothing was restarted. Double-click this file in Explorer to try again.'; exit 3 }"

set "CODE=%ERRORLEVEL%"
if "%CODE%"=="3" (
  echo.
  echo   The restart did NOT happen: the elevation prompt was declined.
  pause
  exit /b 3
)
if not "%CODE%"=="0" (
  echo.
  echo   The wrapper failed with exit %CODE%.
  pause
  exit /b %CODE%
)
exit /b 0
