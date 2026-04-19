/**
 * TuyAPI-basierte lokale Thermostat-Steuerung (Hybrid v2)
 * Kommuniziert direkt mit TGP508 Thermostaten über LAN (Port 6668)
 *
 * Robustheits-Features:
 * - Per-Device Command-Queue (serialisiert parallele Zugriffe)
 * - Connect-Timeout (5s) verhindert hängende connect()-Aufrufe
 * - safeDisconnect im finally garantiert sauberes Trennen auch bei Fehler
 * - Retry-Logik (3× mit Exponential Backoff) innerhalb der Queue
 * - Korrektes TGP508 DPS-Mapping & Temperatur-Skalierung beibehalten
 */

const TuyAPI = require('tuyapi');

// TGP508 Thermostat DPS-Mapping (Data Point Schema)
const DPS = {
  MODE: '1',           // Modus: auto/manual/off
  TARGET_TEMP: '2',    // Zieltemperatur (x10, z.B. 210 = 21.0°C)
  CURRENT_TEMP: '3',   // Aktuelle Temperatur (x10)
  HEATING: '4'         // Heizstatus: true/false
};

const CONNECT_TIMEOUT_MS = 5000;

class ThermostatController {
  constructor() {
    this.devices = new Map();    // persistente TuyAPI-Instanzen
    this.queues = new Map();     // Command-Queue pro Gerät
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
        issueGetOnConnect: false,
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
   * Serialisiert Operationen pro Gerät (verhindert parallele Zugriffe)
   */
  enqueue(deviceId, fn) {
    const last = this.queues.get(deviceId) || Promise.resolve();
    // .then(fn, fn) → läuft auch nach Fehler im vorherigen Job weiter
    const next = last.then(fn, fn);
    this.queues.set(deviceId, next);
    return next;
  }

  /**
   * connect() mit 5s Timeout (verhindert ewig hängende Verbindungen)
   */
  async safeConnect(device) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Connect Timeout nach ${CONNECT_TIMEOUT_MS}ms`));
      }, CONNECT_TIMEOUT_MS);

      device.connect()
        .then(() => { clearTimeout(timeout); resolve(); })
        .catch(err => { clearTimeout(timeout); reject(err); });
    });
  }

  /**
   * disconnect() ohne Fehlerwurf (für finally-Block)
   */
  async safeDisconnect(device) {
    try {
      await device.disconnect();
    } catch (_) {
      // Disconnect-Fehler ignorieren
    }
  }

  // ---------------------------------------------------------------------------
  // GET STATUS
  // ---------------------------------------------------------------------------
  async getStatus(deviceConfig) {
    return this.enqueue(deviceConfig.device_id, () =>
      this._getStatusWithRetry(deviceConfig, 0)
    );
  }

  async _getStatusWithRetry(deviceConfig, retryCount) {
    const device = this.getDevice(deviceConfig);

    try {
      await device.find();
      await this.safeConnect(device);

      const status = await device.get({ schema: true });
      const dps = status.dps || {};

      return {
        success: true,
        current_temp: (dps[DPS.CURRENT_TEMP] || 0) / 10,
        target_temp: (dps[DPS.TARGET_TEMP] || 0) / 10,
        is_heating: dps[DPS.HEATING] === true,
        mode: dps[DPS.MODE] || 'unknown',
        raw_dps: dps
      };
    } catch (error) {
      if (retryCount < this.maxRetries) {
        console.log(`[TuyAPI] ${deviceConfig.name} Status-Retry ${retryCount + 1}/${this.maxRetries} (${error.message})`);
        await this.safeDisconnect(device);
        await this.sleep(1000 * (retryCount + 1));
        return this._getStatusWithRetry(deviceConfig, retryCount + 1);
      }
      console.error(`[TuyAPI] ${deviceConfig.name} Status-Fehler nach ${this.maxRetries} Versuchen:`, error.message);
      return { success: false, error: error.message };
    } finally {
      await this.safeDisconnect(device);
    }
  }

  // ---------------------------------------------------------------------------
  // SET TEMPERATURE
  // ---------------------------------------------------------------------------
  async setTemperature(deviceConfig, temperature) {
    return this.enqueue(deviceConfig.device_id, () =>
      this._setTemperatureWithRetry(deviceConfig, temperature, 0)
    );
  }

  async _setTemperatureWithRetry(deviceConfig, temperature, retryCount) {
    const device = this.getDevice(deviceConfig);

    // TGP508 erwartet Temperatur × 10 (210 = 21.0°C), Bereich 5.0–35.0°C
    const tempValue = Math.round(temperature * 10);
    if (tempValue < 50 || tempValue > 350) {
      return {
        success: false,
        error: `Temperatur ${temperature}°C außerhalb des gültigen Bereichs (5–35°C)`
      };
    }

    try {
      await device.find();
      await this.safeConnect(device);

      // Erst Modus auf 'manual' (deaktiviert interne Zeitprogramme)
      await device.set({ dps: DPS.MODE, set: 'manual' });
      // Dann Zieltemperatur
      await device.set({ dps: DPS.TARGET_TEMP, set: tempValue });

      console.log(`[TuyAPI] ${deviceConfig.name}: Modus=manual, Temperatur=${temperature}°C gesetzt`);
      return { success: true };
    } catch (error) {
      if (retryCount < this.maxRetries) {
        console.log(`[TuyAPI] ${deviceConfig.name} Set-Retry ${retryCount + 1}/${this.maxRetries} (${error.message})`);
        await this.safeDisconnect(device);
        await this.sleep(1000 * (retryCount + 1));
        return this._setTemperatureWithRetry(deviceConfig, temperature, retryCount + 1);
      }
      console.error(`[TuyAPI] ${deviceConfig.name} Set-Fehler nach ${this.maxRetries} Versuchen:`, error.message);
      return { success: false, error: error.message };
    } finally {
      await this.safeDisconnect(device);
    }
  }

  // ---------------------------------------------------------------------------
  // SET MODE (auto/manual/off)
  // ---------------------------------------------------------------------------
  async setMode(deviceConfig, mode) {
    return this.enqueue(deviceConfig.device_id, () =>
      this._setModeWithRetry(deviceConfig, mode, 0)
    );
  }

  async _setModeWithRetry(deviceConfig, mode, retryCount) {
    const device = this.getDevice(deviceConfig);

    try {
      await device.find();
      await this.safeConnect(device);

      await device.set({ dps: DPS.MODE, set: mode });

      console.log(`[TuyAPI] ${deviceConfig.name}: Modus auf ${mode} gesetzt`);
      return { success: true };
    } catch (error) {
      if (retryCount < this.maxRetries) {
        console.log(`[TuyAPI] ${deviceConfig.name} Mode-Retry ${retryCount + 1}/${this.maxRetries} (${error.message})`);
        await this.safeDisconnect(device);
        await this.sleep(1000 * (retryCount + 1));
        return this._setModeWithRetry(deviceConfig, mode, retryCount + 1);
      }
      console.error(`[TuyAPI] ${deviceConfig.name} Mode-Fehler:`, error.message);
      return { success: false, error: error.message };
    } finally {
      await this.safeDisconnect(device);
    }
  }

  /**
   * Alle Verbindungen schließen (Shutdown)
   */
  async disconnectAll() {
    for (const [, device] of this.devices) {
      await this.safeDisconnect(device);
    }
    this.devices.clear();
    this.queues.clear();
    console.log('[TuyAPI] Alle Verbindungen geschlossen');
  }

  /**
   * Helper: Sleep-Funktion
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ThermostatController;
