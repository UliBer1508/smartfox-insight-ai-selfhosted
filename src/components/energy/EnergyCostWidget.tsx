import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Euro, TrendingDown, TrendingUp, Sun } from "lucide-react";

interface EnergyCostWidgetProps {
  energyIn: number;
  energyOut: number;
  pvEnergy: number;
  electricityPriceCent: number;
  feedInPriceCent: number;
}

export function EnergyCostWidget({
  energyIn,
  energyOut,
  pvEnergy,
  electricityPriceCent,
  feedInPriceCent,
}: EnergyCostWidgetProps) {
  // Berechnungen
  const gridCost = (energyIn * electricityPriceCent) / 100;
  const feedInEarnings = (energyOut * feedInPriceCent) / 100;
  const selfConsumption = Math.max(0, pvEnergy - energyOut);
  const pvSavings = (selfConsumption * electricityPriceCent) / 100;
  const netBalance = feedInEarnings + pvSavings - gridCost;

  const formatCurrency = (value: number, showSign = false) => {
    const formatted = Math.abs(value).toFixed(2);
    if (showSign) {
      return value >= 0 ? `+${formatted} €` : `-${formatted} €`;
    }
    return `${formatted} €`;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Euro className="h-4 w-4" />
          Kostenübersicht heute
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Strombezug */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-destructive" />
            <span className="text-sm text-muted-foreground">Strombezug (Salzburg AG)</span>
          </div>
          <span className="text-sm font-medium text-destructive">
            -{formatCurrency(gridCost)}
          </span>
        </div>

        {/* ÖMAG Einspeisung */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-500" />
            <span className="text-sm text-muted-foreground">ÖMAG Einspeisung</span>
          </div>
          <span className="text-sm font-medium text-green-500">
            +{formatCurrency(feedInEarnings)}
          </span>
        </div>

        {/* PV-Ersparnis */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sun className="h-4 w-4 text-yellow-500" />
            <span className="text-sm text-muted-foreground">PV-Ersparnis (Eigenverbrauch)</span>
          </div>
          <span className="text-sm font-medium text-yellow-500">
            +{formatCurrency(pvSavings)}
          </span>
        </div>

        {/* Trennlinie */}
        <div className="border-t border-border pt-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Bilanz heute</span>
            <span className={`text-base font-bold ${netBalance >= 0 ? 'text-green-500' : 'text-destructive'}`}>
              {formatCurrency(netBalance, true)}
            </span>
          </div>
        </div>

        {/* Zusatzinfo: Eigenverbrauch kWh */}
        <div className="text-xs text-muted-foreground text-right">
          Eigenverbrauch: {selfConsumption.toFixed(2)} kWh
        </div>
      </CardContent>
    </Card>
  );
}
