// Räume der Heizung Venediger im Aufbau der Heizung München: eine Karte pro Raum,
// Solltemperaturen direkt editierbar, eigener Speichern-Knopf je Raum.
//
// Sicherheitsregeln (Stand 23.10.2026):
// - Gespeichert werden NUR geänderte, editierbare Felder (nie target_temp, current_temp,
//   is_heating, pv_auto_active, berechnete Lernwerte …). Konfliktprüfung im Hook.
// - Löschen nur nach Eingabe des Raumnamens: per Datenbank-Kaskade verschwinden sonst auch
//   Heizprotokolle, Temperaturverlauf, ML-Features und gelernte Regeln des Raums.
// - "Batterie voll" (pv_boost_max_temp) ist KEIN Sollwert, sondern die Grenze für den
//   Battery-Full-Override – daher nur als Info (siehe doc/memory/comfort-saturation-estrich-storage.md).
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
import { useSolarGainAnalysis } from '@/hooks/useSolarGainAnalysis';
import { Home, Plus, BarChart3, Loader2, ChevronDown, Save, Trash2, Sun, Leaf, Moon, Battery, Info, Wrench } from 'lucide-react';
import { SectionCard, Eyebrow, LabeledInput } from './SettingsBits';

const TEMP_MIN = 5;
const TEMP_MAX = 30;

type Draft = Record<string, unknown>;

