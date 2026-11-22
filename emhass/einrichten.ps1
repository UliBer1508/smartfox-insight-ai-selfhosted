# EMHASS-Vergleich einrichten (22.11.2026) – doc/EMHASS-VERGLEICH-2026-11-22.md
# Als Administrator in PowerShell ausführen:  powershell -ExecutionPolicy Bypass -File C:\EMHASS\einrichten.ps1
# Legt die Aufgabe „EMHASS Vergleich“ an: jeden Tag 03:45 rechnet EMHASS den Vortag, der Heizplaner bewertet ihn.
$ordner = "C:\EMHASS"
$python = Join-Path $ordner "venv\Scripts\python.exe"
$bruecke = Join-Path $ordner "emhass_bruecke.py"
if (-not (Test-Path $python)) { Write-Host "venv fehlt: zuerst EMHASS installieren (Schritt 1)" -ForegroundColor Red; exit 1 }

$aktion = New-ScheduledTaskAction -Execute $python -Argument "`"$bruecke`"" -WorkingDirectory $ordner
$zeit = New-ScheduledTaskTrigger -Daily -At 03:45
$einst = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)
# Als angemeldeter Benutzer, auch wenn niemand angemeldet ist – OHNE gespeichertes Kennwort (Anmeldeart S4U).
# Reicht für die Brücke: sie braucht nur C:\EMHASS und Internet (keine Netzlaufwerke). 22.11.2026: Kennwort nicht zur Hand.
$benutzer = "$env:USERDOMAIN\$env:USERNAME"
$wer = New-ScheduledTaskPrincipal -UserId $benutzer -LogonType S4U -RunLevel Highest
try {
  Register-ScheduledTask -TaskName "EMHASS Vergleich" -Action $aktion -Trigger $zeit -Settings $einst -Principal $wer -Force -ErrorAction Stop | Out-Null
} catch {
  Write-Host "Nicht eingerichtet: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "PowerShell als Administrator öffnen (Rechtsklick › Als Administrator ausführen) und erneut starten." -ForegroundColor Red
  exit 1
}
Write-Host "Aufgabe 'EMHASS Vergleich' eingerichtet: täglich 03:45" -ForegroundColor Green
Write-Host "Protokoll: $ordner\bruecke.log"
