@echo off
REM ============================================================
REM  install-dienst.bat  -  Dienste-Waechter als NSSM-Dienst einrichten
REM  (Doku: doc\SYSTEMSTATUS-2026-11-05.md)
REM
REM  Vorher: config.json in DIESEM Ordner anlegen (Vorlage config.oesterreich.example.json
REM          bzw. config.muenchen.example.json) und token eintragen.
REM  ALS ADMINISTRATOR AUSFUEHREN (Rechtsklick > Als Administrator ausfuehren)
REM ============================================================
setlocal
set "DIR=%~dp0"
if "%DIR:~-1%"=="\" set "DIR=%DIR:~0,-1%"
set "SERVICE=DiensteWaechter"

net session >nul 2>&1
if %errorLevel% neq 0 (
  echo [FEHLER] Bitte als Administrator ausfuehren.
  pause
  exit /b 1
)
if not exist "%DIR%\config.json" (
  echo [FEHLER] config.json fehlt in %DIR%
  echo          Vorlage kopieren und token eintragen.
  pause
  exit /b 1
)
for /f "delims=" %%N in ('where node') do if not defined NODE_EXE set "NODE_EXE=%%N"
if not defined NODE_EXE (
  echo [FEHLER] node.exe nicht gefunden.
  pause
  exit /b 1
)
echo Node: %NODE_EXE%

echo.
echo === Test: Dienste finden und Cloud erreichen ===
"%NODE_EXE%" "%DIR%\index.js" --test
if %errorLevel% neq 0 (
  echo [FEHLER] Test fehlgeschlagen - config.json pruefen.
  pause
  exit /b 1
)

echo.
echo === Dienst einrichten ===
nssm stop "%SERVICE%" >nul 2>&1
nssm remove "%SERVICE%" confirm >nul 2>&1
if not exist "%DIR%\logs" mkdir "%DIR%\logs"
nssm install "%SERVICE%" "%NODE_EXE%" "%DIR%\index.js"
nssm set "%SERVICE%" AppDirectory "%DIR%"
nssm set "%SERVICE%" DisplayName "Dienste-Waechter (Systemstatus Heizung)"
nssm set "%SERVICE%" Start SERVICE_AUTO_START
nssm set "%SERVICE%" AppStdout "%DIR%\logs\waechter.log"
nssm set "%SERVICE%" AppStderr "%DIR%\logs\waechter.log"
nssm set "%SERVICE%" AppRotateFiles 1
nssm set "%SERVICE%" AppRotateOnline 1
nssm set "%SERVICE%" AppRotateBytes 1000000
nssm set "%SERVICE%" AppExit Default Restart
nssm set "%SERVICE%" AppRestartDelay 10000
nssm start "%SERVICE%"

echo.
nssm status "%SERVICE%"
echo Fertig. In der App erscheint der PC nach ca. 30 Sekunden (Symbol oben rechts).
echo Log: %DIR%\logs\waechter.log
pause
endlocal
