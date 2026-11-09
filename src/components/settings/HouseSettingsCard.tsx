// "Haus"-Einstellungen der Heizung Venediger im Aufbau der Heizung München:
// Werte in kleinen Gruppen, ein Speichern-Knopf, gespeichert werden NUR geänderte Felder.
//
// Regeln (Stand 23.10.2026):
// - Angezeigter Ersatzwert (wenn die DB leer ist) = Ersatzwert im Code der pv-automation.
// - Leere oder ungültige Eingaben werden nicht gespeichert, sondern angemahnt.
// - Ausgeblendet, weil ohne Wirkung: pv_boost_temp_delta.
// - max_grid_heating_power_w ist seit 27.10.2026 wieder sichtbar und wirksam (Tagesmodus,
//   doc/KONZEPT-TAGESABLAUF-HEIZUNG-2026-10-27.md).
//   Strompreise werden im Bereich "Tarife & Preisverlauf" gepflegt (Quelle der Wahrheit).
//   Die DB-Werte dieser Felder bleiben unverändert stehen.
import { ReactNode, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HeatingSettings } from '@/types/heating';
import { sameValue } from '@/lib/safeSave';
import { Moon, Sun, Battery, Shuffle, Factory, Save, Loader2, Home } from 'lucide-react';
import { SectionCard, Eyebrow, FieldGrid, LabeledInput, SwitchRow } from './SettingsBits';

type Kind = 'number' | 'time' | 'switch' | 'select';
type Values = Record<string, unknown>;
interface Spec {
  k: string;
  l: string;
  kind: Kind;
  def: unknown;               // Ersatzwert = Code-Default
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  hint?: string;
  options?: { v: string; l: string }[];
  showIf?: (v: Values) => boolean;
}
interface Group { title: string; icon: ReactNode; fields: Spec[] }

const AZIMUTH = [
  { v: '0', l: 'Süd (0°)' }, { v: '45', l: 'Südwest (45°)' }, { v: '-45', l: 'Südost (−45°)' },
  { v: '90', l: 'West (90°)' }, { v: '-90', l: 'Ost (−90°)' }, { v: '135', l: 'Nordwest (135°)' },
  { v: '-135', l: 'Nordost (−135°)' }, { v: '180', l: 'Nord (180°)' },
];

