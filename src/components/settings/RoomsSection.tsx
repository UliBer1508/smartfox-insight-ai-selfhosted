// Räume der Heizung Venediger im Aufbau der Heizung München: eine Karte pro Raum,
// Solltemperaturen direkt editierbar, eigener Speichern-Knopf je Raum.
//
// Sicherheitsregeln (Stand 23.10.2026):
// - Gespeichert werden NUR geänderte, editierbare Felder (nie target_temp, current_temp,
//   is_heating, pv_auto_active, berechnete Lernwerte …). Konfliktprüfung im Hook.
// - Löschen nur nach Eingabe des Raumnamens: per Datenbank-Kaskade verschwinden sonst auch
//   Heizprotokolle, Temperaturverlauf, ML-Features und gelernte Regeln des Raums.
// - "Automatik" (automation_enabled) ist der Hauptschalter des Raums: pv-automation lädt nur
//   Räume mit automation_enabled = true. Aus = Raum wird gar nicht gesteuert (auch kein
//   Nacht-/Frostschutz-Befehl). Seit 26.10.2026 hier statt in der alten Thermostat-Karte.
// - Komfort ist das Maximum (07.11.2026, Uli). Den alten Wert „Batterie voll“ (pv_boost_max_temp) gibt es nicht
//   mehr; bei voller Batterie bleiben Räume nur dann auf Komfort, wenn ALLE Räume auf Komfort sind.
// - Seit 14.11.2026 (Uli) nur noch drei Temperaturen je Raum (doc/FIX-DREI-TEMPERATUREN-2026-11-14.md):
//     Min    = wait_min_temp – darf nie unterschritten werden, Tag und Nacht (früher „Untergrenze“ und „Nacht“)
//     Normal = eco_temp      – Ziel tagsüber
//     PV-Max = comfort_temp  – bis hierhin wird mit PV-Überschuss geheizt
//   night_temp wird nicht mehr bearbeitet; die Datenbank hält sie per Trigger gleich Min (SQL 39).
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Room, OrientationType, ORIENTATION_LABELS } from '@/types/room';
import { sameValue } from '@/lib/safeSave';
import { Home, Thermometer, Plus, Loader2, ChevronDown, Save, Trash2, Sun, Leaf, Shield, Battery, Info, Wrench, AlertTriangle } from 'lucide-react';
import { SectionCard, Eyebrow, LabeledInput } from './SettingsBits';

const TEMP_MIN = 5;
const TEMP_MAX = 30;

type Draft = Record<string, unknown>;

