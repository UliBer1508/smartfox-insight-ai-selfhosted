// "Das Wichtigste" für den Tab Analyse: Befunde aus der Tagesauswertung und – wo der Schluss
// eindeutig genug ist – ein konkreter Einstellungs-Vorschlag (Stand 26.10.2026).
//
// Grundsätze:
//   - Vorschläge nur für abgeschlossene Tage (ein halber Tag ist keine Grundlage).
//   - Vorschläge nur für Parameter aus ai_parameter_whitelist, innerhalb der Grenzen.
//   - Wo die Ursache nicht eindeutig ist, gibt es nur den Befund und einen Hinweis, wo man
//     nachsehen kann – kein Vorschlag.
//   - Angewendet wird erst nach Bestätigung (Dialog zeigt aktuell → neu und die Begründung).

import { DayAnalysis } from '@/lib/dayAnalysis';
import { HeatingSettings } from '@/types/heating';
import { WhitelistRow, NOT_A_SETTING_KEYS } from '@/lib/aiParameters';

export type FindingTone = 'potential' | 'warning' | 'good' | 'info';

export interface Proposal {
  wl: WhitelistRow;
  roomId: string | null;
  current: unknown;
  proposed: string;
  label: string;       // "PV-Schwelle EIN"
  unit: string;
  reasoning: string;
  evidence: Record<string, unknown>;
}

export interface Finding {
  id: string;
  tone: FindingTone;
  title: string;
  text: string;
  proposal?: Proposal;
  link?: { tab: 'ki' | 'settings'; label: string };
}

const kwh = (wh: number) => `${(wh / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} kWh`;
const floor50 = (n: number) => Math.floor(n / 50) * 50;

function wlFor(whitelist: WhitelistRow[], key: string, scope: 'global' | 'room' = 'global') {
  return whitelist.find((w) => w.parameter_key === key && w.scope === scope && w.enabled && !NOT_A_SETTING_KEYS.has(key));
}

