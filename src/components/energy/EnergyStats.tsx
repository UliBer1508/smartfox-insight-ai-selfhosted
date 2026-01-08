import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowDownToLine, ArrowUpFromLine, Zap, TrendingUp } from 'lucide-react';

interface EnergyStatsProps {
  energyIn: number;
  energyOut: number;
  pvEnergy: number;
  className?: string;
  electricityPriceCent?: number;
  feedInPriceCent?: number;
}

export function EnergyStats({ 
  energyIn, 
  energyOut, 
  pvEnergy, 
  className,
  electricityPriceCent = 20.28,
  feedInPriceCent = 8.00
}: EnergyStatsProps) {
  const netEnergy = energyOut - energyIn;
  
  // Eigenverbrauch = PV-Produktion - Einspeisung
  const selfConsumption = Math.max(0, pvEnergy - energyOut);
  
  // Gesamtverbrauch = Eigenverbrauch + Netzbezug
  const totalConsumption = selfConsumption + energyIn;
  
  // Autarkie = Eigenverbrauch / Gesamtverbrauch
  const autarkyRate = totalConsumption > 0 
    ? (selfConsumption / totalConsumption) * 100 
    : 0;

  // Kostenberechnung
  const costIn = (energyIn * electricityPriceCent) / 100;
  const earningOut = (energyOut * feedInPriceCent) / 100;
  const netCost = costIn - earningOut;

  return (
    <div className={cn('grid grid-cols-2 lg:grid-cols-4 gap-4', className)}>
      <Card className="bg-card border-destructive/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <ArrowDownToLine className="w-4 h-4 text-destructive" />
            Netzbezug
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold font-mono text-destructive">
            {energyIn.toFixed(2)}
          </div>
          <p className="text-xs text-muted-foreground">
            kWh = {costIn.toFixed(2)} €
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card border-success/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <ArrowUpFromLine className="w-4 h-4 text-success" />
            Einspeisung
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold font-mono text-success">
            {energyOut.toFixed(2)}
          </div>
          <p className="text-xs text-muted-foreground">
            kWh = {earningOut.toFixed(2)} €
          </p>
        </CardContent>
      </Card>

      <Card className={cn(
        'bg-card',
        netEnergy >= 0 ? 'border-success/30' : 'border-destructive/30'
      )}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            Bilanz
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className={cn(
            'text-2xl font-bold font-mono',
            netEnergy >= 0 ? 'text-success' : 'text-destructive'
          )}>
            {netEnergy >= 0 ? '+' : ''}{netEnergy.toFixed(2)}
          </div>
          <p className={cn(
            'text-xs',
            netCost <= 0 ? 'text-success' : 'text-destructive'
          )}>
            Netto: {netCost <= 0 ? '' : '+'}{netCost.toFixed(2)} €
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Autarkie
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold font-mono text-primary">
            {autarkyRate.toFixed(0)}%
          </div>
          <p className="text-xs text-muted-foreground">Eigenverbrauch</p>
        </CardContent>
      </Card>
    </div>
  );
}
