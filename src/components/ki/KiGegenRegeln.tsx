// „Wo stehen wir?“ › KI gegen Regeln (16.11.2026, doc/FIX-REGELN-RAHMEN-FUER-PLANER-2026-11-16.md)
// Uli: „Zeige mir die Gegenrechnung jeden Morgen in Wo stehen wir an.“
// Daten: heizplan_vergleich (heizplaner aktion „vergleich“, täglich ~03:00 für den Vortag, echte PV, Start Mitternacht).
// Bereit für „KI steuert“, wenn 3 Tage in Folge (davon mindestens ein Sonnentag) gilt:
//   1. KI braucht weniger Netz als tatsächlich gesteuert (bereinigt um gespeicherte Wärme)
//   2. kein Raum öfter unter Min als tatsächlich
//   3. an Sonnentagen kein Netz-Heizen über Min
// Nur Tage, die mit Regel-Rahmen gerechnet sind (planer.regeln), zählen.
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Werte { netz_kwh?: number; netz_bereinigt_kwh?: number; unter_grenze_gradstd?: number; unter_ziel_gradstd?: number;
  heiz_kwh?: number; waerme_kwh?: number; regeln?: boolean; sonnentag?: boolean | null; sonnen_ratio?: number | null; netz_ueber_min_h?: number }
interface Zeile { tag: string; netz_gemessen_kwh: number | null; steuerung: Werte | null; planer: Werte | null }

export const UNTER_MIN_TOLERANZ = 0.5;   // °C·h – Rundung/Modellrauschen
export const TAGE_IN_FOLGE = 3;

export function pruefeTag(z: Zeile) {
  const st = z.steuerung ?? {}, pl = z.planer ?? {};
  const netzKi = Number(pl.netz_bereinigt_kwh ?? pl.netz_kwh), netzIst = Number(st.netz_kwh);
  const netz = Number.isFinite(netzKi) && Number.isFinite(netzIst) && netzKi <= netzIst;
  const min = Number(pl.unter_grenze_gradstd ?? 0) <= Number(st.unter_grenze_gradstd ?? 0) + UNTER_MIN_TOLERANZ;
  const sonne = pl.sonnentag !== true || Number(pl.netz_ueber_min_h ?? 0) === 0;
  return { netz, min, sonne, ok: netz && min && sonne, zaehlt: pl.regeln === true, netzKi, netzIst };
}

/** Tage in Folge (vom jüngsten an), die alle drei Bedingungen erfüllen, und ob ein Sonnentag dabei ist. */
export function bereitschaft(zeilen: Zeile[]) {
  let folge = 0, sonnentag = false;
  for (const z of zeilen) {                       // jüngster zuerst
    const p = pruefeTag(z);
    if (!p.zaehlt || !p.ok) break;
    folge++; if (z.planer?.sonnentag) sonnentag = true;
  }
  return { folge, sonnentag, bereit: folge >= TAGE_IN_FOLGE && sonnentag };
}

const n = (v: number | null | undefined, s = 1) =>
  v == null || !isFinite(Number(v)) ? '–' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: s, maximumFractionDigits: s });
