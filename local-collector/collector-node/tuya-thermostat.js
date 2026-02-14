/**
 * TuyAPI-basierte lokale Thermostat-Steuerung
 * Kommuniziert direkt mit TGP508 Thermostaten über LAN (Port 6668)
 */

const TuyAPI = require('tuyapi');

// TGP508 Thermostat DPS-Mapping (alphanumerische Code-Namen)
const DPS = {
  MODE: 'mode',              // Modus: auto/manual/off
  TARGET_TEMP: 'temp_set',   // Zieltemperatur (x10, z.B. 215 = 21.5°C)
  CURRENT_TEMP: 'temp_current', // Aktuelle Temperatur (x10)
  SWITCH: 'switch'           // Power on/off
};

// Fallback: Numerische DPS-IDs (falls Firmware aeltere Keys liefert)
const DPS_NUMERIC = {
  MODE: '1',
  TARGET_TEMP: '2',
  CURRENT_TEMP: '3',
  SWITCH: '4'
};

class ThermostatController {
  constructor() {
    this.devices = new Map();
    this.connectionRetries = new Map();
    this.maxRetries = 3;
  }

  /**
   * Holt oder erstellt TuyAPI Device-Instanz
   */
  getDevice(deviceConfig) {
    const key = deviceConfig.device_id;
    
    if (!this.devices.has(key)) {
      const device = new TuyAPI({
        id: deviceConfig.device_id,
        key: deviceConfig.local_key,
        ip: deviceConfig.ip,
        version: '3.3',
        issueRefreshOnConnect: true
      });
      
      device.on('error', (error) => {
        console.error(`[TuyAPI] ${deviceConfig.name} Fehler:`, error.message);
      });
      
      device.on('disconnected', () => {
        console.log(`[TuyAPI] ${deviceConfig.name} getrennt`);
      });
      
      this.devices.set(key, device);
    }
    
    return this.devices.get(key);
  }

  /**
   * Parst DPS-Daten mit Dual-Format-Fallback (alphanumerisch + numerisch)
   */
  parseDps(dps) {
    // Versuche zuerst alphanumerische Keys (TGP508 Standard)
    if (dps[DPS.CURRENT_TEMP] !== undefined || dps[DPS.TARGET_TEMP] !== undefined) {
      return {
        current_temp: (dps[DPS.CURRENT_TEMP] || 0) / 10,
        target_temp: (dps[DPS.TARGET_TEMP] || 0) / 10,
        is_heating: dps[DPS.SWITCH] === true,
        mode: dps[DPS.MODE] || 'unknown',
        format: 'alpha'
      };
    }
    
    // Fallback: Numerische Keys
    if (dps[DPS_NUMERIC.CURRENT_TEMP] !== undefined || dps[DPS_NUMERIC.TARGET_TEMP] !== undefined) {
      console.log('[TuyAPI] Verwende numerisches DPS-Format (Fallback)');
      return {
        current_temp: (dps[DPS_NUMERIC.CURRENT_TEMP] || 0) / 10,
        target_temp: (dps[DPS_NUMERIC.TARGET_TEMP] || 0) / 10,
        is_heating: dps[DPS_NUMERIC.SWITCH] === true,
        mode: dps[DPS_NUMERIC.MODE] || 'unknown',
        format: 'numeric'
      };
    }
    
    // Kein bekanntes Format - raw zurueckgeben
    console.warn('[TuyAPI] Unbekanntes DPS-Format:', JSON.stringify(dps));
    return null;
  }

  /**
   * Liest Status eines Thermostats mit Retry-Logik
   */
  async getStatus(deviceConfig, retryCount = 0) {
    const device = this.getDevice(deviceConfig);
    
    try {
      await device.find();
      await device.connect();
      
      const status = await device.get({ schema: true });
      const dps = status.dps || {};
      
      await device.disconnect();
      
      // Reset retry counter on success
      this.connectionRetries.set(deviceConfig.device_id, 0);
      
      const parsed = this.parseDps(dps);
      
      if (!parsed) {
        return {
          success: false,
          error: 'Unbekanntes DPS-Format',
          raw_dps: dps
        };
      }
      
      return {
        success: true,
        current_temp: parsed.current_temp,
        target_temp: parsed.target_temp,
        is_heating: parsed.is_heating,
        mode: parsed.mode,
        format: parsed.format,
        raw_dps: dps
      };
    } catch (error) {
      // Retry logic
      if (retryCount < this.maxRetries) {
        console.log(`[TuyAPI] ${deviceConfig.name} Retry ${retryCount + 1}/${this.maxRetries}...`);
        await this.sleep(1000 * (retryCount + 1));
        return this.getStatus(deviceConfig, retryCount + 1);
      }
      
      console.error(`[TuyAPI] ${deviceConfig.name} Status-Fehler nach ${this.maxRetries} Versuchen:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Setzt Zieltemperatur eines Thermostats
   */
  async setTemperature(deviceConfig, temperature, retryCount = 0) {
    const device = this.getDevice(deviceConfig);
    
    try {
      await device.find();
      await device.connect();
      
      // Temperatur * 10 (TGP508 erwartet z.B. 215 fuer 21.5°C)
      const tempValue = Math.round(temperature * 10);
      
      // Validierung: TGP508 unterstuetzt 5.0 - 35.0°C
      if (tempValue < 50 || tempValue > 350) {
        throw new Error(`Temperatur ${temperature}°C ausserhalb des gueltigen Bereichs (5-35°C)`);
      }
      
      await device.set({
        dps: DPS.TARGET_TEMP,
        set: tempValue
      });
      
      await device.disconnect();
      
      console.log(`[TuyAPI] ${deviceConfig.name}: Temperatur auf ${temperature}°C gesetzt`);
      return { success: true };
    } catch (error) {
      if (retryCount < this.maxRetries) {
        console.log(`[TuyAPI] ${deviceConfig.name} Set-Retry ${retryCount + 1}/${this.maxRetries}...`);
        await this.sleep(1000 * (retryCount + 1));
        return this.setTemperature(deviceConfig, temperature, retryCount + 1);
      }
      
      console.error(`[TuyAPI] ${deviceConfig.name} Set-Fehler nach ${this.maxRetries} Versuchen:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Setzt Modus eines Thermostats (auto/manual/off)
   */
  async setMode(deviceConfig, mode, retryCount = 0) {
    const device = this.getDevice(deviceConfig);
    
    try {
      await device.find();
      await device.connect();
      
      await device.set({
        dps: DPS.MODE,
        set: mode
      });
      
      await device.disconnect();
      
      console.log(`[TuyAPI] ${deviceConfig.name}: Modus auf ${mode} gesetzt`);
      return { success: true };
    } catch (error) {
      if (retryCount < this.maxRetries) {
        await this.sleep(1000 * (retryCount + 1));
        return this.setMode(deviceConfig, mode, retryCount + 1);
      }
      
      console.error(`[TuyAPI] ${deviceConfig.name} Mode-Fehler:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Alle Verbindungen schliessen
   */
  async disconnectAll() {
    for (const [id, device] of this.devices) {
      try {
        await device.disconnect();
      } catch (e) {
        // Ignorieren
      }
    }
    this.devices.clear();
    console.log('[TuyAPI] Alle Verbindungen geschlossen');
  }

  /**
   * Helper: Sleep Funktion
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ThermostatController;
