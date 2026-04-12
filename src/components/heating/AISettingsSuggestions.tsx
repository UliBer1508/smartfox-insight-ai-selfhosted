import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Brain, Loader2, Check, ArrowRight, Sparkles } from 'lucide-react';
import { useSettingsSuggestions, SettingSuggestion } from '@/hooks/useSettingsSuggestions';

const categoryLabels: Record<string, string> = {
  hotwater: 'Warmwasser',
  night_cycling: 'Nacht-Zyklen',
  global_temps: 'Temperaturen',
  pv_thresholds: 'PV-Schwellen',
  room_temp: 'Raum-Temp',
  battery: 'Batterie',
  automation: 'Automation',
};

const priorityColors: Record<string, string> = {
  high: 'bg-destructive/10 text-destructive border-destructive/20',
  medium: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  low: 'bg-muted text-muted-foreground border-border',
};

function SuggestionCard({ suggestion, onApply }: { suggestion: SettingSuggestion; onApply: () => void }) {
  return (
    <div className={`rounded-lg border p-3 space-y-2 ${suggestion.applied ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">
            {categoryLabels[suggestion.category] || suggestion.category}
          </Badge>
          <Badge variant="outline" className={`text-xs ${priorityColors[suggestion.priority]}`}>
            {suggestion.priority === 'high' ? 'Hoch' : suggestion.priority === 'medium' ? 'Mittel' : 'Niedrig'}
          </Badge>
          {suggestion.room_name && (
            <span className="text-xs text-muted-foreground">{suggestion.room_name}</span>
          )}
        </div>
        <Button
          size="sm"
          variant={suggestion.applied ? 'ghost' : 'default'}
          onClick={onApply}
          disabled={suggestion.applied}
          className="shrink-0"
        >
          {suggestion.applied ? (
            <><Check className="h-3 w-3 mr-1" /> Übernommen</>
          ) : (
            'Übernehmen'
          )}
        </Button>
      </div>
      
      <div className="flex items-center gap-2 text-sm font-mono">
        <span className="text-muted-foreground">{suggestion.setting_key}:</span>
        <span className="text-destructive">{suggestion.current_value}</span>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <span className="text-primary font-semibold">{suggestion.suggested_value}</span>
      </div>
      
      <p className="text-xs text-muted-foreground leading-relaxed">{suggestion.reason}</p>
    </div>
  );
}

export function AISettingsSuggestions() {
  const { suggestions, overallAnalysis, isLoading, fetchSuggestions, applySuggestion, applyAll } = useSettingsSuggestions();

  const unappliedCount = suggestions.filter(s => !s.applied).length;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="w-5 h-5 text-primary shrink-0" />
              KI-Einstellungsvorschläge
            </CardTitle>
            <CardDescription className="mt-1">
              Analysiert deine Daten und schlägt optimale Einstellungen vor
            </CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {suggestions.length > 0 && unappliedCount > 0 && (
            <Button size="sm" variant="outline" onClick={applyAll}>
              <Sparkles className="h-4 w-4 mr-1" />
              Alle ({unappliedCount})
            </Button>
          )}
          <Button size="sm" onClick={fetchSuggestions} disabled={isLoading} className="w-full sm:w-auto">
            {isLoading ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Brain className="h-4 w-4 mr-1" />
            )}
            {suggestions.length > 0 ? 'Neu laden' : 'Analysieren'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {overallAnalysis && (
          <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3 leading-relaxed">
            {overallAnalysis}
          </p>
        )}
        
        {suggestions.length > 0 ? (
          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <SuggestionCard key={i} suggestion={s} onApply={() => applySuggestion(s)} />
            ))}
          </div>
        ) : !isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Klicke auf "Analysieren" um KI-Vorschläge zu erhalten
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
