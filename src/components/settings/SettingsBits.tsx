// Kleine Bausteine für die Einstellungsseite im Aufbau der "Heizung München":
// Abschnitts-Karte, Gruppen-Überschrift, beschriftete Felder mit Einheit.
import { ReactNode, useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

/**
 * Ausklappbarer Abschnitt der Einstellungen. Der Auf/Zu-Zustand wird pro Abschnitt im Browser
 * gemerkt (localStorage, rein kosmetisch – fehlt er, gilt defaultOpen).
 *
 * Darstellung wie Heizung München (13.11.2026, Uli: „ich bevorzuge die Münchner Darstellung“,
 * dort Klapp.jsx / .collapse-head): eine Karte ohne abgesetzte Kopfleiste, Titel groß,
 * Beschreibung grau daneben, Kurzinfo (badge) rechts, Pfeil ▶ ganz rechts (dreht beim Öffnen).
 * Kein Symbol vor dem Titel – `icon` wird aus Kompatibilität noch angenommen, aber nicht gezeigt.
 */
export function SectionCard({ id, title, description, right, badge, defaultOpen = false, children }: {
  id: string; title: string; icon?: ReactNode; description?: string; right?: ReactNode; badge?: ReactNode;
  defaultOpen?: boolean; children: ReactNode;
}) {
  const key = `settings-open-${id}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(key);
      return v == null ? defaultOpen : v === '1';
    } catch { return defaultOpen; }
  });
  const toggle = (o: boolean) => {
    setOpen(o);
    try { localStorage.setItem(key, o ? '1' : '0'); } catch { /* egal */ }
  };
  return (
    <Collapsible open={open} onOpenChange={toggle} className="rounded-xl border bg-card px-4 py-4 sm:px-[18px] sm:py-[18px]">
      <div className="flex items-start gap-3">
        <CollapsibleTrigger className="flex items-center gap-3 flex-1 min-w-0 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="min-w-0">
            <span className="text-base sm:text-lg font-semibold">{title}</span>
            {description && (
              <span className="block sm:inline text-[13px] font-normal text-muted-foreground mt-0.5 sm:mt-0 sm:ml-1.5">{description}</span>
            )}
          </span>
          {badge && (
            <span className="ml-auto shrink-0 flex items-center text-[13px] font-normal text-muted-foreground [&>*]:ml-0">{badge}</span>
          )}
          <span className={`${badge ? '' : 'ml-auto'} shrink-0 text-[13px] text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">▶</span>
        </CollapsibleTrigger>
        {open && right}
      </div>
      {/* forceMount: Eingaben bleiben beim Zuklappen erhalten */}
      <CollapsibleContent forceMount className="data-[state=closed]:hidden">
        <div className="pt-3 space-y-4">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function Eyebrow({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
      {icon}{children}
    </div>
  );
}

export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">{children}</div>;
}

export function LabeledInput({ label, unit, hint, isDefault, invalid, ...inputProps }: {
  label: string; unit?: string; hint?: string; isDefault?: boolean; invalid?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1">
      <span className="text-sm">{label}</span>
      <span className="flex items-center gap-2">
        <Input {...inputProps} className={`${invalid ? 'border-destructive focus-visible:ring-destructive' : ''}`} />
        {unit && <span className="text-xs text-muted-foreground whitespace-nowrap min-w-[2.5rem]">{unit}</span>}
      </span>
      {(hint || isDefault) && (
        <span className="block text-[11px] text-muted-foreground">
          {isDefault && <span className="italic">Standardwert{hint ? ' · ' : ''}</span>}
          {hint}
        </span>
      )}
    </label>
  );
}

export function SwitchRow({ label, hint, checked, onChange, disabled }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
