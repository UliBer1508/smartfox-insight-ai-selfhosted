import React from 'react';
import { Sun, Home, Zap, Battery } from 'lucide-react';

interface EnergyFlowDiagramProps {
  pvPower: number | null;
  consumption: number | null;
  batteryPower: number | null;
  gridPower: number;
  batterySoc: number | null;
}

const formatPower = (power: number | null): string => {
  if (power === null) return '-- kW';
  const absVal = Math.abs(power);
  if (absVal >= 1000) {
    return `${(absVal / 1000).toFixed(2)} kW`;
  }
  return `${Math.round(absVal)} W`;
};

// Circular gauge component with scale marks
const CircularGauge = ({ 
  value, 
  maxValue, 
  color, 
  label,
  icon: Icon,
  cx, 
  cy, 
  radius = 50 
}: { 
  value: number;
  maxValue: number;
  color: string;
  label: string;
  icon: React.ElementType;
  cx: number;
  cy: number;
  radius?: number;
}) => {
  const percentage = Math.min(Math.abs(value) / maxValue, 1);
  const startAngle = 135;
  const endAngle = 405;
  const arcLength = 270;
  
  const polarToCartesian = (angle: number, r: number) => {
    const rad = (angle - 90) * Math.PI / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad)
    };
  };

  const createArc = (startA: number, endA: number, r: number) => {
    const start = polarToCartesian(startA, r);
    const end = polarToCartesian(endA, r);
    const largeArc = endA - startA > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
  };

  const marks = [];
  const numMarks = 24;
  for (let i = 0; i <= numMarks; i++) {
    const angle = startAngle + (arcLength / numMarks) * i;
    const innerR = radius - 8;
    const outerR = radius - 3;
    const inner = polarToCartesian(angle, innerR);
    const outer = polarToCartesian(angle, outerR);
    marks.push(
      <line
        key={i}
        x1={inner.x}
        y1={inner.y}
        x2={outer.x}
        y2={outer.y}
        stroke="hsl(var(--muted-foreground))"
        strokeWidth="1"
        opacity="0.4"
      />
    );
  }

  const filledEndAngle = startAngle + arcLength * percentage;

  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="hsl(var(--card))"
        stroke="hsl(var(--border))"
        strokeWidth="2"
      />
      
      {marks}
      
      <path
        d={createArc(startAngle, endAngle, radius - 12)}
        fill="none"
        stroke="hsl(var(--muted))"
        strokeWidth="6"
        strokeLinecap="round"
      />
      
      {percentage > 0 && (
        <path
          d={createArc(startAngle, filledEndAngle, radius - 12)}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
        />
      )}
      
      <g transform={`translate(${cx - 12}, ${cy - 8})`}>
        <Icon size={24} color={color} />
      </g>
      
      <text
        x={cx}
        y={cy + radius - 20}
        textAnchor="middle"
        fill="hsl(var(--foreground))"
        fontSize="11"
        fontWeight="600"
      >
        {label}
      </text>
    </g>
  );
};

const FlowDots = ({ 
  pathId, 
  isActive, 
  power,
  color,
  reverse = false
}: { 
  pathId: string;
  isActive: boolean;
  power: number;
  color: string;
  reverse?: boolean;
}) => {
  if (!isActive || power === 0) return null;
  
  const duration = Math.max(1.5, 4 - Math.abs(power) / 3000);
  
  return (
    <>
      {[0, 0.33, 0.66].map((offset, i) => (
        <circle key={i} r="4" fill={color}>
          <animateMotion
            dur={`${duration}s`}
            repeatCount="indefinite"
            begin={`${offset * duration}s`}
            keyPoints={reverse ? "1;0" : "0;1"}
            keyTimes="0;1"
            calcMode="linear"
          >
            <mpath href={`#${pathId}`} />
          </animateMotion>
        </circle>
      ))}
    </>
  );
};

const InverterNode = ({ cx, cy }: { cx: number; cy: number }) => (
  <g>
    <circle
      cx={cx}
      cy={cy}
      r={35}
      fill="hsl(var(--card))"
      stroke="hsl(var(--border))"
      strokeWidth="2"
    />
    <circle
      cx={cx}
      cy={cy}
      r={28}
      fill="none"
      stroke="hsl(var(--border))"
      strokeWidth="1"
    />
    <text
      x={cx}
      y={cy + 4}
      textAnchor="middle"
      fill="hsl(var(--muted-foreground))"
      fontSize="10"
      fontWeight="500"
    >
      Inverter
    </text>
  </g>
);

