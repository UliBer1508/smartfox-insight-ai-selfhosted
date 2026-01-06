import { Sun, Home, Battery, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EnergyFlowDiagramProps {
  pvPower: number | null;
  consumption: number | null;
  batteryPower: number | null;
  gridPower: number;
  batterySoc: number | null;
}

const formatPower = (power: number) => {
  const abs = Math.abs(power);
  if (abs >= 1000) {
    return `${(abs / 1000).toFixed(1)} kW`;
  }
  return `${Math.round(abs)} W`;
};

interface FlowLineProps {
  isActive: boolean;
  power: number;
  color: string;
  pathId: string;
  reverse?: boolean;
}

const FlowLine = ({ isActive, power, color, pathId, reverse = false }: FlowLineProps) => {
  if (!isActive || power === 0) return null;
  
  const speed = Math.max(1, Math.min(4, power / 1000));
  const duration = 3 / speed;
  
  return (
    <g>
      {/* Animated dots along the path */}
      {[0, 1, 2].map((i) => (
        <circle key={i} r="4" fill={color} opacity="0.9">
          <animateMotion
            dur={`${duration}s`}
            repeatCount="indefinite"
            begin={`${i * (duration / 3)}s`}
            keyPoints={reverse ? "1;0" : "0;1"}
            keyTimes="0;1"
          >
            <mpath href={`#${pathId}`} />
          </animateMotion>
        </circle>
      ))}
    </g>
  );
};

interface NodeProps {
  x: number;
  y: number;
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  subLabel?: string;
}

const Node = ({ x, y, icon, label, value, color, subLabel }: NodeProps) => (
  <g transform={`translate(${x}, ${y})`}>
    {/* Background circle */}
    <circle r="36" fill="hsl(var(--card))" stroke={color} strokeWidth="3" />
    {/* Icon container */}
    <foreignObject x="-16" y="-24" width="32" height="32">
      <div className="flex items-center justify-center h-full" style={{ color }}>
        {icon}
      </div>
    </foreignObject>
    {/* Label */}
    <text y="20" textAnchor="middle" className="fill-foreground text-xs font-medium">
      {label}
    </text>
    {/* Value below node */}
    <text y="58" textAnchor="middle" className="fill-foreground text-sm font-bold">
      {value}
    </text>
    {subLabel && (
      <text y="74" textAnchor="middle" className="fill-muted-foreground text-xs">
        {subLabel}
      </text>
    )}
  </g>
);

export function EnergyFlowDiagram({
  pvPower,
  consumption,
  batteryPower,
  gridPower,
  batterySoc,
}: EnergyFlowDiagramProps) {
  // Determine flow states
  const pvToHouse = (pvPower ?? 0) > 0;
  const batteryCharging = (batteryPower ?? 0) > 50; // positive = charging
  const batteryDischarging = (batteryPower ?? 0) < -50; // negative = discharging
  const gridImport = gridPower > 50;
  const gridExport = gridPower < -50;

  // Node positions
  const centerX = 160;
  const centerY = 120;
  const pvPos = { x: centerX, y: 50 };
  const housePos = { x: centerX, y: centerY };
  const batteryPos = { x: 60, y: 200 };
  const gridPos = { x: 260, y: 200 };

  // Colors
  const colors = {
    pv: 'hsl(45, 93%, 47%)', // amber/yellow
    battery: batteryCharging ? 'hsl(142, 76%, 36%)' : 'hsl(25, 95%, 53%)', // green or orange
    gridImport: 'hsl(0, 84%, 60%)', // red
    gridExport: 'hsl(142, 76%, 36%)', // green
    house: 'hsl(217, 91%, 60%)', // blue
  };

  return (
    <div className="w-full bg-card rounded-xl p-4 border border-border">
      <h3 className="text-sm font-medium text-muted-foreground mb-2">Energiefluss</h3>
      <svg viewBox="0 0 320 260" className="w-full max-w-sm mx-auto">
        <defs>
          {/* Flow paths */}
          <path
            id="path-pv-house"
            d={`M ${pvPos.x} ${pvPos.y + 40} L ${housePos.x} ${housePos.y - 40}`}
            fill="none"
          />
          <path
            id="path-house-battery"
            d={`M ${housePos.x - 30} ${housePos.y + 30} Q ${(housePos.x + batteryPos.x) / 2} ${(housePos.y + batteryPos.y) / 2 + 20} ${batteryPos.x + 30} ${batteryPos.y - 30}`}
            fill="none"
          />
          <path
            id="path-battery-house"
            d={`M ${batteryPos.x + 30} ${batteryPos.y - 30} Q ${(housePos.x + batteryPos.x) / 2} ${(housePos.y + batteryPos.y) / 2 + 20} ${housePos.x - 30} ${housePos.y + 30}`}
            fill="none"
          />
          <path
            id="path-grid-house"
            d={`M ${gridPos.x - 30} ${gridPos.y - 30} Q ${(housePos.x + gridPos.x) / 2} ${(housePos.y + gridPos.y) / 2 + 20} ${housePos.x + 30} ${housePos.y + 30}`}
            fill="none"
          />
          <path
            id="path-house-grid"
            d={`M ${housePos.x + 30} ${housePos.y + 30} Q ${(housePos.x + gridPos.x) / 2} ${(housePos.y + gridPos.y) / 2 + 20} ${gridPos.x - 30} ${gridPos.y - 30}`}
            fill="none"
          />
        </defs>

        {/* Static connection lines */}
        <use href="#path-pv-house" stroke="hsl(var(--border))" strokeWidth="2" strokeDasharray={pvToHouse ? "0" : "4"} opacity={pvToHouse ? 1 : 0.3} />
        <use href="#path-house-battery" stroke="hsl(var(--border))" strokeWidth="2" strokeDasharray={batteryCharging ? "0" : "4"} opacity={batteryCharging ? 1 : 0.3} />
        <use href="#path-battery-house" stroke="hsl(var(--border))" strokeWidth="2" strokeDasharray={batteryDischarging ? "0" : "4"} opacity={batteryDischarging ? 1 : 0.3} />
        <use href="#path-grid-house" stroke="hsl(var(--border))" strokeWidth="2" strokeDasharray={gridImport ? "0" : "4"} opacity={gridImport ? 1 : 0.3} />
        <use href="#path-house-grid" stroke="hsl(var(--border))" strokeWidth="2" strokeDasharray={gridExport ? "0" : "4"} opacity={gridExport ? 1 : 0.3} />

        {/* Animated flows */}
        <FlowLine
          isActive={pvToHouse}
          power={pvPower ?? 0}
          color={colors.pv}
          pathId="path-pv-house"
        />
        <FlowLine
          isActive={batteryCharging}
          power={batteryPower ?? 0}
          color={colors.battery}
          pathId="path-house-battery"
        />
        <FlowLine
          isActive={batteryDischarging}
          power={Math.abs(batteryPower ?? 0)}
          color={colors.battery}
          pathId="path-battery-house"
        />
        <FlowLine
          isActive={gridImport}
          power={gridPower}
          color={colors.gridImport}
          pathId="path-grid-house"
        />
        <FlowLine
          isActive={gridExport}
          power={Math.abs(gridPower)}
          color={colors.gridExport}
          pathId="path-house-grid"
        />

        {/* Flow labels */}
        {pvToHouse && (
          <text x={pvPos.x + 25} y={(pvPos.y + housePos.y) / 2} className="fill-amber-500 text-xs font-medium">
            {formatPower(pvPower ?? 0)}
          </text>
        )}
        {batteryCharging && (
          <text x={batteryPos.x + 50} y={(housePos.y + batteryPos.y) / 2 + 15} className="fill-green-500 text-xs font-medium">
            {formatPower(batteryPower ?? 0)}
          </text>
        )}
        {batteryDischarging && (
          <text x={batteryPos.x + 50} y={(housePos.y + batteryPos.y) / 2 + 15} className="fill-orange-500 text-xs font-medium">
            {formatPower(batteryPower ?? 0)}
          </text>
        )}
        {gridImport && (
          <text x={gridPos.x - 55} y={(housePos.y + gridPos.y) / 2 + 15} className="fill-red-500 text-xs font-medium">
            {formatPower(gridPower)}
          </text>
        )}
        {gridExport && (
          <text x={gridPos.x - 55} y={(housePos.y + gridPos.y) / 2 + 15} className="fill-green-500 text-xs font-medium">
            {formatPower(gridPower)}
          </text>
        )}

        {/* Nodes */}
        <Node
          {...pvPos}
          icon={<Sun size={24} />}
          label="PV"
          value={pvPower != null ? formatPower(pvPower) : '--'}
          color={colors.pv}
        />
        <Node
          {...housePos}
          icon={<Home size={24} />}
          label="Verbrauch"
          value={consumption != null ? formatPower(consumption) : '--'}
          color={colors.house}
        />
        <Node
          {...batteryPos}
          icon={<Battery size={24} />}
          label="Batterie"
          value={batterySoc != null ? `${Math.round(batterySoc)}%` : '--'}
          subLabel={batteryCharging ? 'Lädt' : batteryDischarging ? 'Entlädt' : 'Standby'}
          color={colors.battery}
        />
        <Node
          {...gridPos}
          icon={<Zap size={24} />}
          label="Netz"
          value={formatPower(gridPower)}
          subLabel={gridImport ? 'Bezug' : gridExport ? 'Einspeisung' : 'Neutral'}
          color={gridImport ? colors.gridImport : gridExport ? colors.gridExport : 'hsl(var(--muted-foreground))'}
        />
      </svg>
    </div>
  );
}