const dm = (iso: string) => `${new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short' })} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const Haken = ({ ok, label }: { ok: boolean; label: string }) =>
  <span className={ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'} aria-label={`${label}: ${ok ? 'erfüllt' : 'nicht erfüllt'}`}>{ok ? '✓' : '✗'}</span>;

export function KiGegenRegeln() {
  const [zeilen, setZeilen] = useState<Zeile[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  useEffect(() => {
    db.from('heizplan_vergleich').select('tag, netz_gemessen_kwh, steuerung, planer').order('tag', { ascending: false }).limit(7)
      .then(({ data, error }: { data: Zeile[] | null; error: { message: string } | null }) => {
        if (error) setFehler(error.message); else setZeilen(data ?? []);
      });
  }, []);

  if (fehler) return <div className="text-sm text-red-600">Gegenrechnung nicht ladbar: {fehler}</div>;
  if (!zeilen) return <div className="text-sm text-muted-foreground">Lade Gegenrechnung …</div>;
  if (!zeilen.length) return <div className="text-sm text-muted-foreground">Noch keine Gegenrechnung vorhanden.</div>;

  const b = bereitschaft(zeilen);
  const gestern = zeilen[0];
  const pg = pruefeTag(gestern);
  const ampel = b.bereit ? 'bg-emerald-600' : b.folge > 0 ? 'bg-amber-500' : 'bg-red-600';
  const satz = b.bereit
    ? `Bereit: ${b.folge} Tage in Folge war die KI besser als die tatsächliche Steuerung, mit Sonnentag. Du kannst auf „KI steuert“ schalten.`
    : b.folge > 0
      ? `Noch nicht bereit: ${b.folge} von ${TAGE_IN_FOLGE} Tagen in Folge erfüllt${b.sonnentag ? '' : ', es fehlt noch ein Sonnentag'}.`
      : pg.zaehlt
        ? 'Noch nicht bereit: Gestern war die KI nicht besser als die tatsächliche Steuerung.'
        : 'Noch nicht bereit: Die Tage sind noch ohne Regel-Rahmen gerechnet.';

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 w-3 h-3 rounded-full shrink-0 ${ampel}`} aria-hidden="true" />
        <div className="space-y-1">
          <div className="font-semibold">KI gegen tatsächliche Steuerung – darf die KI steuern?</div>
          <div className="text-sm">{satz}</div>
          <div className="text-xs text-muted-foreground">
            Gegenrechnung vom {dm(gestern.tag)}: tatsächlich {n(pg.netzIst)} kWh Netz, KI {n(pg.netzKi)} kWh
            {Number.isFinite(pg.netzKi) && Number.isFinite(pg.netzIst) ? ` (${pg.netzKi <= pg.netzIst ? '−' : '+'}${n(Math.abs(pg.netzKi - pg.netzIst))} kWh)` : ''}.
            Bedingungen: weniger Netz <Haken ok={pg.netz} label="weniger Netz" /> · nicht öfter unter Min <Haken ok={pg.min} label="Min" /> · an Sonnentagen kein Netz über Min <Haken ok={pg.sonne} label="Sonnentag" />
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <caption className="sr-only">Gegenrechnung der letzten Tage: Netzstrom und Min, tatsächlich gegen KI</caption>
          <thead className="text-xs text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 pr-2 font-medium">Tag</th>
              <th className="py-1 pr-2 font-medium">Sonne</th>
              <th className="py-1 pr-2 font-medium text-right">Netz tatsächlich</th>
              <th className="py-1 pr-2 font-medium text-right">Netz KI</th>
              <th className="py-1 pr-2 font-medium text-right">unter Min tats. / KI</th>
              <th className="py-1 font-medium text-center">besser?</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map(z => { const p = pruefeTag(z); return (
              <tr key={z.tag} className="border-t">
                <td className="py-1.5 pr-2 whitespace-nowrap">{dm(z.tag)}</td>
                <td className="py-1.5 pr-2">{z.planer?.sonnentag == null ? '–' : z.planer.sonnentag ? 'Sonnentag' : 'wenig'}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{n(p.netzIst)} kWh</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{n(p.netzKi)} kWh</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{n(z.steuerung?.unter_grenze_gradstd)} / {n(z.planer?.unter_grenze_gradstd)} °C·h</td>
                <td className="py-1.5 text-center">{p.zaehlt ? <Haken ok={p.ok} label={`${z.tag} besser`} /> : <span className="text-xs text-muted-foreground">ohne Regeln</span>}</td>
              </tr>); })}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-muted-foreground">
        Gerechnet jede Nacht für den Vortag mit der echten PV. „Netz KI“ ist bereinigt um die Wärme, die die KI am Tagesende
        mehr oder weniger im Estrich gespeichert hätte. „Tatsächlich“ ist, was die Steuerung an dem Tag wirklich gemacht hat
        (im Modus „KI rechnet mit“ die Regeln). Den Modus schaltest nur du.
      </div>
    </div>
  );
}
