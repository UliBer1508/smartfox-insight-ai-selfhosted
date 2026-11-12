// Nummerierter, klappbarer Abschnitt (12.11.2026, Uli: „alle Seiten klappbar bitte“).
// Ein Baustein für Auto-Steuerung, KI und Analyse. Auf/zu merkt sich je Gerät (localStorage, darf fehlen).
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';

const lesen = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const schreiben = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ohne Speicher: nur für diese Sitzung */ } };

export function Klappabschnitt({ id, n, titel, frage, rechts, karte = false, farbe = 'bg-violet-600 text-white', children }: {
  /** eindeutig je Abschnitt, z. B. „auto-plan“ – Schlüssel für den gemerkten Zustand */
  id: string; n: number; titel: string; frage?: string; rechts?: React.ReactNode;
  /** true: ganzer Abschnitt in einer Karte (Analyse), sonst Überschrift über dem Inhalt */
  karte?: boolean; farbe?: string; children: React.ReactNode;
}) {
  const key = `abschnitt-zu:${id}`;
  const [zu, setZu] = useState(() => lesen(key) === '1');
  const umschalten = () => { setZu(z => { schreiben(key, z ? '0' : '1'); return !z; }); };
  // Darstellung wie Heizung München (12.11.2026): jeder Abschnitt ist eine Karte, Kopf ganz als Knopf,
  // Nummer links, Titel + Frage, Pfeil ▶ rechts (dreht beim Aufklappen nach unten).
  const kopf = (
    <div className="flex items-center gap-3">
      <button type="button" onClick={umschalten} aria-expanded={!zu} aria-controls={`inhalt-${id}`}
        className="flex items-center gap-3 md:gap-4 text-left min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className={`w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center font-semibold shrink-0 ${farbe}`} aria-hidden="true">{n}</span>
        <span className="min-w-0 flex-1">
          <h2 className="text-base md:text-lg font-semibold leading-tight">{titel}</h2>
          {frage && <span className="block text-sm text-muted-foreground mt-1">{frage}</span>}
        </span>
      </button>
      {rechts}
      <button type="button" onClick={umschalten} aria-hidden="true" tabIndex={-1}
        className={`shrink-0 text-xs text-muted-foreground px-1 transition-transform ${zu ? '' : 'rotate-90'}`}>▶</button>
    </div>
  );
  // Inhalt steht in derselben Karte; ist das Kind selbst eine Karte (Card), wird deren Rahmen entfernt,
  // damit keine Karte in der Karte entsteht. Kacheln weiter innen bleiben Kacheln.
  const flach = '[&>.shadow-sm]:border-0 [&>.shadow-sm]:shadow-none [&>.shadow-sm]:bg-transparent [&>.shadow-sm]:rounded-none [&>.shadow-sm>div]:p-0';
  const inhalt = zu ? null : <div id={`inhalt-${id}`} className={`space-y-4 ${flach}`}>{children}</div>;
  void karte; // früher: Karte nur in der Analyse – jetzt überall Karte wie München
  return <Card><CardContent className={`p-4 md:p-6 ${zu ? '' : 'space-y-5'}`}>{kopf}{inhalt}</CardContent></Card>;
}
