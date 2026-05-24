## Ziel

Updates sollen **zuverlässig und schnell** auf den Clients ankommen, sobald die App geöffnet oder der Tab in den Vordergrund kommt – aber **kein dauerhaftes 30-min-Polling** im Hintergrund.

## Diagnose

Aktuell in `src/pwa/registerSW.ts`:
- `setInterval(registration.update, 30min)` – verursacht das von dir kritisierte „ständige Prüfen".
- `visibilitychange → registration.update()` – existiert bereits, ist aber der einzige zuverlässige Trigger und wird teilweise vom Browser unterdrückt (kein `focus`, kein `online`, kein Aufruf direkt nach `controllerchange`-Reload).
- Folge: Update wird oft erst **deutlich verzögert** erkannt, weil der einzige Trigger ein echter Visibility-Wechsel ist (und der Browser bei häufigen Wechseln throttelt).

Workbox-Setup in `vite.config.ts` ist korrekt (`NetworkFirst` für HTML, `skipWaiting:false`, manuelles `updateSW(true)`). Daran ändern wir nichts.

## Änderungen (nur `src/pwa/registerSW.ts`)

1. **30-min-Interval entfernen** – kein periodisches Polling mehr.
2. **Update-Check explizit bei diesen Events** (jeder Check ist ein einmaliger Aufruf, kein Loop):
   - Direkt nach Registrierung (`immediate: true` macht das implizit, zusätzlich ein expliziter `registration.update()` ~2 s nach Start, damit beim ersten Öffnen frisch geprüft wird).
   - `visibilitychange` → wenn `visible`.
   - `window.focus` (fängt Fälle, in denen Visibility nicht feuert, z. B. PWA aus Hintergrund auf iOS).
   - `online`-Event (Wiederkehr aus Offline).
   - Manueller Tab-Wechsel innerhalb der App: bleibt unverändert ohne Extra-Trigger – die obigen Events reichen.
3. **Throttle** auf 60 s zwischen zwei `registration.update()`-Calls, damit ein hektischer User nicht spammt – aber **kein** zeitbasiertes Polling.
4. **`onNeedRefresh`** ruft weiterhin sofort `updateSW(true)` auf → neuer SW aktiviert sich, `controllerchange` triggert genau einen Reload (Guard `reloading` bleibt).

## Was sich NICHT ändert

- Manifest, Workbox-Caching-Strategien, Iframe-/Preview-Guard.
- Verhalten im Lovable-Editor (SW bleibt dort deaktiviert).
- Cloud, Edge-Functions, DB.

## Erwartetes Verhalten nach dem Fix

- Du publishst → beim nächsten Öffnen der App **oder** sobald der Tab in den Vordergrund kommt (≤ wenige Sekunden) wird der neue Build erkannt, der SW aktiviert sich und die Seite reloadet **einmal** automatisch.
- Im Hintergrund läuft **keine** periodische Prüfung mehr.

## Technische Details

```text
registerSW({ immediate: true, onNeedRefresh: () => updateSW(true) })
  → onRegisteredSW(reg):
       setTimeout(() => safeUpdate(reg), 2000)         // initial nach Boot
       on visibilitychange (visible) → safeUpdate(reg)
       on window 'focus'             → safeUpdate(reg)
       on window 'online'            → safeUpdate(reg)

safeUpdate(reg): throttle 60s, reg.update().catch(noop)
controllerchange → einmaliger Reload (bestehender Guard)
```

Kein neues Package, keine Migration, keine Backend-Änderung. Nach Approval reicht ein Publish, damit Clients beim nächsten Fokus den Fix selbst ziehen (letzter „alter" Update-Zyklus).