const fmt = (t: number | null | undefined) =>
  t == null ? '–' : `${Number(t).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;

// Editierbare Felder je Raum (alles andere wird nie geschrieben)
const NUM_FIELDS: { k: keyof Room; l: string; unit?: string; step?: number; min?: number; max?: number; temp?: boolean }[] = [
  { k: 'night_temp', l: 'Nacht', unit: '°C', step: 0.5, min: TEMP_MIN, max: TEMP_MAX, temp: true },
  { k: 'eco_temp', l: 'Eco', unit: '°C', step: 0.5, min: TEMP_MIN, max: TEMP_MAX, temp: true },
  { k: 'comfort_temp', l: 'Komfort', unit: '°C', step: 0.5, min: TEMP_MIN, max: TEMP_MAX, temp: true },
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
  if (n('night_temp') > n('eco_temp')) errs.push('Nacht darf nicht wärmer sein als Eco');
  if (n('eco_temp') > n('comfort_temp')) errs.push('Eco darf nicht wärmer sein als Komfort');
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

  // "Batterie voll"-Grenze (nur Info): pv_boost_max_temp, sonst Komfort + 1,5 °C (wie pv-automation)
  const comfort = Number(room.comfort_temp ?? 21);
  const capRaw = room.pv_boost_max_temp != null && Number(room.pv_boost_max_temp) > 0 ? Number(room.pv_boost_max_temp) : null;
  const cap = capRaw ?? comfort + 1.5;
  const capActive = cap - 0.2 > comfort;

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
          <Badge variant="outline" title="Heiz-Priorität (änderst du im Tab Heizung & KI)">P{room.priority}</Badge>
          {room.pv_auto_enabled && <Badge className="bg-energy-export/15 text-energy-export border-energy-export/30 hover:bg-energy-export/15">PV-Auto</Badge>}
        </div>
      </div>

      <div className="space-y-2">
        <Eyebrow>Solltemperatur je Modus</Eyebrow>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-indigo-500"><Moon className="w-3.5 h-3.5" />Nacht</div>
            {tempInput('night_temp', 'Nacht')}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-success"><Leaf className="w-3.5 h-3.5" />Eco</div>
            {tempInput('eco_temp', 'Eco')}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-energy-export"><Sun className="w-3.5 h-3.5" />Komfort</div>
            {tempInput('comfort_temp', 'Komfort')}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <div>
          <div className="text-sm font-medium">PV-Überschuss-Automatik</div>
          <div className="text-xs text-muted-foreground">Raum heizt mit Überschuss auf Eco/Komfort</div>
        </div>
        <Switch checked={value('pv_auto_enabled') === true} onCheckedChange={(v) => set('pv_auto_enabled', v)} />
      </div>

      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Battery className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
        {capActive
          ? <span>Bei voller Batterie: Komfort halten bis {fmt(cap)}{capRaw == null && ' (automatisch: Komfort + 1,5 °C)'}</span>
          : <span className="text-warning">Bei voller Batterie: inaktiv – Grenze {fmt(cap)} liegt nicht über Komfort</span>}
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
                className="font-mono"
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
            <div>
              Heizleistung berechnet: {room.calculated_power_w ? `${room.calculated_power_w} W` : '–'}
              {room.power_calculation_confidence != null && ` (${Math.round(room.power_calculation_confidence * 100)} % sicher, ${room.power_samples ?? 0} Zyklen)`}
            </div>
            <div>
              Solargewinn: {room.calculated_solar_gain_factor != null ? `${(room.calculated_solar_gain_factor * 5).toFixed(1)} °C/h bei 5 kW PV` : '–'}
              {room.solar_gain_confidence != null && ` (${Math.round(room.solar_gain_confidence * 100)} % sicher)`}
            </div>
            <div>Priorität: P{room.priority} – ändern im Tab <strong>Heizung & KI</strong> (Raumpriorität).</div>
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
  const [d, setD] = useState<Draft>({ name: '', night_temp: 18, eco_temp: 19, comfort_temp: 21, thermostat_type: 'TGP508' });
  const [errs, setErrs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => { setD((x) => ({ ...x, [k]: v })); setErrs([]); };

  const create = async () => {
    const e = validate(d);
    if (!free.length) e.push('Alle Prioritäten 1–12 sind vergeben – es ist kein weiterer Raum möglich.');
    if (e.length) { setErrs(e); return; }
    const room: Draft = {
      name: String(d.name).trim(), thermostat_type: toDb('thermostat_type', d.thermostat_type) ?? 'TGP508',
      priority: Number(d.priority ?? free[0]), has_solar_gain: false, pv_auto_enabled: false,
    };
    for (const k of ['night_temp', 'eco_temp', 'comfort_temp', 'floor_area_m2', 'heating_power_w', 'thermostat_ip', 'tuya_device_id', 'local_key']) {
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
            <div className="grid grid-cols-3 gap-2">
              {(['night_temp', 'eco_temp', 'comfort_temp'] as const).map((k, i) => (
                <LabeledInput key={k} label={['Nacht', 'Eco', 'Komfort'][i]} unit="°C" type="number" step={0.5}
                  value={String(d[k] ?? '')} onChange={(e) => set(k, e.target.value)} />
              ))}
            </div>
            {TEXT_FIELDS.slice(1).map((f) => (
              <LabeledInput key={f.k as string} label={f.l} placeholder={f.placeholder} className="font-mono"
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
  const { isAnalyzing, runAnalysis } = useSolarGainAnalysis();

  return (
    <SectionCard
      title="Räume"
      icon={<Home className="w-5 h-5 text-primary" />}
      description="Jede Karte speichert nur ihre eigenen Änderungen. Sollwert, Ist-Temperatur und Heizstatus setzt weiterhin die Automatik."
      right={
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={async () => { await runAnalysis(); onReload(); }} disabled={isAnalyzing || rooms.length === 0}>
            {isAnalyzing ? <Loader2 className="h-4 w-4 sm:mr-1 animate-spin" /> : <BarChart3 className="h-4 w-4 sm:mr-1" />}
            <span className="hidden sm:inline">Solar-Analyse</span>
          </Button>
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Raum hinzufügen</span>
          </Button>
        </div>
      }
    >
      <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground grid sm:grid-cols-3 gap-2">
        <div className="flex gap-1.5"><Moon className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" /><span><strong className="text-foreground">Nacht:</strong> nur im Modus „Nacht-Temperatur halten“, sonst Frostschutz 5 °C</span></div>
        <div className="flex gap-1.5"><Leaf className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" /><span><strong className="text-foreground">Eco:</strong> tagsüber, sobald Überschuss das Budget erlaubt</span></div>
        <div className="flex gap-1.5"><Sun className="w-3.5 h-3.5 text-energy-export shrink-0 mt-0.5" /><span><strong className="text-foreground">Komfort:</strong> nur aus echter Einspeisung, danach speichert der Estrich</span></div>
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
