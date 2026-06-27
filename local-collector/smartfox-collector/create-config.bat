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
echo     "url": "https://pflnniklvqbwjwrjswaz.supabase.co",
echo     "anon_key": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmbG5uaWtsdnFid2p3cmpzd2F6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNDA3MjcsImV4cCI6MjA5NzkxNjcyN30.RADpIsCnV8ZgwozN6EfewE_ARWyKW7s9pmEWJe07uYA"
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
