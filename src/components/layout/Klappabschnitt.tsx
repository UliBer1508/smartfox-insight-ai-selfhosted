// Nummerierter, klappbarer Abschnitt (12.11.2026, Uli: „alle Seiten klappbar bitte“).
// Ein Baustein für Auto-Steuerung, KI und Analyse. Auf/zu merkt sich je Gerät (localStorage, darf fehlen).
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
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
  const kopf = (
    <div className="flex items-start gap-3">
      <button type="button" onClick={umschalten} aria-expanded={!zu} aria-controls={`inhalt-${id}`}
        className="flex items-start gap-3 text-left min-w-0 flex-1 group">
        <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold shrink-0 ${farbe}`} aria-hidden="true">{n}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <h2 className="text-base font-semibold leading-tight">{titel}</h2>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${zu ? '-rotate-90' : ''}`} aria-hidden="true" />
          </span>
          {frage && <span className="block text-sm text-muted-foreground">{frage}</span>}
        </span>
      </button>
      {rechts}
    </div>
  );
  const inhalt = zu ? null : <div id={`inhalt-${id}`} className={karte ? 'space-y-4' : 'space-y-3'}>{children}</div>;
  if (karte) return <Card><CardContent className="p-4 md:p-5 space-y-4">{kopf}{inhalt}</CardContent></Card>;
  return <section className="space-y-3">{kopf}{inhalt}</section>;
}
