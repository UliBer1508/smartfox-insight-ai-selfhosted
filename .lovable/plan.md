
Befund nach Vergleich Published vs. Preview:

**Published (`smartfox-insight-ai.lovable.app`)**: Zeigt nur den Login-Screen "Fronius Smart AI" — kein Dashboard, keine Einstellungen sichtbar, weil ich nicht eingeloggt bin. Ohne Login kann ich von außen NICHT prüfen, ob Mikro-Budget in den Einstellungen erscheint.

**Preview (eingeloggt)**: Zeigt das volle Dashboard mit 6.4 kW PV, Heizung 2.3 kW, etc. Code enthält Mikro-Budget (HeatingSettingsForm Zeilen 272-324), DB liefert `micro_budget_enabled: true` (siehe Network-Logs).

**Diagnose**: Ich kann den eigentlichen Vergleich (Mikro-Budget sichtbar ja/nein in Published) nicht selbst durchführen, weil:
1. Login erfordert deine Credentials (darf ich nicht ohne Freigabe eingeben)
2. Published-Build-Stand kann ich nur nach Login prüfen

**Was du tun musst — 3 Schritte**

1. **Build-Stand vergleichen**
   - Öffne Preview, scrolle zum Footer → notiere `v… #buildhash`
   - Öffne `smartfox-insight-ai.lovable.app`, logge dich ein, scrolle zum Footer → vergleiche Build-Hash
   - **Gleich** → Published ist aktuell, dann ist Mikro-Budget dort sichtbar
   - **Unterschiedlich** → Published-Build ist alt → Schritt 2

2. **Falls Hashes unterschiedlich: Publish → Update**
   - Top-rechts „Publish" → „Update" klicken
   - Warten bis Status „Live" zeigt
   - Auf Published Hard-Reload (Strg+Shift+R) ODER PWA deinstallieren + neu installieren

3. **Falls Hashes gleich, aber Mikro-Budget fehlt trotzdem**
   - Screenshot vom Published-Settings-Tab schicken (Tab „Einstellungen" → Sektion „Anlagen-Konfiguration" aufklappen)
   - Dann prüfe ich gezielt, ob ein anderer Bug vorliegt (z.B. Conditional-Render-Fehler)

**Alternativ (empfohlen): Ich teste es selbst per Browser-Tool**
Wenn du mir erlaubst, mich mit deinen Credentials in der Browser-Automation einzuloggen, kann ich Published direkt prüfen und einen Side-by-Side-Screenshot mit Preview liefern. Das ist die schnellste Art, das Problem eindeutig zu klären.

Keine Code-Änderungen nötig in diesem Schritt — erst Diagnose, dann ggf. Fix.