const GROUPS: Group[] = [
  {
    title: 'Zeiten', icon: <Moon className="w-3.5 h-3.5 text-indigo-500" />,
    fields: [
      { k: 'night_start_time', l: 'Nacht ab', kind: 'time', def: '22:00' },
      { k: 'night_end_time', l: 'Nacht bis', kind: 'time', def: '08:00', hint: 'Tagesstart: Räume werden neu bewertet' },
      {
        k: 'night_heating_mode', l: 'Nachts', kind: 'select', def: 'frost_only',
        options: [{ v: 'frost_only', l: 'Frostschutz 5 °C' }, { v: 'maintain', l: 'Nacht-Temperatur halten' }],
      },
      { k: 'floor_heating_response_hours', l: 'Vorlauf Fußbodenheizung', kind: 'number', def: 0, unit: 'h', step: 0.5, min: 0, max: 3, hint: 'max. 3 h vor Nacht-Ende' },
    ],
  },
  {
    title: 'Anwesenheit', icon: <Home className="w-3.5 h-3.5 text-primary" />,
    fields: [
      { k: 'presence_control_enabled', l: 'Anwesenheit steuern', kind: 'switch', def: true, hint: 'An: Während einer Abwesenheit im Kalender (Einstellungen › Anwesenheit) halten die Räume „Untergrenze“, Sonne heizt bis Eco und dann Komfort. Sonst und bei Aus: immer wie bewohnt.' },
      { k: 'presence_lead_hours', l: 'Vorlauf vor Rückkehr', kind: 'number', def: 6, unit: 'h', step: 1, min: 0, max: 72, hint: 'so lange vor dem Ende einer Abwesenheit wird wieder normal geheizt', showIf: (v) => v.presence_control_enabled !== false },
      { k: 'presence_arrival_time', l: 'Standard-Rückkehr', kind: 'time', def: '14:00', hint: 'setzt der Kalender beim Antippen eines Tages ein – pro Eintrag änderbar', showIf: (v) => v.presence_control_enabled !== false },
      { k: 'presence_departure_time', l: 'Standard-Abreise', kind: 'time', def: '11:00', showIf: (v) => v.presence_control_enabled !== false },
    ],
  },
  {
    title: 'PV-Überschuss', icon: <Sun className="w-3.5 h-3.5 text-energy-export" />,
    fields: [
      { k: 'pv_surplus_threshold_on', l: 'Heizen ab', kind: 'number', def: 500, unit: 'W', step: 100, min: 0, max: 10000, hint: 'Einspeisung für neuen Raum' },
      { k: 'pv_surplus_threshold_off', l: 'Stoppen unter', kind: 'number', def: 200, unit: 'W', step: 100, min: 0, max: 10000 },
      { k: 'min_switch_interval_min', l: 'Mindest-Heizdauer je Raum', kind: 'number', def: 25, unit: 'min', step: 5, min: 1, max: 120, hint: 'schont Thermostate' },
    ],
  },
  {
    title: 'Batterie', icon: <Battery className="w-3.5 h-3.5 text-primary" />,
    fields: [
      { k: 'heating_min_battery_soc', l: 'Mindest-Ladestand für Heizung', kind: 'number', def: 80, unit: '% SoC', step: 5, min: 30, max: 95, hint: 'darunter Batterie-Schutz: Sonne lädt zuerst die Batterie, geheizt wird nur mit echter Einspeisung – auch wenn die Batterie gerade lädt' },
      { k: 'battery_gate_floor_delta', l: 'Notfall-Abstand unter Untergrenze', kind: 'number', def: 0, unit: '°C', step: 0.5, min: 0, max: 5, hint: '0 = Untergrenze gilt auch im Batterie-Schutz hart (Standard seit 02.11.2026). Batterie-Schutz gilt nur an Sonnentagen.' },
      { k: 'battery_gate_max_power_w', l: 'Max. Notfall-Heizleistung', kind: 'number', def: 1000, unit: 'W', step: 100, min: 0, max: 10000, hint: 'im Batterie-Schutz höchstens so viel gleichzeitig (nach Priorität). Ein Raum, der allein größer ist, heizt nur allein. 0 = gar nicht' },
      {
        k: 'heating_soc_gate_mode', l: 'Unter Mindest-Ladestand', kind: 'select', def: 'strict',
        options: [{ v: 'strict', l: 'Sofort stoppen (strikt)' }, { v: 'soft', l: 'Fertigheizen lassen (sanft)' }],
      },
      { k: 'battery_buffer_enabled', l: 'Batterie-Puffer', kind: 'switch', def: true, hint: 'Zusätzliches Budget aus der Batterie, wenn sie weit über dem Mindest-Ladestand ist und die Prognose reicht.' },
      { k: 'battery_buffer_bonus_w', l: 'Max. Puffer', kind: 'number', def: 500, unit: 'W', step: 100, min: 200, max: 1500, showIf: (v) => v.battery_buffer_enabled !== false },
      { k: 'tolerant_deactivation_enabled', l: 'Tolerant bei Wolken', kind: 'switch', def: true, hint: 'Laufende Räume heizen bei kurzen PV-Einbrüchen weiter.' },
      { k: 'battery_soc_suggestion_enabled', l: 'KI-Vorschläge für Mindest-Ladestand', kind: 'switch', def: true, hint: 'Täglich 21:00: gemessener Nachtbedarf + Abend/Morgen ohne PV + Reserve, mit Mustergedächtnis. Nur Vorschlag – übernehmen im Tab KI.' },
      { k: 'battery_night_reserve_pct', l: 'Reserve über Nachtbedarf', kind: 'number', def: 10, unit: '%', step: 5, min: 0, max: 40, hint: 'enthält den Mindest-Ladestand des Wechselrichters (~5 %)', showIf: (v) => v.battery_soc_suggestion_enabled !== false },
    ],
  },
  {
    title: 'Verteilung auf die Räume', icon: <Shuffle className="w-3.5 h-3.5 text-orange-500" />,
    fields: [
      { k: 'power_budget_enabled', l: 'Leistungsbudget', kind: 'switch', def: true, hint: 'Räume nacheinander nach Priorität einschalten, solange das Budget reicht.' },
      { k: 'max_grid_heating_power_w', l: 'Max. Heizleistung ohne PV', kind: 'number', def: 2000, unit: 'W', step: 100, min: 0, max: 20000, hint: 'Summe der Räume, die ohne Überschuss gleichzeitig heizen dürfen (nach Priorität) – gilt immer, tagsüber und nachts, auch für Räume unter der „Untergrenze“. Ein Raum, der allein größer ist (Wohnzimmer), heizt nur, wenn sonst keiner heizt. Im Batterie-Schutz gilt die Notfall-Heizleistung. 0 = ohne PV gar nicht heizen.' },
      { k: 'cap_wait_boost_min', l: 'Wartezeit bis Vorrang', kind: 'number', def: 60, unit: 'min', step: 15, min: 0, max: 240, hint: 'Wartet ein Raum so lange auf freie Leistung, kommt er als Nächster dran – auch vor Räumen mit höherer Priorität. 0 = nur Priorität.' },
      { k: 'cap_keep_max_min', l: 'Wer heizt, behält Leistung höchstens', kind: 'number', def: 120, unit: 'min', step: 15, min: 0, max: 480, hint: 'Ein Raum, der Leistung bekommen hat und heizt, heizt bis zu seinem Ziel weiter – andere warten. Wartet ein großer Raum mit Vorrang (Wohnzimmer), bekommen andere keine neue Leistung, bis er allein heizen kann. 0 = aus.' },
      { k: 'ziel_abschalt_ueber_c', l: 'Abschalten bei Ziel +', kind: 'number', def: 0.3, unit: '°C', step: 0.1, min: 0, max: 2, hint: 'Die Thermostate schalten erst bei Soll + Schaltband (1,0 °C) ab. Die Automatik schaltet einen Raum schon ab, wenn er sein Ziel (Untergrenze/Nachtwert) um diesen Wert überschritten hat.' },
      { k: 'planer_modus', l: 'Planer', kind: 'select', def: 'schatten', options: [{ v: 'schatten', l: 'Schattenbetrieb (rechnet, steuert nicht)' }, { v: 'aus', l: 'Aus' }], hint: 'Rechnet alle 15 min einen 24-h-Plan mit möglichst wenig Netzstrom. Ansicht: KI › Planer.' },
      { k: 'planer_gewicht_ziel', l: 'Planer: Wert von 1 °C·h unter Ziel', kind: 'number', def: 0.6, unit: 'kWh', step: 0.1, min: 0, max: 10, hint: 'So viel Netzstrom ist es dir wert, eine Stunde lang 1 °C wärmer zu haben (Ziel = Eco tags, Nachtwert nachts). Höher = wärmer, mehr Netz.', showIf: (v) => v.planer_modus !== 'aus' },
      { k: 'planer_gewicht_unter', l: 'Planer: zusätzlich unter Untergrenze', kind: 'number', def: 2, unit: 'kWh', step: 0.5, min: 0, max: 20, showIf: (v) => v.planer_modus !== 'aus' },
      { k: 'planer_sicherheit_abstand', l: 'Planer: nie tiefer als Untergrenze −', kind: 'number', def: 1.5, unit: '°C', step: 0.5, min: 0, max: 5, showIf: (v) => v.planer_modus !== 'aus' },
      { k: 'power_budget_tolerance_w', l: 'Toleranz', kind: 'number', def: 200, unit: 'W', step: 50, min: 0, max: 2000, hint: 'erlaubter kurzer Netzbezug', showIf: (v) => v.power_budget_enabled !== false },
      { k: 'micro_budget_enabled', l: 'Mikro-Budget', kind: 'switch', def: true, hint: 'Bei kleinem Überschuss heizt reihum ein Raum kurz (Batterie als Puffer).' },
      { k: 'micro_heat_duration_min', l: 'Heizdauer je Runde', kind: 'number', def: 5, unit: 'min', step: 1, min: 3, max: 15, showIf: (v) => v.micro_budget_enabled !== false },
      { k: 'room_rotation_minutes', l: 'Pause bis zum nächsten Raum', kind: 'number', def: 30, unit: 'min', step: 5, min: 10, max: 120, showIf: (v) => v.micro_budget_enabled !== false },
      { k: 'min_room_pause_minutes', l: 'Mindest-Pause je Raum', kind: 'number', def: 15, unit: 'min', step: 5, min: 5, max: 60 },
    ],
  },
  {
    title: 'Thermostat-Fühler', icon: <Sun className="w-3.5 h-3.5 text-warning" />,
    fields: [
      { k: 'fuehler_pruefung_aktiv', l: 'Sonne auf dem Fühler erkennen', kind: 'switch', def: true, hint: 'Springt die gemeldete Temperatur sprunghaft (Sonne auf dem Thermostat), rechnet das System mit dem letzten plausiblen Wert weiter und lässt den Raum in der Automatik aus. Protokoll: „Fühler in der Sonne“.' },
      { k: 'fuehler_sprung_c', l: 'Sprung zwischen zwei Lesungen ab', kind: 'number', def: 2.0, unit: '°C', step: 0.5, min: 1, max: 10, hint: 'gemessen 09.11.: Sonnenspitzen 2,2–3,7 °C, sonst höchstens 1,4 °C (Heizen), DP-19-Umstellung 1,0 °C', showIf: (v) => v.fuehler_pruefung_aktiv !== false },
      { k: 'fuehler_sprung15_c', l: 'oder Anstieg in 15 min ab', kind: 'number', def: 3.0, unit: '°C', step: 0.5, min: 1.5, max: 15, showIf: (v) => v.fuehler_pruefung_aktiv !== false },
      { k: 'fuehler_ende_abstand_c', l: 'Ende: unter der Spitze um', kind: 'number', def: 1.5, unit: '°C', step: 0.5, min: 0.5, max: 10, hint: 'und 10 min ruhig – dann gilt der gemeldete Wert wieder', showIf: (v) => v.fuehler_pruefung_aktiv !== false },
      { k: 'fuehler_max_stunden', l: 'Höchstens halten', kind: 'number', def: 3, unit: 'h', step: 0.5, min: 0.5, max: 8, showIf: (v) => v.fuehler_pruefung_aktiv !== false },
    ],
  },
  {
    title: 'Anlage', icon: <Factory className="w-3.5 h-3.5 text-muted-foreground" />,
    fields: [
      { k: 'pv_capacity_kwp', l: 'PV-Leistung', kind: 'number', def: 15.8, unit: 'kWp', step: 0.1, min: 0.1, max: 100 },
      { k: 'battery_capacity_kwh', l: 'Batterie', kind: 'number', def: 13.8, unit: 'kWh', step: 0.1, min: 0, max: 100 },
      { k: 'total_heating_power_w', l: 'Heizleistung gesamt', kind: 'number', def: 9600, unit: 'W', step: 100, min: 0, max: 100000 },
      {
        k: 'heating_type', l: 'Heizungstyp', kind: 'select', def: 'direct_electric',
        options: [{ v: 'direct_electric', l: 'Elektro-Fußbodenheizung' }, { v: 'heat_pump', l: 'Wärmepumpe' }, { v: 'water', l: 'Wasser-Fußbodenheizung' }],
      },
      { k: 'latitude', l: 'Breitengrad', kind: 'number', def: 47.24983, step: 0.00001, min: -90, max: 90, hint: 'für PV-Prognose & Wetter' },
      { k: 'longitude', l: 'Längengrad', kind: 'number', def: 12.25415, step: 0.00001, min: -180, max: 180 },
      { k: 'roof_azimuth', l: 'Dach-Ausrichtung', kind: 'select', def: 0, options: AZIMUTH },
      { k: 'roof_declination', l: 'Dach-Neigung', kind: 'number', def: 35, unit: '°', step: 1, min: 0, max: 90 },
    ],
  },
];