export function buildFindings(a: DayAnalysis, settings: HeatingSettings, whitelist: WhitelistRow[]): Finding[] {
  const out: Finding[] = [];
  const canPropose = a.complete && a.heatingDataReliable;
  const reserve = settings.battery_reserve_for_night_soc ?? 60;

  // 1) Eingespeist, während Räume unter Komfort warteten
  if (a.coldExport.wh >= 1000) {
    const rooms = a.coldExport.rooms;
    const f: Finding = {
      id: 'cold-export',
      tone: 'potential',
      title: `${kwh(a.coldExport.wh)} eingespeist, während ${rooms.length} ${rooms.length === 1 ? 'Raum' : 'Räume'} unter Komfort ${rooms.length === 1 ? 'war' : 'waren'}`,
      text: `${rooms.join(', ')} – zusammen ${Math.round(a.coldExport.minutes)} min mit mindestens 500 W Einspeisung. Typische Einspeisung dabei ${a.coldExport.medianExportW} W.`,
    };
    const thrOn = Number(settings.pv_surplus_threshold_on ?? 500);
    const thrOff = Number(settings.pv_surplus_threshold_off ?? 200);
    const minPower = a.coldExport.minColdRoomPowerW ?? 0;
    const median = a.coldExport.medianExportW;
    const wl = wlFor(whitelist, 'pv_surplus_threshold_on');

    if (median < thrOn && median >= 0.8 * minPower) {
      // Überschuss hätte für den kleinsten wartenden Raum gereicht, lag aber unter der Einschaltschwelle.
      const target = Math.max(floor50(median), wl?.min_value ?? 200, thrOff + 100);
      if (wl && canPropose && target < thrOn && (wl.max_value == null || target <= wl.max_value)) {
        f.proposal = {
          wl, roomId: null, current: thrOn, proposed: String(target),
          label: 'PV-Überschuss Schwelle EIN', unit: 'W',
          reasoning: `Analyse ${a.date}: ${kwh(a.coldExport.wh)} eingespeist, während ${rooms.join(', ')} unter Komfort waren. Die Einspeisung lag typischerweise bei ${median} W – unter der Einschaltschwelle von ${thrOn} W, aber genug für den kleinsten wartenden Raum (${minPower} W).`,
          evidence: { date: a.date, cold_export_wh: Math.round(a.coldExport.wh), median_export_w: median, min_room_power_w: minPower, rooms },
        };
        f.text += ` Die Einschaltschwelle (${thrOn} W) lag darüber.`;
      } else {
        f.text += ` Die Einschaltschwelle (${thrOn} W) lag darüber.${canPropose ? '' : ' Vorschlag erst, wenn der Tag abgeschlossen ist.'}`;
      }
    } else if (minPower > 0 && median < 0.8 * minPower) {
      f.text += ` Der Überschuss war zu klein für den kleinsten wartenden Raum (${minPower} W) – hier hilft nur Mikro-Budget oder eine andere Reihenfolge der Räume.`;
      f.link = { tab: 'settings', label: 'Räume & Priorität ansehen' };
    } else {
      f.text += ' Die Schwelle war nicht der Grund – die Begründungen stehen im KI-Protokoll der pv-automation.';
      f.link = { tab: 'ki', label: 'KI-Protokoll ansehen' };
    }
    out.push(f);
  }

  // 2) Heizung aus dem Netz
  if (a.heatGridWh >= 500) {
    const nightShare = a.heatGridWh > 0 ? a.heatGridNightWh / a.heatGridWh : 0;
    const f: Finding = {
      id: 'grid-heating',
      tone: 'warning',
      title: `Heizung: ${kwh(a.heatGridWh)} aus dem Netz`,
      text: nightShare >= 0.5
        ? `${Math.round(nightShare * 100)} % davon nachts.`
        : 'Vor allem tagsüber – bei zu wenig Sonne oder leerer Batterie.',
    };
    const wl = wlFor(whitelist, 'night_heating_mode');
    if (nightShare >= 0.5 && a.heatGridNightWh >= 1000 && settings.night_heating_mode === 'maintain' && wl && canPropose) {
      f.text += ' Nachts ist „Nacht-Temperatur halten“ eingestellt.';
      f.proposal = {
        wl, roomId: null, current: 'maintain', proposed: 'frost_only',
        label: 'Nacht-Heizmodus', unit: '',
        reasoning: `Analyse ${a.date}: ${kwh(a.heatGridNightWh)} Heizstrom nachts aus dem Netz im Modus „Nacht-Temperatur halten“. „Nur Frostschutz“ spart diesen Netzbezug; der Estrich gibt tagsüber gespeicherte Wärme ab. Nachteil: kühlere Räume am Morgen.`,
        evidence: { date: a.date, heat_grid_night_wh: Math.round(a.heatGridNightWh), heat_grid_wh: Math.round(a.heatGridWh) },
      };
    }
    out.push(f);
  }

  // 3) Nacht-Reserve
  if (a.socAtNightStart != null && a.socAtNightStart < reserve) {
    out.push({
      id: 'reserve',
      tone: 'warning',
      title: `Nacht-Reserve verfehlt: ${Math.round(a.socAtNightStart)} % zu Nachtbeginn (Ziel ${reserve} %)`,
      text: 'Die Batterie-Grenzwerte schlägt die KI-Batterie-Empfehlung vor – dort prüfen und bestätigen.',
      link: { tab: 'ki', label: 'Zur KI-Batterie-Empfehlung' },
    });
  }

  // 4) Prognose
  if (a.complete && a.forecastKwh && a.forecastKwh > 2 && a.pvWh > 0) {
    const ratio = a.pvWh / 1000 / a.forecastKwh;
    if (ratio < 0.75 || ratio > 1.25) {
      out.push({
        id: 'forecast',
        tone: 'info',
        title: `PV ${Math.round(ratio * 100)} % der Prognose`,
        text: `${kwh(a.pvWh)} statt ${a.forecastKwh.toLocaleString('de-DE')} kWh erwartet. Die Trefferquote über mehrere Tage steht unter „Prognose & Wetter“.`,
      });
    }
  }

  // 5) Gute Nachricht, wenn nichts zu tun ist
  if (out.length === 0 && a.heatWh > 0) {
    out.push({
      id: 'good',
      tone: 'good',
      title: a.heatGridWh < 100 ? 'Heizung lief aus Sonne und Batterie' : 'Keine Auffälligkeiten',
      text: `${kwh(a.heatSunWh)} aus Sonne, ${kwh(a.heatBatteryWh)} aus der Batterie, ${kwh(a.heatGridWh)} aus dem Netz.${a.socAtNightStart != null ? ` Nacht-Reserve erreicht (${Math.round(a.socAtNightStart)} %).` : ''}`,
    });
  }
  if (!a.heatingDataReliable) {
    out.push({
      id: 'unreliable',
      tone: 'info',
      title: 'Heizdaten vor dem 24.10.2026 unzuverlässig',
      text: 'Bis zum Treiber v1.3 meldeten die Thermostate „heizt“ nie. Heizenergie und Vorschläge sind für diesen Tag nicht aussagekräftig.',
    });
  }
  return out;
}