const fmt = (t: number | null | undefined) =>
  t == null ? '–' : `${Number(t).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;

// Editierbare Felder je Raum (alles andere wird nie geschrieben)
const NUM_FIELDS: { k: keyof Room; l: string; unit?: string; step?: number; min?: number; max?: number; temp?: boolean }[] = [
  { k: 'wait_min_temp', l: 'Min', unit: '°C', step: 0.5, min: TEMP_MIN, max: TEMP_MAX, temp: true },
  { k: 'eco_temp', l: 'Normal', unit: '°C', step: 0.5, min: TEMP_MIN, max: TEMP_MAX, temp: true },
  { k: 'comfort_temp', l: 'PV-Max', unit: '°C', step: 0.5, min: TEMP_MIN, max: TEMP_MAX, temp: true },
  { k: 'floor_area_m2', l: 'Fläche', unit: 'm²', step: 1, min: 0, max: 500 },
  { k: 'heating_power_w', l: 'Heizleistung', unit: 'W', step: 50, min: 0, max: 20000 },
];
const TEXT_FIELDS: { k: keyof Room; l: string; placeholder?: string }[] = [
  { k: 'thermostat_type', l: 'Thermostat-Typ', placeholder: 'TGP508' },
  { k: 'thermostat_ip', l: 'Thermostat-IP', placeholder: '192.168.188.…' },
  { k: 'tuya_device_id', l: 'Tuya Device ID' },
  { k: 'local_key', l: 'Local Key', placeholder: '16 Zeichen' },
];

function validate(values: Draft): string[] {
  const errs: string[] = [];
  for (const f of NUM_FIELDS) {
    const raw = values[f.k as string];
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      if (f.temp) errs.push(`${f.l}: bitte einen Wert eintragen`);
      continue;
    }
    const n = Number(String(raw).replace(',', '.'));
    if (Number.isNaN(n)) { errs.push(`${f.l}: keine Zahl`); continue; }
    if (f.min != null && n < f.min) errs.push(`${f.l}: mindestens ${f.min} ${f.unit ?? ''}`.trim());
    if (f.max != null && n > f.max) errs.push(`${f.l}: höchstens ${f.max} ${f.unit ?? ''}`.trim());
  }
  const n = (k: string) => Number(String(values[k] ?? '').replace(',', '.'));
  if (n('wait_min_temp') > n('eco_temp')) errs.push('Min darf nicht wärmer sein als Normal');
  if (n('eco_temp') > n('comfort_temp')) errs.push('Normal darf nicht wärmer sein als PV-Max');
  if (!String(values.name ?? '').trim()) errs.push('Name fehlt');
  return errs;
}

function toDb(k: string, v: unknown): unknown {
  const num = NUM_FIELDS.find((f) => f.k === k);
  if (num) {
    const s = String(v ?? '').trim();
    return s === '' ? null : Number(s.replace(',', '.'));
  }
  if (TEXT_FIELDS.some((f) => f.k === k)) {
    const s = String(v ?? '').trim();
    return s === '' ? null : s;
  }
  return v;
}

// ---------------------------------------------------------------- Raumkarte
function RoomCard({ room, onSave, onDelete }: {
  room: Room;
  onSave: (id: string, patch: Partial<Room>, base: Partial<Room>) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>({});
  const base = useRef<Draft>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const r = room as unknown as Draft;

  const value = (k: string) => (k in draft ? draft[k] : r[k]);
  const set = (k: string, v: unknown) => {
    if (!(k in base.current)) base.current[k] = r[k];
    setDraft((d) => ({ ...d, [k]: v }));
    setErrors([]);
  };
  const changedKeys = Object.keys(draft).filter((k) => !sameValue(toDb(k, draft[k]), r[k]));
  const merged: Draft = { ...r, ...draft };

  const save = async () => {
    const errs = validate(merged);
    if (errs.length) { setErrors(errs); return; }
    const patch: Draft = {};
    const b: Draft = {};
    for (const k of changedKeys) { patch[k] = toDb(k, draft[k]); b[k] = base.current[k]; }
    setBusy(true);
    const ok = await onSave(room.id!, patch as Partial<Room>, b as Partial<Room>);
    if (ok) { setDraft({}); base.current = {}; }
    setBusy(false);
  };


  const tempInput = (k: string, label: string) => (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        inputMode="decimal"
        step={0.5}
        min={TEMP_MIN}
        max={TEMP_MAX}
        aria-label={`${label} ${room.name}`}
        value={value(k) == null ? '' : String(value(k))}
        onChange={(e) => set(k, e.target.value)}
        className={`text-base font-semibold ${errors.length > 0 && String(value(k) ?? '').trim() === '' ? 'border-destructive' : ''}`}
      />
      <span className="text-xs text-muted-foreground">°C</span>
    </div>
  );

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-lg font-semibold truncate">{room.name}</div>
          <div className="text-xs text-muted-foreground">
            Jetzt {fmt(room.current_temp)} · Soll {fmt(room.target_temp)}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" title="Heiz-Priorität (ändern unter „Heiz-Reihenfolge“)">P{room.priority}</Badge>
          {room.automation_enabled !== true && <Badge variant="outline" className="text-warning border-warning/50">Automatik aus</Badge>}
          {room.pv_auto_enabled && <Badge className="bg-energy-export/15 text-energy-export border-energy-export/30 hover:bg-energy-export/15">PV-Auto</Badge>}
        </div>
      </div>

      <div className="space-y-2">
        <Eyebrow>Temperaturen</Eyebrow>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-indigo-500" title="Darf nie unterschritten werden – Tag und Nacht"><Shield className="w-3.5 h-3.5" />Min</div>
            {tempInput('wait_min_temp', 'Min')}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-success" title="Ziel tagsüber (in Planer und Auswertungen „Eco“)"><Leaf className="w-3.5 h-3.5" />Normal</div>
            {tempInput('eco_temp', 'Normal')}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-energy-export" title="Bis hierhin mit PV-Überschuss (in Planer und Auswertungen „Komfort“)"><Sun className="w-3.5 h-3.5" />PV-Max</div>
            {tempInput('comfort_temp', 'PV-Max')}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          <b>Min</b> darf nie unterschritten werden, auch nachts. <b>Normal</b> ist das Ziel tagsüber.
          <b> PV-Max</b>: bis hierhin wird mit Sonnen-Überschuss geheizt (Estrich als Speicher).
        </p>
      </div>

      <div className="rounded-lg border divide-y">
        <div className="flex items-center justify-between gap-3 p-3">
          <div>
            <div className="text-sm font-medium">Automatik</div>
            <div className="text-xs text-muted-foreground">Raum wird von der Heizungsautomatik gesteuert (Min, Normal, PV-Max)</div>
          </div>
          <Switch
            checked={value('automation_enabled') === true}
            onCheckedChange={(v) => set('automation_enabled', v)}
            aria-label={`Automatik ${room.name}`}
          />
        </div>
        <div className="flex items-center justify-between gap-3 p-3">
          <div>
            <div className="text-sm font-medium">PV-Überschuss-Automatik</div>
            <div className="text-xs text-muted-foreground">Hinweis (27.10.2026): wird von der Heizungsautomatik derzeit nicht ausgewertet – Überschuss-Heizen gilt für alle Räume mit Automatik</div>
          </div>
          <Switch
            checked={value('pv_auto_enabled') === true}
            onCheckedChange={(v) => set('pv_auto_enabled', v)}
            aria-label={`PV-Überschuss-Automatik ${room.name}`}
          />
        </div>
        {value('automation_enabled') !== true && (
          <div className="flex items-start gap-2 p-3 text-xs text-warning">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Automatik aus: Dieser Raum bekommt keine Befehle mehr – auch nicht, um Min zu halten. Das Thermostat behält seinen letzten Sollwert.</span>
          </div>
        )}
      </div>

      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Battery className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
        <span>Mit Sonnen-Überschuss heizt dieser Raum höchstens bis PV-Max. Darüber nur, wenn alle Räume auf PV-Max sind und die Batterie voll ist.</span>
      </div>

      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground w-full group">
          <Wrench className="w-4 h-4" />
          Technik & Lernwerte
          <ChevronDown className="w-4 h-4 ml-auto transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <LabeledInput label="Name" value={String(value('name') ?? '')} onChange={(e) => set('name', e.target.value)} />
            <label className="block space-y-1">
              <span className="text-sm">Ausrichtung</span>
              <Select
                value={(value('orientation') as string) || 'none'}
                onValueChange={(v) => set('orientation', v === 'none' ? null : v as OrientationType)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Keine Angabe</SelectItem>
                  {Object.entries(ORIENTATION_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            {NUM_FIELDS.filter((f) => !f.temp).map((f) => (
              <LabeledInput
                key={f.k as string}
                label={f.l}
                unit={f.unit}
                type="number"
                inputMode="decimal"
                step={f.step}
                min={f.min}
                max={f.max}
                value={value(f.k as string) == null ? '' : String(value(f.k as string))}
                onChange={(e) => set(f.k as string, e.target.value)}
              />
            ))}
            {TEXT_FIELDS.map((f) => (
              <LabeledInput
                key={f.k as string}
                label={f.l}
                placeholder={f.placeholder}
                className="tabular-nums"
                value={String(value(f.k as string) ?? '')}
                onChange={(e) => set(f.k as string, e.target.value)}
              />
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="text-sm">Direkte Sonneneinstrahlung</div>
            <Switch checked={value('has_solar_gain') === true} onCheckedChange={(v) => set('has_solar_gain', v)} />
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <div className="font-medium text-foreground flex items-center gap-1"><Info className="w-3.5 h-3.5" />Gelernt (nur Anzeige)</div>
            {/* 12.11.2026: alte Schätzungen (calculated_power_w, Solar-Analyse) ersetzt – Leistung wird gemessen
                (measure-room-power), Auskühlen/Aufheizen/Sonne lernt das Heizmodell des Planers. */}
            <div>Heizleistung gemessen: {room.heating_power_w ? `${room.heating_power_w} W` : '–'}</div>
            <div>Auskühlen, Aufheizen und Sonne lernt das Heizmodell: <strong>Auto-Steuerung › Plan</strong> (Modell je Raum).</div>
            <div>Priorität: P{room.priority} – ändern im Abschnitt <strong>Heiz-Reihenfolge</strong> unten.</div>
          </div>

          <AlertDialog onOpenChange={(o) => !o && setConfirmName('')}>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive border-destructive/40 hover:bg-destructive/10">
                <Trash2 className="w-4 h-4 mr-1.5" />Raum löschen …
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>„{room.name}“ endgültig löschen?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm">
                    <p>Mit dem Raum werden auch <strong>alle seine Daten</strong> gelöscht: Heizprotokolle,
                      Temperaturverlauf, ML-Features, gelernte Regeln, Empfehlungen und offene Befehle.
                      Das lässt sich nicht rückgängig machen (nur über die nächtliche Datensicherung).</p>
                    <p>Zum Bestätigen den Raumnamen eintippen:</p>
                    <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={room.name} />
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction
                  disabled={confirmName.trim() !== room.name.trim()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => room.id && onDelete(room.id)}
                >
                  Endgültig löschen
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CollapsibleContent>
      </Collapsible>

      {errors.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm space-y-0.5">
          {errors.map((e) => <div key={e}>{e}</div>)}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={save} disabled={busy || changedKeys.length === 0}>
          {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
          {room.name} speichern
        </Button>
        {changedKeys.length > 0 && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setDraft({}); base.current = {}; setErrors([]); }}>
            Verwerfen
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Neuer Raum
function NewRoomDialog({ rooms, open, onOpenChange, onCreate }: {
  rooms: Room[]; open: boolean; onOpenChange: (o: boolean) => void;
  onCreate: (room: Partial<Room>) => Promise<boolean>;
}) {
  const used = new Set(rooms.map((r) => r.priority));
  const free = Array.from({ length: 12 }, (_, i) => i + 1).filter((p) => !used.has(p));
  const [d, setD] = useState<Draft>({ name: '', wait_min_temp: 20, eco_temp: 21, comfort_temp: 23, thermostat_type: 'TGP508' });
  const [errs, setErrs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => { setD((x) => ({ ...x, [k]: v })); setErrs([]); };

  const create = async () => {
    const e = validate(d);
    if (!free.length) e.push('Alle Prioritäten 1–12 sind vergeben – es ist kein weiterer Raum möglich.');
    if (e.length) { setErrs(e); return; }
    const room: Draft = {
      name: String(d.name).trim(), thermostat_type: toDb('thermostat_type', d.thermostat_type) ?? 'TGP508',
      // Automatik an: ohne sie würde ein neuer Raum nie gesteuert (DB-Standard ist false).
      priority: Number(d.priority ?? free[0]), has_solar_gain: false, pv_auto_enabled: false, automation_enabled: true,
    };
    for (const k of ['wait_min_temp', 'eco_temp', 'comfort_temp', 'floor_area_m2', 'heating_power_w', 'thermostat_ip', 'tuya_device_id', 'local_key']) {
      room[k] = toDb(k, d[k]);
    }
    setBusy(true);
    const ok = await onCreate(room as Partial<Room>);
    setBusy(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Neuer Raum</DialogTitle></DialogHeader>
        {free.length === 0 ? (
          <p className="text-sm text-muted-foreground">Alle 12 Prioritäten sind vergeben. Ein weiterer Raum ist erst möglich, wenn einer entfernt wird.</p>
        ) : (
          <div className="space-y-3">
            <LabeledInput label="Name" value={String(d.name ?? '')} onChange={(e) => set('name', e.target.value)} placeholder="z. B. Gästezimmer" />
            <label className="block space-y-1">
              <span className="text-sm">Priorität (frei)</span>
              <Select value={String(d.priority ?? free[0])} onValueChange={(v) => set('priority', Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{free.map((p) => <SelectItem key={p} value={String(p)}>P{p}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['wait_min_temp', 'eco_temp', 'comfort_temp'] as const).map((k, i) => (
                <LabeledInput key={k} label={['Min', 'Normal', 'PV-Max'][i]} unit="°C" type="number" step={0.5}
                  value={String(d[k] ?? '')} onChange={(e) => set(k, e.target.value)} />
              ))}
            </div>
            {TEXT_FIELDS.slice(1).map((f) => (
              <LabeledInput key={f.k as string} label={f.l} placeholder={f.placeholder} className="tabular-nums"
                value={String(d[f.k as string] ?? '')} onChange={(e) => set(f.k as string, e.target.value)} />
            ))}
            {errs.length > 0 && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">{errs.map((e) => <div key={e}>{e}</div>)}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
              <Button onClick={create} disabled={busy}>{busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}Anlegen</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Abschnitt
export function RoomsSection({ rooms, isLoading, onSave, onCreate, onDelete, onReload }: {
  rooms: Room[];
  isLoading: boolean;
  onSave: (id: string, patch: Partial<Room>, base: Partial<Room>) => Promise<boolean>;
  onCreate: (room: Partial<Room>) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
  onReload: () => void;
}) {
  const [newOpen, setNewOpen] = useState(false);

  return (
    <SectionCard
      id="raeume"
      title="Räume & Thermostate"
      icon={<Thermometer className="w-5 h-5 text-primary" />}
      description="Jede Karte speichert nur ihre eigenen Änderungen. Sollwert, Ist-Temperatur und Heizstatus setzt weiterhin die Automatik."
      right={
        <div className="flex gap-2 shrink-0">
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Raum hinzufügen</span>
          </Button>
        </div>
      }
    >
      <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground grid sm:grid-cols-3 gap-2">
        <div className="flex gap-1.5"><Shield className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" /><span><strong className="text-foreground">Min:</strong> nie darunter – Tag und Nacht</span></div>
        <div className="flex gap-1.5"><Leaf className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" /><span><strong className="text-foreground">Normal:</strong> Ziel tagsüber, ohne Sonne auch aus dem Netz</span></div>
        <div className="flex gap-1.5"><Sun className="w-3.5 h-3.5 text-energy-export shrink-0 mt-0.5" /><span><strong className="text-foreground">PV-Max:</strong> nur mit Sonnen-Überschuss, der Estrich speichert</span></div>
      </div>

      {isLoading && rooms.length === 0 ? (
        <div className="text-sm text-muted-foreground">Lade Räume …</div>
      ) : rooms.length === 0 ? (
        <div className="text-sm text-muted-foreground">Noch keine Räume angelegt.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 items-start">
          {rooms.map((r) => <RoomCard key={r.id} room={r} onSave={onSave} onDelete={onDelete} />)}
        </div>
      )}

      {newOpen && <NewRoomDialog rooms={rooms} open={newOpen} onOpenChange={setNewOpen} onCreate={onCreate} />}
    </SectionCard>
  );
}