const ALL: Spec[] = GROUPS.flatMap((g) => g.fields);

function toInput(spec: Spec, v: unknown): string {
  if (v == null) return '';
  if (spec.kind === 'time') return String(v).slice(0, 5);
  return String(v);
}

interface Props {
  settings: HeatingSettings;
  onSave: (patch: Partial<HeatingSettings>) => Promise<boolean>;
  isLoading: boolean;
}

export function HouseSettingsCard({ settings, onSave, isLoading }: Props) {
  const db = settings as unknown as Values;
  const [draft, setDraft] = useState<Values>({});
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Ausgangswert je Feld: DB-Wert, sonst Code-Default
  const original = (s: Spec) => (db[s.k] ?? s.def);
  const current = (s: Spec) => (s.k in draft ? draft[s.k] : original(s));
  const values: Values = Object.fromEntries(ALL.map((s) => [s.k, current(s)]));

  const parse = (s: Spec, raw: unknown): { ok: boolean; value?: unknown; msg?: string } => {
    if (s.kind === 'switch') return { ok: true, value: Boolean(raw) };
    if (s.kind === 'select') {
      const isNum = typeof s.def === 'number';
      return { ok: true, value: isNum ? Number(raw) : raw };
    }
    const str = String(raw ?? '').trim();
    if (str === '') return { ok: false, msg: `${s.l}: bitte einen Wert eintragen` };
    if (s.kind === 'time') {
      return /^\d{2}:\d{2}$/.test(str.slice(0, 5)) ? { ok: true, value: str.slice(0, 5) } : { ok: false, msg: `${s.l}: Uhrzeit ungültig` };
    }
    const n = Number(str.replace(',', '.'));
    if (Number.isNaN(n)) return { ok: false, msg: `${s.l}: keine Zahl` };
    if (s.min != null && n < s.min) return { ok: false, msg: `${s.l}: mindestens ${s.min}${s.unit ? ' ' + s.unit : ''}` };
    if (s.max != null && n > s.max) return { ok: false, msg: `${s.l}: höchstens ${s.max}${s.unit ? ' ' + s.unit : ''}` };
    return { ok: true, value: n };
  };

  const changed = useMemo(
    () => ALL.filter((s) => s.k in draft).filter((s) => {
      const p = parse(s, draft[s.k]);
      return !p.ok || !sameValue(p.value, original(s));
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, settings],
  );

  const set = (k: string, v: unknown) => { setDraft((d) => ({ ...d, [k]: v })); setErrors([]); };

  const save = async () => {
    const errs: string[] = [];
    const patch: Values = {};
    for (const s of changed) {
      const p = parse(s, draft[s.k]);
      if (!p.ok) errs.push(p.msg!);
      else patch[s.k] = p.value;
    }
    const on = Number(values.pv_surplus_threshold_on);
    const off = Number(values.pv_surplus_threshold_off);
    if (!Number.isNaN(on) && !Number.isNaN(off) && off >= on) errs.push('„Stoppen unter“ muss kleiner sein als „Heizen ab“');
    if (errs.length) { setErrors(errs); return; }
    setBusy(true);
    const ok = await onSave(patch as Partial<HeatingSettings>);
    if (ok) setDraft({});
    setBusy(false);
  };

  const renderField = (s: Spec) => {
    if (s.showIf && !s.showIf(values)) return null;
    const isDefault = db[s.k] == null && !(s.k in draft);
    const invalid = s.k in draft && !parse(s, draft[s.k]).ok;
    if (s.kind === 'switch') {
      return (
        <div key={s.k} className="sm:col-span-2">
          <SwitchRow label={s.l} hint={s.hint} checked={values[s.k] !== false} onChange={(v) => set(s.k, v)} />
        </div>
      );
    }
    if (s.kind === 'select') {
      return (
        <label key={s.k} className="block space-y-1">
          <span className="text-sm">{s.l}</span>
          <Select value={String(values[s.k])} onValueChange={(v) => set(s.k, v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {s.options!.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
            </SelectContent>
          </Select>
          {(s.hint || isDefault) && (
            <span className="block text-[11px] text-muted-foreground">{isDefault && <span className="italic">Standardwert</span>}{s.hint}</span>
          )}
        </label>
      );
    }
    return (
      <LabeledInput
        key={s.k}
        label={s.l}
        unit={s.unit}
        hint={s.hint}
        isDefault={isDefault}
        invalid={invalid}
        type={s.kind === 'time' ? 'time' : 'number'}
        inputMode={s.kind === 'number' ? 'decimal' : undefined}
        step={s.step}
        min={s.min}
        max={s.max}
        value={toInput(s, values[s.k])}
        onChange={(e) => set(s.k, e.target.value)}
      />
    );
  };

  const price = settings.electricity_price_kwh_cent;
  const feed = settings.feed_in_price_kwh_cent;

  return (
    <SectionCard
      id="haus"
      title="Haus"
      icon={<Home className="h-5 w-5 text-primary" />}
      badge={changed.length > 0 ? <span className="ml-1 text-xs font-normal text-warning">{changed.length} ungespeichert</span> : undefined}
      description="Gilt für alle Räume. Gespeichert werden nur die Felder, die du änderst."
    >
      {GROUPS.map((g) => (
        <div key={g.title} className="space-y-2 border-t pt-4 first:border-t-0 first:pt-0">
          <Eyebrow icon={g.icon}>{g.title}</Eyebrow>
          <FieldGrid>{g.fields.map(renderField)}</FieldGrid>
        </div>
      ))}

      <p className="text-xs text-muted-foreground border-t pt-3">
        Strompreise ({price != null ? `${Number(price).toLocaleString('de-DE')} ct` : '–'} Bezug,
        {' '}{feed != null ? `${Number(feed).toLocaleString('de-DE')} ct` : '–'} Einspeisung) pflegst du unten unter
        {' '}<strong>Tarife & Preisverlauf</strong>.
      </p>

      {errors.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm space-y-1">
          {errors.map((e) => <div key={e}>{e}</div>)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={busy || isLoading || changed.length === 0}>
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Haus-Einstellungen speichern
        </Button>
        {changed.length > 0 && (
          <>
            <span className="text-xs text-muted-foreground">{changed.length} {changed.length === 1 ? 'Änderung' : 'Änderungen'}</span>
            <Button variant="ghost" size="sm" onClick={() => { setDraft({}); setErrors([]); }} disabled={busy}>Verwerfen</Button>
          </>
        )}
      </div>
    </SectionCard>
  );
}
