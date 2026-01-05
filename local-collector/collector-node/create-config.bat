@echo off
chcp 65001 >nul
echo ========================================
echo   Smartfox Collector - Config Generator
echo ========================================
echo.

set /p SMARTFOX_IP="Smartfox IP-Adresse eingeben (z.B. 192.168.1.100): "
set /p FRONIUS_IP="Fronius IP-Adresse eingeben (z.B. 192.168.1.101): "

echo.
echo Erstelle config.json...

(
echo {
echo   "smartfox": {
echo     "ip": "%SMARTFOX_IP%",
echo     "enabled": true
echo   },
echo   "fronius": {
echo     "ip": "%FRONIUS_IP%",
echo     "enabled": true
echo   },
echo   "polling_interval_seconds": 30,
echo   "supabase": {
echo     "url": "https://tvqmhdpcixkfsudxughs.supabase.co",
echo     "anon_key": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2cW1oZHBjaXhrZnN1ZHh1Z2hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3NjAxODQsImV4cCI6MjA4MTMzNjE4NH0.3WDZXuxGECexP_wjvmK5QTFvJakMW2-SLs7FRzxoFKI"
echo   }
echo }
) > config.json

echo.
echo ✓ config.json wurde erfolgreich erstellt!
echo.
echo Konfiguration:
echo   Smartfox IP: %SMARTFOX_IP%
echo   Fronius IP:  %FRONIUS_IP%
echo.
echo Starte den Collector jetzt mit: npm start
echo.
pause
