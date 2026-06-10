/**
 * TuyAPI-basierte lokale Thermostat-Steuerung (Hybrid v3)
 * Kommuniziert direkt mit TGP508 Thermostaten über LAN (Port 6668)
 *
 * Robustheits-Features v3:
 * - Persistente Verbindungen (kein Connect/Disconnect pro Befehl)
 * - Kein UDP find() — IP wird direkt aus Config genutzt
 * - issueRefreshOnConnect: false (verhindert Session-Drops)
 * - Operation-Timeout (3s) per Promise.race
 * - Atomic SET via {multiple: true} (mode + temp in 1 Roundtrip)
 * - Per-Device Command-Queue (serialisiert parallele Zugriffe)
 * - 2 Retries mit Backoff (1s, 2s) und Force-Reconnect bei Fehler
 */

const TuyAPI = require('tuyapi');

// TGP508 Thermostat DPS-Mapping
const DPS = {
  MODE: '1',           // auto/manual/off
  TARGET_TEMP: '2',    // x10
  CURRENT_TEMP: '3',   // x10
  HEATING: '4'         // boolean read-only
};

const CONNECT_TIMEOUT_MS = 5000;
const OP_TIMEOUT_MS = 3000;
const MAX_RETRIES = 2;

// Protokoll-Versionen, die bei Connect-Fehler automatisch durchprobiert werden.
// Firmware-OTAs heben TGP508 teils von 3.3 auf 3.4/3.5 — dann scheitert der
// Handshake mit fester Version als "connection timed out", obwohl Port 6668 offen ist.
const VERSION_CANDIDATES = ['3.3', '3.4', '3.5'];
const DEFAULT_VERSION = '3.3';


class ThermostatController {
  constructor() {
    this.devices = new Map();    // device_id -> TuyAPI instance
    this.connected = new Map();  // device_id -> boolean
    this.queues = new Map();     // device_id -> Promise chain
  }

  /**
   * Holt oder erstellt persistente TuyAPI Device-Instanz.
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
        issueRefreshOnConnect: false  // verhindert Session-Drops
      });

      device.on('error', (error) => {
        console.error(`[TuyAPI] ${deviceConfig.name} Fehler:`, error.message);
        this.connected.set(key, false);
      });

      device.on('disconnected', () => {
        console.log(`[TuyAPI] ${deviceConfig.name} getrennt`);
        this.connected.set(key, false);
      });

      device.on('connected', () => {
        this.connected.set(key, true);
      });

      this.devices.set(key, device);
      this.connected.set(key, false);
    }

    return this.devices.get(key);
  }

  /**
   * Serialisiert Operationen pro Gerät.
   */
  enqueue(deviceId, fn) {
    const last = this.queues.get(deviceId) || Promise.resolve();
    const next = last.then(fn, fn);
    this.queues.set(deviceId, next);
    return next;
  }

