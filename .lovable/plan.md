
# Fix: Fehlerhafte "{}" Anzeige auf der Login-Seite

## Problem

Beim Laden der Auth-Seite wird ein abgelaufener Session-Token erkannt. Der Refresh schlaegt fehl und der Fehler wird als leeres JavaScript-Objekt `{}` statt als lesbarer Text gespeichert. Die Alert-Komponente zeigt dieses Objekt dann woertlich als `{}` an.

## Ursache

Im `useAuth`-Hook wird bei `onAuthStateChange` kein Fehler-Handling durchgefuehrt. Wenn der Session-Refresh fehlschlaegt, kann ein Fehlerobjekt in den State gelangen, das kein `.message`-Property hat.

## Loesung

### Datei: `src/hooks/useAuth.ts`

1. Im `onAuthStateChange`-Callback: Bei Events wie `TOKEN_REFRESHED` oder `SIGNED_OUT` den bestehenden Fehler-State zuruecksetzen
2. In den `signIn`- und `signUp`-Funktionen: Sicherstellen, dass nur Strings als Fehler gesetzt werden (Fallback auf `String(error)` wenn `error.message` nicht existiert)
3. Beim initialen `getSession()`-Aufruf: Fehler abfangen und ignorieren (der User muss sich einfach neu anmelden)

### Datei: `src/pages/Auth.tsx`

1. Absicherung in der Fehleranzeige: `typeof error === 'string'` pruefen, bevor der Fehler dargestellt wird. Falls es kein String ist, einen generischen Fehlertext anzeigen.

## Ergebnis

- Keine `{}` Anzeige mehr auf der Login-Seite
- Abgelaufene Sessions fuehren nicht zu verwirrenden Fehlermeldungen
- Der User kann sich einfach normal einloggen
