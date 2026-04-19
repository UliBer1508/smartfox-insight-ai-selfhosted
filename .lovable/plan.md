
Ziel: Footer zuverlässig sichtbar machen – nicht nur im Dashboard, sondern auch auf Seiten wie Login/Published, und ihn sauber am Seitenende platzieren.

Befund aus dem Code:
- `Footer` wird aktuell nur in `src/pages/Index.tsx` gerendert.
- Auf `Auth`, `Install` und `NotFound` gibt es keinen Footer.
- Das erklärt direkt, warum in der Published-Version beim Login kein Footer erscheint.
- Zusätzlich ist das Seitenlayout nicht als `flex-col` aufgebaut; dadurch ist der Footer nicht als echter Seitenabschluss verankert.
- `src/App.css` enthält noch das Vite-Default-`#root`-Layout (`max-width`, `padding`, `text-align`), das für ein Full-App-Layout störend ist und bereinigt werden sollte.

Geplanter Fix:
1. Gemeinsames App-Layout einführen
- Footer aus `Index.tsx` herauslösen.
- In `App.tsx` ein gemeinsames Seitenlayout verwenden, damit der Footer global verfügbar ist.
- Auth-abhängige Seiten können den Footer ebenfalls anzeigen, ohne ihn mehrfach pro Seite einzubauen.

2. Seitenlayout auf echten Footer-Flow umstellen
- Haupt-Wrapper als `min-h-screen flex flex-col`.
- Inhaltsbereich als `flex-1`.
- Footer mit `mt-auto`, damit er bei kurzen Seiten unten klebt und bei langen Seiten normal nach dem Content kommt.

3. Vite-Default-CSS entschärfen
- `src/App.css` bereinigen bzw. die störenden `#root`-Defaults entfernen:
  - kein `max-width: 1280px`
  - kein globales `padding: 2rem`
  - kein `text-align: center`
- So kann die App das Full-Width-Dashboard und den Footer korrekt ausfüllen.

4. Mobile/PWA-Abstände prüfen
- Bestehende Bottom-Nav-Abstände beibehalten, damit der Footer nicht von der mobilen Tab-Bar überdeckt wird.
- Footer-Padding nur dort belassen, wo es für Mobile/PWA nötig ist.

Betroffene Dateien:
- `src/App.tsx`
- `src/pages/Index.tsx`
- `src/pages/Auth.tsx` oder gemeinsames Layout statt lokaler Einbindung
- ggf. `src/pages/Install.tsx`
- ggf. `src/pages/NotFound.tsx`
- `src/App.css`
- eventuell kleine Klasse in `src/components/Footer.tsx`

Ergebnis nach Umsetzung:
- Footer erscheint auch in der Published-Version auf dem Login-Screen.
- Footer ist auf allen relevanten Seiten sichtbar.
- Footer sitzt stabil am unteren Seitenende.
- Kein versteckendes Alt-CSS vom Vite-Starter mehr.

Technische Notiz:
Wenn du den Footer nur im eingeloggten Bereich willst, setze ich trotzdem das Flex-Layout um und füge ihn gezielt in `Auth.tsx` zusätzlich hinzu. Wenn du ihn wirklich global willst, ist ein gemeinsames Layout in `App.tsx` die sauberste Lösung.
