// Tab "KI" – prüfen und entscheiden (Stand 26.10.2026).
// Alle KI-Bausteine an einem Ort; vorher verteilt auf Energie, Heizung & KI und Verlauf & Muster.
// Einstellungen der KI (Autopilot an/aus, Modus je Parameter, Mustergedächtnis, Zeitplan) stehen
// unter Einstellungen › KI.
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Room } from '@/types/room';
import { EnergyReading } from '@/types/energy';
import { useKiPending } from '@/hooks/useKiPending';
import { AIStatusWidget } from '@/components/heating/AIStatusWidget';
import { AIShadowDecisions } from '@/components/heating/AIShadowDecisions';
import { AIDailyPlanCard } from '@/components/heating/AIDailyPlanCard';
import { LearningProgress } from '@/components/heating/LearningProgress';
import { MLFollowRateWidget } from '@/components/heating/MLFollowRateWidget';
import { AutomationStatusCard, BatterySocSuggestionCard } from '@/components/heating/AutomationStatusCards';
import { PriceSuggestionBanner } from '@/components/energy/PriceSuggestionBanner';
import { KiAnalysisRuns } from './KiAnalysisRuns';

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
              Wendet Parameter im Modus „Auto“ selbst an. {pending.total > 0 ? `${pending.total} Vorschläge warten auf dich.` : 'Nichts offen.'}
            </div>
            <Button size="sm" variant="outline" onClick={() => onNavigate('settings')}>Autopilot &amp; Modus je Parameter</Button>
          </CardContent>
        </Card>
        <div className="md:col-span-2">
          <AIStatusWidget rooms={rooms} pvPower={currentReading?.pv_power ?? null} soc={currentReading?.battery_soc ?? null} />
        </div>
      </div>

      <Section n={1} title="Zu entscheiden" question="Was schlägt die KI vor? Übernehmen oder ablehnen.">
        <BatterySocSuggestionCard />
        <PriceSuggestionBanner />
        <AIShadowDecisions />
        <AutomationStatusCard />
      </Section>

      <Section n={2} title="Heute" question="Was plant die KI für heute – und warum?">
        <AIDailyPlanCard />
      </Section>

      <Section n={3} title="Lernen & Qualität" question="Lernt die KI richtig? Folgt die Automatik ihren Empfehlungen?">
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2"><LearningProgress /></div>
          <MLFollowRateWidget />
        </div>
      </Section>

      <Section n={4} title="Auswertungen" question="Musteranalyse für Tag, Woche, Monat – auf Knopfdruck.">
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
