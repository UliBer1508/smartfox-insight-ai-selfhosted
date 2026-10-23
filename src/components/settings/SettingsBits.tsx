// Kleine Bausteine für die Einstellungsseite im Aufbau der "Heizung München":
// Abschnitts-Karte, Gruppen-Überschrift, beschriftete Felder mit Einheit.
import { ReactNode, useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

/**
 * Ausklappbarer Abschnitt (wie die frühere Accordion-Ansicht). Der Auf/Zu-Zustand wird pro
 * Abschnitt im Browser gemerkt (localStorage, rein kosmetisch – fehlt er, gilt defaultOpen).
 */
export function SectionCard({ id, title, icon, description, right, badge, defaultOpen = false, children }: {
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
    <Collapsible open={open} onOpenChange={toggle} className="rounded-lg border bg-card overflow-hidden">
      <div className={`flex items-center gap-2 px-4 py-3 bg-muted/50 ${open ? 'border-b' : ''}`}>
        <CollapsibleTrigger className="flex items-center gap-2 flex-1 min-w-0 text-left group">
          {icon}
          <span className="font-semibold">{title}</span>
          {badge}
          <ChevronDown className="w-4 h-4 ml-auto shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        {open && right}
      </div>
      {/* forceMount: Eingaben bleiben beim Zuklappen erhalten */}
      <CollapsibleContent forceMount className="data-[state=closed]:hidden">
        <div className="p-4 sm:p-5 space-y-4">
          {description && <p className="text-xs text-muted-foreground -mt-1">{description}</p>}
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
