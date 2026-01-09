import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Euro, TrendingDown, TrendingUp, Sun } from "lucide-react";
import { useEnergyCosts, CostPeriod } from "@/hooks/useEnergyCosts";

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
  const [period, setPeriod] = useState<CostPeriod>("day");
  
  const { costs, isLoading, periodLabel } = useEnergyCosts(
    energyIn,
    energyOut,
    pvEnergy,
    electricityPriceCent,
    feedInPriceCent
  );

  const data = costs[period];

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
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Euro className="h-4 w-4" />
            Kostenübersicht {periodLabel(period)}
          </CardTitle>
          <Select value={period} onValueChange={(v) => setPeriod(v as CostPeriod)}>
            <SelectTrigger className="w-[100px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Tag</SelectItem>
              <SelectItem value="month">Monat</SelectItem>
              <SelectItem value="year">Jahr</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Laden...</div>
        ) : (
          <>
            {/* Strombezug */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-destructive" />
                <span className="text-sm text-muted-foreground">Strombezug (Salzburg AG)</span>
              </div>
              <span className="text-sm font-medium text-destructive">
                -{formatCurrency(data.gridCost)}
              </span>
            </div>

            {/* ÖMAG Einspeisung */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-500" />
                <span className="text-sm text-muted-foreground">ÖMAG Einspeisung</span>
              </div>
              <span className="text-sm font-medium text-green-500">
                +{formatCurrency(data.feedInEarnings)}
              </span>
            </div>

            {/* PV-Ersparnis */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sun className="h-4 w-4 text-yellow-500" />
                <span className="text-sm text-muted-foreground">PV-Ersparnis (Eigenverbrauch)</span>
              </div>
              <span className="text-sm font-medium text-yellow-500">
                +{formatCurrency(data.pvSavings)}
              </span>
            </div>

            {/* Trennlinie */}
            <div className="border-t border-border pt-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Bilanz {periodLabel(period)}</span>
                <span className={`text-base font-bold ${data.netBalance >= 0 ? 'text-green-500' : 'text-destructive'}`}>
                  {formatCurrency(data.netBalance, true)}
                </span>
              </div>
            </div>

            {/* Zusatzinfo: Eigenverbrauch kWh */}
            <div className="text-xs text-muted-foreground text-right">
              Eigenverbrauch: {data.selfConsumption.toFixed(2)} kWh
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