  /**
   * Promise.race mit Timeout.
   */
  withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Timeout nach ${ms}ms: ${label}`)), ms);
      promise.then(
        (v) => { clearTimeout(t); resolve(v); },
        (e) => { clearTimeout(t); reject(e); }
      );
    });
  }

  /**
   * Stellt sicher, dass das Gerät verbunden ist (persistente Connection).
   * Reconnect nur, wenn nicht verbunden.
   */
  async ensureConnected(device, deviceConfig) {
    const key = deviceConfig.device_id;
    if (this.connected.get(key) && device.isConnected && device.isConnected()) {
      return;
    }
    await this.withTimeout(device.connect(), CONNECT_TIMEOUT_MS, `${deviceConfig.name} connect`);
    this.connected.set(key, true);
  }

  /**
   * Forciert Disconnect (z.B. nach Fehler, vor Retry).
   */
  async forceDisconnect(device, deviceConfig) {
    try { await device.disconnect(); } catch (_) {}
    this.connected.set(deviceConfig.device_id, false);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
      await this.ensureConnected(device, deviceConfig);
      const status = await this.withTimeout(
        device.get({ schema: true }),
        OP_TIMEOUT_MS,
        `${deviceConfig.name} get`
      );
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
      await this.forceDisconnect(device, deviceConfig);
      if (retryCount < MAX_RETRIES) {
        console.log(`[TuyAPI] ${deviceConfig.name} Status-Retry ${retryCount + 1}/${MAX_RETRIES} (${error.message})`);
        await this.sleep(1000 * (retryCount + 1));
        return this._getStatusWithRetry(deviceConfig, retryCount + 1);
      }
      console.error(`[TuyAPI] ${deviceConfig.name} Status-Fehler nach ${MAX_RETRIES} Retries:`, error.message);
      return { success: false, error: error.message };
    }
  }

  // ---------------------------------------------------------------------------
  // SET TEMPERATURE (Atomic: mode + target in 1 Roundtrip)
  // ---------------------------------------------------------------------------
  async setTemperature(deviceConfig, temperature) {
    return this.enqueue(deviceConfig.device_id, () =>
      this._setTemperatureWithRetry(deviceConfig, temperature, 0)
    );
  }

  async _setTemperatureWithRetry(deviceConfig, temperature, retryCount) {
    const device = this.getDevice(deviceConfig);

    const tempValue = Math.round(temperature * 10);
    if (tempValue < 50 || tempValue > 350) {
      return {
        success: false,
        error: `Temperatur ${temperature}°C außerhalb Bereich (5–35°C)`
      };
    }

    try {
      await this.ensureConnected(device, deviceConfig);

      // Atomic SET: mode=manual + target_temp in einem Roundtrip
      await this.withTimeout(
        device.set({
          multiple: true,
          data: {
            [DPS.MODE]: 'manual',
            [DPS.TARGET_TEMP]: tempValue
          }
        }),
        OP_TIMEOUT_MS,
        `${deviceConfig.name} set temp`
      );

      console.log(`[TuyAPI] ${deviceConfig.name}: manual + ${temperature}°C (atomic)`);
      return { success: true };
    } catch (error) {
      await this.forceDisconnect(device, deviceConfig);
      if (retryCount < MAX_RETRIES) {
        console.log(`[TuyAPI] ${deviceConfig.name} Set-Retry ${retryCount + 1}/${MAX_RETRIES} (${error.message})`);
        await this.sleep(1000 * (retryCount + 1));
        return this._setTemperatureWithRetry(deviceConfig, temperature, retryCount + 1);
      }
      console.error(`[TuyAPI] ${deviceConfig.name} Set-Fehler nach ${MAX_RETRIES} Retries:`, error.message);
      return { success: false, error: error.message };
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
      await this.ensureConnected(device, deviceConfig);
      await this.withTimeout(
        device.set({ dps: DPS.MODE, set: mode }),
        OP_TIMEOUT_MS,
        `${deviceConfig.name} set mode`
      );

      console.log(`[TuyAPI] ${deviceConfig.name}: Modus=${mode}`);
      return { success: true };
    } catch (error) {
      await this.forceDisconnect(device, deviceConfig);
      if (retryCount < MAX_RETRIES) {
        console.log(`[TuyAPI] ${deviceConfig.name} Mode-Retry ${retryCount + 1}/${MAX_RETRIES} (${error.message})`);
        await this.sleep(1000 * (retryCount + 1));
        return this._setModeWithRetry(deviceConfig, mode, retryCount + 1);
      }
      console.error(`[TuyAPI] ${deviceConfig.name} Mode-Fehler:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Alle Verbindungen schließen (Shutdown).
   */
  async disconnectAll() {
    for (const [key, device] of this.devices) {
      try { await device.disconnect(); } catch (_) {}
      this.connected.set(key, false);
    }
    this.devices.clear();
    this.connected.clear();
    this.queues.clear();
    console.log('[TuyAPI] Alle Verbindungen geschlossen');
  }
}

module.exports = ThermostatController;
