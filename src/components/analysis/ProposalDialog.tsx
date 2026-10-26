// Bestätigungsdialog für einen Einstellungs-Vorschlag aus der Analyse (Stand 26.10.2026).
// Zeigt aktuell → neu und die Begründung; angewendet wird erst nach "Übernehmen".
import { useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Proposal } from '@/lib/analysisFindings';
import { applyAndLogProposal } from '@/lib/aiParameters';

const show = (v: unknown, unit: string) => {
  if (v === 'maintain') return 'Nacht-Temperatur halten';
  if (v === 'frost_only') return 'Nur Frostschutz (5 °C)';
  return `${String(v ?? '–')}${unit ? ` ${unit}` : ''}`;
};

export function ProposalDialog({ proposal, open, onOpenChange, onApplied }: {
  proposal: Proposal | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onApplied: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!proposal) return null;

  const apply = async () => {
    setBusy(true);
    const res = await applyAndLogProposal({
      wl: proposal.wl,
      roomId: proposal.roomId,
      current: proposal.current,
      proposed: proposal.proposed,
      reasoning: proposal.reasoning,
      source: 'Analyse',
      evidence: proposal.evidence,
    });
    setBusy(false);
    if (res.ok === false) {
      toast.error(`Nicht übernommen: ${res.error}`, { duration: 10000 });
      return;
    }
    toast.success(`${proposal.label}: ${show(proposal.current, proposal.unit)} → ${show(proposal.proposed, proposal.unit)}`, {
      description: 'Protokolliert unter KI › Parameter-Vorschläge; die Wirkung wird nach ~18 h bewertet.',
    });
    onOpenChange(false);
    onApplied();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{proposal.label} ändern?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3 text-base">
                <span className="text-muted-foreground">{show(proposal.current, proposal.unit)}</span>
                <span aria-hidden="true">→</span>
                <strong className="text-foreground">{show(proposal.proposed, proposal.unit)}</strong>
              </div>
              <p>{proposal.reasoning}</p>
              <p className="text-xs">
                Wird sofort wirksam (nächster Lauf der Automatik) und ist jederzeit in den Einstellungen änderbar.
                Erlaubter Bereich: {proposal.wl.min_value ?? '–'} … {proposal.wl.max_value ?? '–'}.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); apply(); }} disabled={busy}>
            {busy ? 'Übernehme …' : 'Übernehmen'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
