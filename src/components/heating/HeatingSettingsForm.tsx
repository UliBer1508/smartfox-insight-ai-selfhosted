import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { HeatingSettings } from '@/types/heating';
import { Settings, Save, MapPin, Zap, Thermometer, Euro, Moon, Gauge } from 'lucide-react';

interface HeatingSettingsFormProps {
  settings: HeatingSettings;
  onSave: (settings: Partial<HeatingSettings>) => void;
  isLoading: boolean;
}

const AZIMUTH_OPTIONS = [
  { value: '0', label: 'Süd (0°)' },
  { value: '45', label: 'Südwest (45°)' },
  { value: '-45', label: 'Südost (-45°)' },
  { value: '90', label: 'West (90°)' },
  { value: '-90', label: 'Ost (-90°)' },
  { value: '135', label: 'Nordwest (135°)' },
  { value: '-135', label: 'Nordost (-135°)' },
  { value: '180', label: 'Nord (180°)' },
];

export function HeatingSettingsForm({ settings, onSave, isLoading }: HeatingSettingsFormProps) {
  const [formData, setFormData] = useState(settings);
  const [showMigrationBanner, setShowMigrationBanner] = useState(false);

  // Update formData when settings change (e.g., after loading from database)
  useEffect(() => {
    setFormData(settings);
    // Migrations-Banner: einmalig anzeigen, wenn beide deprecated SOC-Felder existieren und abweichen
    const dismissed = typeof window !== 'undefined' && localStorage.getItem('soc-migration-banner-dismissed') === '1';
    if (
      !dismissed &&
      settings.battery_reserve_for_night_soc != null &&
      settings.heating_min_battery_soc != null &&
      settings.battery_reserve_for_night_soc !== settings.heating_min_battery_soc
    ) {
      setShowMigrationBanner(true);
    }
  }, [settings]);

  const dismissMigrationBanner = () => {
    if (typeof window !== 'undefined') localStorage.setItem('soc-migration-banner-dismissed', '1');
    setShowMigrationBanner(false);
  };

  const handleChange = (field: keyof HeatingSettings, value: number | boolean | string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Anlagen-Konfiguration
        </CardTitle>
        <CardDescription>
          Einstellungen für PV-Anlage, Batterie, Temperaturen und Standort
        </CardDescription>
      </CardHeader>
      <CardContent>
        {showMigrationBanner && (
          <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm space-y-2">
            <p>
              Zwei veraltete SOC-Einstellungen gefunden. Es wird jetzt nur noch
              <strong> heating_min_battery_soc: {formData.heating_min_battery_soc}%</strong> verwendet.
              Den alten Wert <strong>battery_reserve_for_night_soc: {formData.battery_reserve_for_night_soc}%</strong>
              {' '}haben wir als Startwert übernommen, falls er höher war.
            </p>
            <Button type="button" size="sm" variant="outline" onClick={dismissMigrationBanner}>
              Verstanden
            </Button>
          </div>
        )}
        <form
          onSubmit={handleSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
              e.preventDefault();
            }
          }}
          className="space-y-6"
        >
          {/* PV & Battery */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pv_capacity">PV-Kapazität (kWp)</Label>
              <Input
                id="pv_capacity"
                type="number"
                step="0.1"
                value={formData.pv_capacity_kwp}
                onChange={(e) => handleChange('pv_capacity_kwp', parseFloat(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="battery_capacity">Batterie-Kapazität (kWh)</Label>
              <Input
                id="battery_capacity"
                type="number"
                step="0.1"
                value={formData.battery_capacity_kwh}
                onChange={(e) => handleChange('battery_capacity_kwh', parseFloat(e.target.value))}
              />
            </div>
          </div>

          {/* Nacht-Zeiten */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium flex items-center gap-2 mb-4">
              <Moon className="w-4 h-4" />
              Nacht-Zeiten für Automatik
            </h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="night_start">Nacht-Start</Label>
                <Input
                  id="night_start"
                  type="time"
                  value={formData.night_start_time || '22:00'}
                  onChange={(e) => handleChange('night_start_time', e.target.value)}
              />
              </div>
              <div className="space-y-2">
                <Label htmlFor="night_end">Nacht-Ende</Label>
                <Input
                  id="night_end"
                  type="time"
                  value={formData.night_end_time || '06:00'}
                  onChange={(e) => handleChange('night_end_time', e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Label htmlFor="night_heating_mode">Nacht-Heizmodus</Label>
              <Select
                value={formData.night_heating_mode || 'frost_only'}
                onValueChange={(value) => handleChange('night_heating_mode', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="frost_only">Frostschutz (5°C) — kein Heizen nachts</SelectItem>
                  <SelectItem value="maintain">Nacht-Temp. halten — Thermostate cyclen</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Frostschutz: Thermostate auf 5°C → 0W Heizverbrauch nachts. Maintain: hält Nacht-Temperatur.
              </p>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Während dieser Zeit wird automatisch der gewählte Nacht-Heizmodus angewendet
            </p>
          </div>

          {/* Leistungsbudget-Management */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium flex items-center gap-2 mb-4">
              <Gauge className="w-4 h-4" />
              Leistungsbudget-Management
            </h3>
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="power_budget"
                  checked={formData.power_budget_enabled !== false}
                  onCheckedChange={(checked) => handleChange('power_budget_enabled', checked)}
                />
                <Label htmlFor="power_budget" className="text-sm">
                  Sequenzielles Heizen aktivieren
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Begrenzt die gleichzeitige Heizleistung um Netzspitzen zu vermeiden und PV optimal zu nutzen
              </p>
              
              {formData.power_budget_enabled !== false && (
                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="max_grid_power">Max. Netz-Heizleistung (W)</Label>
                    <Input
                      id="max_grid_power"
                      type="number"
                      min="500"
                      step="100"
                      value={formData.max_grid_heating_power_w || 2000}
                      onChange={(e) => handleChange('max_grid_heating_power_w', parseInt(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">Bei Nacht/Wolken</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="budget_tolerance">PV-Toleranz (W)</Label>
                    <Input
                      id="budget_tolerance"
                      type="number"
                      min="0"
                      step="50"
                      value={formData.power_budget_tolerance_w || 200}
                      onChange={(e) => handleChange('power_budget_tolerance_w', parseInt(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">Erlaubter Netzbezug</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rotation_minutes">Rotation (Min)</Label>
                    <Input
                      id="rotation_minutes"
                      type="number"
                      min="10"
                      max="120"
                      value={formData.room_rotation_minutes || 30}
                      onChange={(e) => handleChange('room_rotation_minutes', parseInt(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">Heizzeit pro Raum</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pause_minutes">Mindest-Pause (Min)</Label>
                    <Input
                      id="pause_minutes"
                      type="number"
                      min="5"
                      max="60"
                      value={formData.min_room_pause_minutes || 15}
                      onChange={(e) => handleChange('min_room_pause_minutes', parseInt(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">Zwischen Rotationen</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Mikro-Budget Modus */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4" />
              Mikro-Budget Modus
            </h3>
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="micro_budget"
                  checked={formData.micro_budget_enabled !== false}
                  onCheckedChange={(checked) => handleChange('micro_budget_enabled', checked)}
                />
                <Label htmlFor="micro_budget" className="text-sm">
                  Mikro-Budget aktivieren
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Bei kleinem PV-Überschuss (z.B. 200W) wird rotierend ein Raum für kurze Zeit aktiviert.
                Batterie dient als Puffer (Mindest-SOC nötig).
              </p>

              {formData.micro_budget_enabled !== false && (
                <div className="space-y-2 mt-4 md:max-w-xs">
                  <Label htmlFor="micro_duration">Heizdauer pro Zyklus (Min)</Label>
                  <Input
                    id="micro_duration"
                    type="number"
                    min="3"
                    max="15"
                    value={formData.micro_heat_duration_min ?? 5}
                    onChange={(e) => handleChange('micro_heat_duration_min', parseInt(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Wie lange ein Raum pro Rotation heizt. SOC-Floor =
                    {' '}<strong>Mindest-SOC für Nacht-Reserve + 5 %</strong> (automatisch, kein separater Regler).
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Batterie-Reserve / Heizungs-Schutz (konsolidiert) */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4" />
              Batterie-Reserve für Nachverbrauch
            </h3>
            <div className="space-y-5">
              <div className="space-y-3">
                <Label>
                  Mindest-SOC für Nacht-Reserve: {formData.heating_min_battery_soc ?? 80}%
                </Label>
                <Slider
                  min={40}
                  max={95}
                  step={5}
                  value={[formData.heating_min_battery_soc ?? 80]}
                  onValueChange={(v) => handleChange('heating_min_battery_soc', v[0])}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  Dieser Wert schützt die Batterie für Abend-/Nachtverbrauch und gilt zugleich als hartes
                  SOC-Gate: Die Heizung darf die Batterie nur entladen, wenn der Ladestand darüber liegt.
                  Die Puffer-Logik unten referenziert diesen Wert (Reserve+20 / Reserve+35).
                  Mikro-Budget nutzt automatisch <strong>diesen Wert + 5 %</strong> als zusätzlichen Floor.
                </p>
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-foreground/90 space-y-1">
                  <p className="font-medium">Batterie-Mindest-SOC für Heizung (z.B. 75%)</p>
                  <p>
                    Diese Einstellung wird <strong>manuell</strong> gesetzt und kann von der KI
                    <strong> NICHT</strong> überschrieben werden.
                  </p>
                  <p>
                    Sie gilt als hartes Gate: Fällt die Batterie unter diesen Wert, stoppt die
                    Heizautomatik sofort (<code>strict</code>) oder blockiert zumindest neue
                    Aktivierungen (<code>soft</code>).
                  </p>
                  <p>
                    Der Mikro-Budget-Modus respektiert ebenfalls diesen Wert — er darf nie darunter
                    aktivieren.
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <Switch
                  id="battery_buffer"
                  checked={formData.battery_buffer_enabled !== false}
                  onCheckedChange={(checked) => handleChange('battery_buffer_enabled', checked)}
                />
                <Label htmlFor="battery_buffer" className="text-sm">
                  Batterie-Puffer für Heizung aktivieren
                </Label>
              </div>
              <p className="text-xs text-muted-foreground -mt-2 ml-6">
                Erlaubt zusätzliches Eco-Budget aus der Batterie, wenn SOC ≥ Reserve+20% UND Tagesprognose den Bedarf deckt.
              </p>

              {formData.battery_buffer_enabled !== false && (
                <div className="space-y-3">
                  <Label>
                    Max. Puffer-Bonus: {formData.battery_buffer_bonus_w ?? 500}W
                  </Label>
                  <Slider
                    min={200}
                    max={1500}
                    step={100}
                    value={[formData.battery_buffer_bonus_w ?? 500]}
                    onValueChange={(v) => handleChange('battery_buffer_bonus_w', v[0])}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">
                    Skaliert in 3 Stufen: 30% (SOC knapp über Reserve+20) → 60% → 100% (SOC ≥ Reserve+35).
                  </p>
                </div>
              )}

              <div className="flex items-center space-x-2 pt-2">
                <Switch
                  id="tolerant_deact"
                  checked={formData.tolerant_deactivation_enabled !== false}
                  onCheckedChange={(checked) => handleChange('tolerant_deactivation_enabled', checked)}
                />
                <Label htmlFor="tolerant_deact" className="text-sm">
                  Tolerante Deaktivierung
                </Label>
              </div>
              <p className="text-xs text-muted-foreground -mt-2 ml-6">
                Räume bleiben bei kurzen PV-Einbrüchen aktiv (Wolkenschatten), wenn Trend stabil ist.
              </p>

              <div className="space-y-2 pt-2">
                <Label htmlFor="soc_gate_mode">Sperr-Modus (bei SOC unter Reserve)</Label>
                <Select
                  value={formData.heating_soc_gate_mode ?? 'strict'}
                  onValueChange={(value) => handleChange('heating_soc_gate_mode', value)}
                >
                  <SelectTrigger id="soc_gate_mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="strict">Strikt — laufende Räume sofort stoppen</SelectItem>
                    <SelectItem value="soft">Sanft — laufende Räume dürfen fertigheizen</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>



          <div className="border-t pt-4">
            <h3 className="text-sm font-medium flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4" />
              PV-Automatik Schwellwerte
            </h3>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label htmlFor="threshold_on">Heizen ab (W)</Label>
                <Input
                  id="threshold_on"
                  type="number"
                  min="0"
                  step="100"
                  value={formData.pv_surplus_threshold_on || 500}
                  onChange={(e) => handleChange('pv_surplus_threshold_on', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">PV-Überschuss für Aktivierung</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="threshold_off">Stoppen unter (W)</Label>
                <Input
                  id="threshold_off"
                  type="number"
                  min="0"
                  step="100"
                  value={formData.pv_surplus_threshold_off || 200}
                  onChange={(e) => handleChange('pv_surplus_threshold_off', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Hysterese-Schwelle</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="switch_interval">Schaltintervall (Min)</Label>
                <Input
                  id="switch_interval"
                  type="number"
                  min="1"
                  max="60"
                  value={formData.min_switch_interval_min || 5}
                  onChange={(e) => handleChange('min_switch_interval_min', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Mindestzeit zwischen Schaltvorgängen</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pv_boost_delta">PV-Boost Temperatur (°C)</Label>
                <Input
                  id="pv_boost_delta"
                  type="number"
                  min="0"
                  max="5"
                  step="0.5"
                  value={formData.pv_boost_temp_delta ?? 2}
                  onChange={(e) => handleChange('pv_boost_temp_delta', parseFloat(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Max. Aufheizung über Komfort bei PV-Überschuss
                </p>
              </div>
            </div>
          </div>

          {/* Fußbodenheizung-Parameter */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium flex items-center gap-2 mb-4">
              <Thermometer className="w-4 h-4" />
              Fußbodenheizung-Eigenschaften
            </h3>
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <div className="space-y-2">
                <Label htmlFor="heating_type">Heizungstyp</Label>
                <Select
                  value={formData.heating_type || 'direct_electric'}
                  onValueChange={(value) => handleChange('heating_type', value)}
                >
                  <SelectTrigger id="heating_type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="direct_electric">Direkte Elektro-Fußbodenheizung</SelectItem>
                    <SelectItem value="heat_pump">Wärmepumpe</SelectItem>
                    <SelectItem value="water">Wasserbasierte Fußbodenheizung</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {formData.heating_type === 'direct_electric' 
                    ? 'Stromverbrauch direkt aus Netz/Batterie' 
                    : formData.heating_type === 'heat_pump'
                    ? 'Effizient, COP-Faktor beachten'
                    : 'Über Kessel/Wärmepumpe beheizt'}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="total_heating_power">Gesamte Heizleistung (W)</Label>
                <Input
                  id="total_heating_power"
                  type="number"
                  min="0"
                  step="100"
                  value={formData.total_heating_power_w || 9600}
                  onChange={(e) => handleChange('total_heating_power_w', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Summe aller Räume (installiert)</p>
              </div>
            </div>
            <div className="grid md:grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label htmlFor="response_hours">Reaktionszeit / Vorlauf (Stunden)</Label>
                <Input
                  id="response_hours"
                  type="number"
                  min="0"
                  max="3"
                  step="0.5"
                  value={formData.floor_heating_response_hours ?? 0}
                  onChange={(e) => handleChange('floor_heating_response_hours', parseFloat(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Trägheit der Fußbodenheizung. Erlaubt Vorlauf bis max. 3h vor 09:00 (Untergrenze 06:00) bei PV-Überschuss.
                </p>
              </div>
            </div>
          </div>

          {/* Warmwasser-Bereitung und Verbraucher-Priorität entfernt:
              Beide werden vollständig autonom von Smartfox gesteuert. Frühere UI-Werte
              führten zu Doppelzählungen im Heizbudget. DB-Felder bleiben für Backwards-Compat. */}

          {/* Location Settings for PV Forecast */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium flex items-center gap-2 mb-4">
              <MapPin className="w-4 h-4" />
              Standort für PV-Prognose
            </h3>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label htmlFor="latitude">Breitengrad</Label>
                <Input
                  id="latitude"
                  type="number"
                  step="0.00001"
                  value={formData.latitude || 47.24983}
                  onChange={(e) => handleChange('latitude', parseFloat(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="longitude">Längengrad</Label>
                <Input
                  id="longitude"
                  type="number"
                  step="0.00001"
                  value={formData.longitude || 12.25415}
                  onChange={(e) => handleChange('longitude', parseFloat(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="azimuth">Ausrichtung</Label>
                <Select
                  value={String(formData.roof_azimuth || 0)}
                  onValueChange={(value) => handleChange('roof_azimuth', parseInt(value))}
                >
                  <SelectTrigger id="azimuth">
                    <SelectValue placeholder="Wählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {AZIMUTH_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="declination">Neigung (°)</Label>
                <Input
                  id="declination"
                  type="number"
                  min="0"
                  max="90"
                  value={formData.roof_declination || 35}
                  onChange={(e) => handleChange('roof_declination', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">0° = flach, 90° = senkrecht</p>
              </div>
            </div>
          </div>

          {/* Strompreis-Konfiguration */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium flex items-center gap-2 mb-4">
              <Euro className="w-4 h-4" />
              Strompreise (Salzburg AG)
            </h3>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="electricity_price">Arbeitspreis (Cent/kWh)</Label>
                <Input
                  id="electricity_price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.electricity_price_kwh_cent || 20.28}
                  onChange={(e) => handleChange('electricity_price_kwh_cent', parseFloat(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Preis für Netzbezug</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="feed_in_price">Einspeisetarif (Cent/kWh)</Label>
                <Input
                  id="feed_in_price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.feed_in_price_kwh_cent || 8.00}
                  onChange={(e) => handleChange('feed_in_price_kwh_cent', parseFloat(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Vergütung für Einspeisung</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="base_fee">Grundgebühr (€/Jahr)</Label>
                <Input
                  id="base_fee"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.electricity_base_fee_year_eur || 36.00}
                  onChange={(e) => handleChange('electricity_base_fee_year_eur', parseFloat(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Jährliche Grundgebühr</p>
              </div>
            </div>
          </div>

          <Button type="submit" disabled={isLoading}>
            <Save className="w-4 h-4 mr-2" />
            Speichern
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