export function EnergyFlowDiagram({
  pvPower,
  consumption,
  batteryPower,
  gridPower,
  batterySoc
}: EnergyFlowDiagramProps) {
  const pv = { x: 80, y: 70 };
  const consumer = { x: 280, y: 70 };
  const inverter = { x: 180, y: 160 };
  const grid = { x: 80, y: 250 };
  const battery = { x: 280, y: 250 };
  
  const colors = {
    pv: '#F5A623',
    consumer: '#4A90D9',
    grid: '#888888',
    battery: '#7CB342'
  };
  
  const pvActive = (pvPower ?? 0) > 50;
  const consumptionActive = (consumption ?? 0) > 50;
  const batteryCharging = (batteryPower ?? 0) < -50;     // negativ = laden
  const batteryDischarging = (batteryPower ?? 0) > 50;   // positiv = entladen
  const gridImport = gridPower > 50;
  const gridExport = gridPower < -50;

  return (
    <div className="w-full bg-card rounded-xl p-4 border border-border">
      <h3 className="text-sm font-medium text-muted-foreground mb-2">Energiefluss</h3>
      <div className="w-full flex justify-center">
        <svg viewBox="0 0 360 320" className="w-full max-w-md">
          <defs>
            <path
              id="path-pv"
              d={`M ${pv.x} ${pv.y + 50} Q ${pv.x + 40} ${inverter.y - 20} ${inverter.x - 35} ${inverter.y}`}
              fill="none"
            />
            <path
              id="path-consumer"
              d={`M ${inverter.x + 35} ${inverter.y} Q ${consumer.x - 40} ${inverter.y - 20} ${consumer.x} ${consumer.y + 50}`}
              fill="none"
            />
            <path
              id="path-grid"
              d={`M ${grid.x} ${grid.y - 50} Q ${grid.x + 40} ${inverter.y + 20} ${inverter.x - 35} ${inverter.y}`}
              fill="none"
            />
            <path
              id="path-battery"
              d={`M ${battery.x} ${battery.y - 50} Q ${battery.x - 40} ${inverter.y + 20} ${inverter.x + 35} ${inverter.y}`}
              fill="none"
            />
          </defs>
          
          <path
            d={`M ${pv.x} ${pv.y + 50} Q ${pv.x + 40} ${inverter.y - 20} ${inverter.x - 35} ${inverter.y}`}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth="2"
            strokeDasharray={pvActive ? "none" : "4,4"}
          />
          <path
            d={`M ${inverter.x + 35} ${inverter.y} Q ${consumer.x - 40} ${inverter.y - 20} ${consumer.x} ${consumer.y + 50}`}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth="2"
            strokeDasharray={consumptionActive ? "none" : "4,4"}
          />
          <path
            d={`M ${grid.x} ${grid.y - 50} Q ${grid.x + 40} ${inverter.y + 20} ${inverter.x - 35} ${inverter.y}`}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth="2"
            strokeDasharray={gridImport || gridExport ? "none" : "4,4"}
          />
          <path
            d={`M ${battery.x} ${battery.y - 50} Q ${battery.x - 40} ${inverter.y + 20} ${inverter.x + 35} ${inverter.y}`}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth="2"
            strokeDasharray={batteryCharging || batteryDischarging ? "none" : "4,4"}
          />
          
          <FlowDots
            pathId="path-pv"
            isActive={pvActive}
            power={pvPower ?? 0}
            color={colors.pv}
          />
          <FlowDots
            pathId="path-consumer"
            isActive={consumptionActive}
            power={consumption ?? 0}
            color={colors.consumer}
          />
          <FlowDots
            pathId="path-grid"
            isActive={gridImport}
            power={gridPower}
            color={colors.grid}
          />
          <FlowDots
            pathId="path-grid"
            isActive={gridExport}
            power={gridPower}
            color={colors.battery}
            reverse
          />
          <FlowDots
            pathId="path-battery"
            isActive={batteryDischarging}
            power={batteryPower ?? 0}
            color={colors.battery}
          />
          <FlowDots
            pathId="path-battery"
            isActive={batteryCharging}
            power={batteryPower ?? 0}
            color={colors.battery}
            reverse
          />
          
          <InverterNode cx={inverter.x} cy={inverter.y} />
          
          <CircularGauge
            cx={pv.x}
            cy={pv.y}
            value={pvPower ?? 0}
            maxValue={10000}
            color={colors.pv}
            label={formatPower(pvPower)}
            icon={Sun}
          />
          <CircularGauge
            cx={consumer.x}
            cy={consumer.y}
            value={consumption ?? 0}
            maxValue={10000}
            color={colors.consumer}
            label={formatPower(consumption)}
            icon={Home}
          />
          <CircularGauge
            cx={grid.x}
            cy={grid.y}
            value={Math.abs(gridPower)}
            maxValue={10000}
            color={colors.grid}
            label={formatPower(gridPower)}
            icon={Zap}
          />
          <CircularGauge
            cx={battery.x}
            cy={battery.y}
            value={batterySoc ?? 0}
            maxValue={100}
            color={colors.battery}
            label={`${batterySoc ?? 0}%`}
            icon={Battery}
          />
          
          <text x={pv.x} y={pv.y - 55} textAnchor="middle" fill="hsl(var(--foreground))" fontSize="12" fontWeight="600">
            PV
          </text>
          <text x={consumer.x} y={consumer.y - 55} textAnchor="middle" fill="hsl(var(--foreground))" fontSize="12" fontWeight="600">
            Verbraucher
          </text>
          <text x={grid.x} y={grid.y + 70} textAnchor="middle" fill="hsl(var(--foreground))" fontSize="12" fontWeight="600">
            Netz
          </text>
          {batteryPower !== null && Math.abs(batteryPower) > 50 && (
            <text 
              x={battery.x} 
              y={battery.y + 55} 
              textAnchor="middle" 
              fill={batteryCharging ? "#4ade80" : "#facc15"} 
              fontSize="11" 
              fontWeight="500"
            >
              {batteryCharging ? "Lädt" : "Entlädt"} {formatPower(Math.abs(batteryPower))}
            </text>
          )}
          <text x={battery.x} y={battery.y + (Math.abs(batteryPower ?? 0) > 50 ? 72 : 70)} textAnchor="middle" fill="hsl(var(--foreground))" fontSize="12" fontWeight="600">
            Batterie
          </text>
        </svg>
      </div>
    </div>
  );
}
