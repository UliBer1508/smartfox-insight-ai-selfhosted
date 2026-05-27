import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { useEnergyPrices, PriceSuggestion } from "@/hooks/useEnergyPrices";
import { toast } from "sonner";

const FIELD_LABEL: Record<PriceSuggestion["field"], string> = {
  electricity_price_cent: "Strompreis",
  feed_in_price_cent: "Einspeisetarif",
  electricity_base_fee_year_eur: "Grundgebühr",
};
const FIELD_UNIT: Record<PriceSuggestion["field"], string> = {
  electricity_price_cent: "ct/kWh",
  feed_in_price_cent: "ct/kWh",
  electricity_base_fee_year_eur: "€/Jahr",
};
const SOURCE_LABEL: Record<PriceSuggestion["source"], string> = {
  oemag: "ÖMAG",
  salzburg_ag: "Salzburg AG",
};

export function PriceSuggestionBanner() {
  const { pendingSuggestions, apply, dismiss } = useEnergyPrices();

  if (pendingSuggestions.length === 0) return null;

  return (
    <div className="space-y-2">
      {pendingSuggestions.map((s) => (
        <Alert key={s.id} className="border-amber-500/40 bg-amber-500/5">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <AlertDescription className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="text-sm">
              <span className="font-medium">{SOURCE_LABEL[s.source]}:</span>{" "}
              Neuer {FIELD_LABEL[s.field]}{" "}
              <span className="font-mono">
                {Number(s.new_value).toFixed(2)} {FIELD_UNIT[s.field]}
              </span>
              {s.old_value !== null && (
                <span className="text-muted-foreground">
                  {" "}
                  (bisher {Number(s.old_value).toFixed(2)} {FIELD_UNIT[s.field]})
                </span>
              )}{" "}
              ab {new Date(s.effective_date).toLocaleDateString("de-AT")}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await dismiss(s.id);
                  toast.success("Vorschlag verworfen");
                }}
              >
                Verwerfen
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await apply(s);
                    toast.success("Preis übernommen");
                  } catch (e) {
                    toast.error(
                      `Fehler: ${(e as Error).message ?? "Unbekannt"}`,
                    );
                  }
                }}
              >
                Übernehmen
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
