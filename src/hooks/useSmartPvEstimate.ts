import { useMemo } from 'react';
import { PvForecast } from '@/types/heating';

interface SmartPvEstimate {
  estimatedTotal: number;
  confidence: 'low' | 'medium' | 'high';
  remainingKwh: number;
  progressPercent: number;
}

/**
 * Berechnet eine intelligente Schätzung der PV-Tagesproduktion
 * basierend auf dem Stundenprofil der Prognose und der aktuellen Produktion
 */
export function useSmartPvEstimate(
  currentProduction: number,
  todayForecast: PvForecast | undefined
): SmartPvEstimate {
  return useMemo(() => {
    if (!todayForecast?.hourly_watts) {
      return {
        estimatedTotal: currentProduction,
        confidence: 'low',
        remainingKwh: 0,
        progressPercent: 100,
      };
    }

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinutes = now.getMinutes();
    
    // Berechne wie viel der Prognose bereits vergangen sein sollte
    const hourlyWatts = todayForecast.hourly_watts;
    let forecastPastWh = 0;
    let forecastRemainingWh = 0;
    let forecastTotalWh = 0;

    // Summiere Prognose-Werte pro Stunde
    for (const [hour, watts] of Object.entries(hourlyWatts)) {
      const hourNum = parseInt(hour);
      const wattsNum = Number(watts) || 0;
      
      forecastTotalWh += wattsNum;
      
      if (hourNum < currentHour) {
        // Vergangene Stunden: volle Wh
        forecastPastWh += wattsNum;
      } else if (hourNum === currentHour) {
        // Aktuelle Stunde: anteilig
        const fraction = currentMinutes / 60;
        forecastPastWh += wattsNum * fraction;
        forecastRemainingWh += wattsNum * (1 - fraction);
      } else {
        // Zukünftige Stunden
        forecastRemainingWh += wattsNum;
      }
    }

    // Konvertiere zu kWh
    const forecastPastKwh = forecastPastWh / 1000;
    const forecastRemainingKwh = forecastRemainingWh / 1000;
    const forecastTotalKwh = forecastTotalWh / 1000;

    // Berechne Skalierungsfaktor: wie gut performt die Anlage heute vs Prognose
    let scaleFactor = 1;
    if (forecastPastKwh > 0.5) {
      // Nur berechnen wenn genug Prognosedaten vergangen sind
      scaleFactor = currentProduction / forecastPastKwh;
      // Begrenze auf sinnvolle Werte (50% - 150%)
      scaleFactor = Math.max(0.5, Math.min(1.5, scaleFactor));
    }

    // Geschätzte Endproduktion = aktuelle Produktion + skalierte verbleibende Prognose
    const estimatedRemaining = forecastRemainingKwh * scaleFactor;
    const estimatedTotal = currentProduction + estimatedRemaining;

    // Berechne Fortschritt basierend auf Prognose-Profil
    const progressPercent = forecastTotalKwh > 0 
      ? Math.min(100, (forecastPastKwh / forecastTotalKwh) * 100)
      : (currentHour / 24) * 100;

    // Confidence basierend auf Tageszeit und verfügbaren Daten
    let confidence: 'low' | 'medium' | 'high';
    if (currentHour < 9 || forecastPastKwh < 1) {
      confidence = 'low';
    } else if (currentHour < 14 || progressPercent < 60) {
      confidence = 'medium';
    } else {
      confidence = 'high';
    }

    return {
      estimatedTotal: Math.max(currentProduction, estimatedTotal),
      confidence,
      remainingKwh: Math.max(0, estimatedRemaining),
      progressPercent,
    };
  }, [currentProduction, todayForecast]);
}
