// Tab "KI" – prüfen und entscheiden (Stand 06.11.2026: Abschnitt 2 „Planer“, Schattenbetrieb; 12.11.2026 bereinigt).
// Alle KI-Bausteine an einem Ort; vorher verteilt auf Energie, Heizung & KI und Verlauf & Muster.
// 04.11.2026: „Zu entscheiden“ zeigt alle Vorschläge an einem Platz in einfachen Worten (ZuEntscheiden.tsx).
// Die frühere Parameter-Liste (stündliche Gemini-Vorschläge) steht nur noch als Protokoll unter 3.
// Einstellungen der KI (Autopilot an/aus, Modus je Parameter, Mustergedächtnis, Zeitplan) stehen
// unter Einstellungen › KI.
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Room } from '@/types/room';
import { EnergyReading } from '@/types/energy';
import { useKiPending } from '@/hooks/useKiPending';
import { AIStatusWidget } from '@/components/heating/AIStatusWidget';
import { AIShadowDecisions } from '@/components/heating/AIShadowDecisions';
import { LearningProgress } from '@/components/heating/LearningProgress';
import { AutomationStatusCard } from '@/components/heating/AutomationStatusCards';
import { ZuEntscheiden } from './ZuEntscheiden';
import { PriceSuggestionBanner } from '@/components/energy/PriceSuggestionBanner';
import { KiAnalysisRuns } from './KiAnalysisRuns';
import { PlanerView } from './PlanerView';

function Section({ n, title, question, children, right }: { n: number; title: string; question: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-violet-600 text-white flex items-center justify-center font-bold shrink-0" aria-hidden="true">{n}</div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-tight">{title}</h2>
          <div className="text-sm text-muted-foreground">{question}</div>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function KiTab({ rooms, currentReading, readings, pattern, onNavigate }: {
  rooms: Room[];
  currentReading: EnergyReading | null;
  readings: EnergyReading[];
  pattern: {
    analysis: string | null;
    isAnalyzing: boolean;
    analyzeDailyPattern: (r: EnergyReading[]) => void;
    analyzeWeeklyComparison: () => void;
  };
  onNavigate: (tab: 'settings') => void;
}) {
  const pending = useKiPending();

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="md:col-span-1">
          <CardContent className="p-4 space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">KI-Autopilot</div>
            <div className={`text-xl font-bold ${pending.autopilotOn ? 'text-success' : 'text-muted-foreground'}`}>
              {pending.autopilotOn == null ? '–' : pending.autopilotOn ? 'Aktiv' : 'Pausiert'}
            </div>
            <div className="text-xs text-muted-foreground">
              Die KI schlägt nur vor – geändert wird erst, wenn du Ja sagst. {pending.total > 0 ? `${pending.total} ${pending.total === 1 ? 'Vorschlag wartet' : 'Vorschläge warten'} auf dich.` : 'Nichts offen.'}
            </div>
            <Button size="sm" variant="outline" onClick={() => onNavigate('settings')}>KI-Einstellungen</Button>
          </CardContent>
        </Card>
        <div className="md:col-span-2">
          <AIStatusWidget rooms={rooms} pvPower={currentReading?.pv_power ?? null} soc={currentReading?.battery_soc ?? null} />
        </div>
      </div>

      <Section n={1} title="Zu entscheiden" question="Was schlägt die KI vor? Ja, anderer Wert oder Nein.">
        <ZuEntscheiden />
        <PriceSuggestionBanner />
      </Section>

      <Section n={2} title="Planer" question="Was würde der rechnende Planer tun – und wäre es besser? (Schattenbetrieb, steuert noch nicht)">
        <PlanerView />
      </Section>

      {/* 12.11.2026: „KI-Tagesplan“ (ai-daily-planner) und „ML-Folgerate“ (gelernte Policies) entfernt – beides ersetzt
          durch den Planer (Abschnitt 2). doc/BEREINIGUNG-DOPPELTE-TEILE-2026-11-12.md */}
      <Section n={3} title="Heute" question="Was macht die Automatik gerade?">
        <AutomationStatusCard />
      </Section>

      <Section n={4} title="Lernen & Qualität" question="Welche Daten hat die KI gesammelt?">
        <LearningProgress />
        <details className="rounded-lg border bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold select-none">Frühere Parameter-Vorschläge (Protokoll bis 04.11.2026)</summary>
          <div className="mt-3"><AIShadowDecisions /></div>
        </details>
      </Section>

      <Section n={5} title="Auswertungen" question="Musteranalyse für Tag, Woche, Monat – auf Knopfdruck.">
        <Card>
          <CardContent className="p-4">
            <KiAnalysisRuns readings={readings} analysis={pattern.analysis} isAnalyzing={pattern.isAnalyzing}
              onAnalyzeDaily={pattern.analyzeDailyPattern} onAnalyzeWeekly={pattern.analyzeWeeklyComparison} />
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
