// Kleine Bausteine für die Einstellungsseite im Aufbau der "Heizung München":
// Abschnitts-Karte, Gruppen-Überschrift, beschriftete Felder mit Einheit.
import { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

export function SectionCard({ title, icon, description, right, children }: {
  title: string; icon?: ReactNode; description?: string; right?: ReactNode; children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold flex items-center gap-2">{icon}{title}</h2>
            {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
          </div>
          {right}
        </div>
        {children}
      </CardContent>
    </Card>
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
