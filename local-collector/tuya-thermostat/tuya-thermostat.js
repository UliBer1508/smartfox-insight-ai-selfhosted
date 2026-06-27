/**
 * TuyAPI-basierte lokale Thermostat-Steuerung v1.1
 * Kommuniziert direkt mit TGP508 Thermostaten über LAN (Port 6668)
 * 
 * Verbesserungen v1.1:
 * - Timeout pro Verbindung (10s) verhindert Hänger
 * - Frische Device-Instanz pro Aufruf (vermeidet Socket-Leichen)
 * - Fehler werden gefangen statt den Prozess zu crashen
 */

const TuyAPI = require('tuyapi');

// TGP508 Thermostat DPS-Mapping
// Alphanumerisch (primär) + numerisch (Fallback)
const DPS_CODES = {
  mode: '1',
  temp_set: '2',
  temp_current: '3',
  switch: '4'
};

const CONNECTION_TIMEOUT = 10000; // 10 Sekunden

class ThermostatController {
  constructor() {
    this.maxRetries = 2;
  }

  /**
   * Erstellt eine FRISCHE TuyAPI Device-Instanz pro Aufruf
   * Verhindert Socket-Leichen und ECONNRESET-Crashes
   */
  createDevice(deviceConfig, version) {
    // Protokollversion: pro Gerät aus config (protocol_version) oder Default 3.5.
    // Moderne TGP508-Firmware spricht 3.5; aeltere Geraete ggf. 3.3 (Auto-Fallback).
    const ver = version || deviceConfig.protocol_version || '3.5';
    const device = new TuyAPI({
      id: deviceConfig.device_id,
      key: deviceConfig.local_key,
      ip: deviceConfig.ip,
      version: ver,
      issueRefreshOnConnect: true
    });

    // Fehler abfangen statt Prozess crashen
    device.on('error', () => {});
    device.on('disconnected', () => {});

    return device;
  }

  /**
   * Timeout-Wrapper: Bricht Operation nach X ms ab
   */
  withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout nach ${ms / 1000}s: ${label}`)), ms)
      )
    ]);
  }

  /**
   * Sicheres Disconnect - ignoriert alle Fehler
   */
  async safeDisconnect(device) {
    try {
      device.disconnect();
    } catch (e) {
      // Ignorieren
    }
  }

  /**
   * Liest Status eines Thermostats
   */
  async getStatus(deviceConfig, retryCount = 0, version = null) {
    const ver = version || deviceConfig.protocol_version || '3.5';
    const device = this.createDevice(deviceConfig, ver);

    try {
      await this.withTimeout(
        device.find(),
        CONNECTION_TIMEOUT,
        `${deviceConfig.name} find`
      );

      await this.withTimeout(
        device.connect(),
        CONNECTION_TIMEOUT,
        `${deviceConfig.name} connect`
      );

      const status = await this.withTimeout(
        device.get({ schema: true }),
        CONNECTION_TIMEOUT,
        `${deviceConfig.name} get`
      );

      await this.safeDisconnect(device);

      const dps = status.dps || {};

      // Dual-Format: alphanumerisch oder numerisch
      const currentTemp = dps['temp_current'] ?? dps[DPS_CODES.temp_current] ?? dps['3'];
      const targetTemp = dps['temp_set'] ?? dps[DPS_CODES.temp_set] ?? dps['2'];
      const isHeating = dps['switch'] ?? dps[DPS_CODES.switch] ?? dps['4'];
      const mode = dps['mode'] ?? dps[DPS_CODES.mode] ?? dps['1'];

      return {
        success: true,
        current_temp: (currentTemp || 0) / 10,
        target_temp: (targetTemp || 0) / 10,
        is_heating: isHeating === true,
        mode: mode || 'unknown',
        protocol_version: ver,
        raw_dps: dps
      };
    } catch (error) {
      await this.safeDisconnect(device);

      // Auto-Fallback: beim ersten Fehlschlag mit 3.5 einmal 3.3 versuchen
      if (ver === '3.5' && retryCount === 0) {
        console.log(`  [Version] ${deviceConfig.name}: 3.5 fehlgeschlagen, versuche 3.3...`);
        return this.getStatus(deviceConfig, 0, '3.3');
      }

      if (retryCount < this.maxRetries) {
        console.log(`  [Retry] ${deviceConfig.name} ${retryCount + 1}/${this.maxRetries}...`);
        await this.sleep(2000 * (retryCount + 1));
        return this.getStatus(deviceConfig, retryCount + 1, ver);
      }

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Setzt Zieltemperatur eines Thermostats
   */
  async setTemperature(deviceConfig, temperature, retryCount = 0, version = null) {
    const ver = version || deviceConfig.protocol_version || '3.5';
    const device = this.createDevice(deviceConfig, ver);

    try {
      const tempValue = Math.round(temperature * 10);

      if (tempValue < 50 || tempValue > 350) {
        return { success: false, error: `Temperatur ${temperature}°C außerhalb 5-35°C` };
      }

      await this.withTimeout(device.find(), CONNECTION_TIMEOUT, `${deviceConfig.name} find`);
      await this.withTimeout(device.connect(), CONNECTION_TIMEOUT, `${deviceConfig.name} connect`);

      await this.withTimeout(
        device.set({ dps: DPS_CODES.temp_set, set: tempValue }),
        CONNECTION_TIMEOUT,
        `${deviceConfig.name} set`
      );

      await this.safeDisconnect(device);

      console.log(`  [OK] ${deviceConfig.name}: ${temperature}°C gesetzt`);
      return { success: true };
    } catch (error) {
      await this.safeDisconnect(device);

      if (ver === '3.5' && retryCount === 0) {
        console.log(`  [Version] ${deviceConfig.name} set: 3.5 fehlgeschlagen, versuche 3.3...`);
        return this.setTemperature(deviceConfig, temperature, 0, '3.3');
      }

      if (retryCount < this.maxRetries) {
        console.log(`  [Retry] ${deviceConfig.name} set ${retryCount + 1}/${this.maxRetries}...`);
        await this.sleep(2000 * (retryCount + 1));
        return this.setTemperature(deviceConfig, temperature, retryCount + 1, ver);
      }

      return { success: false, error: error.message };
    }
  }

  /**
   * Setzt Modus (auto/manual/off)
   */
  async setMode(deviceConfig, mode, retryCount = 0, version = null) {
    const ver = version || deviceConfig.protocol_version || '3.5';
    const device = this.createDevice(deviceConfig, ver);

    try {
      await this.withTimeout(device.find(), CONNECTION_TIMEOUT, `${deviceConfig.name} find`);
      await this.withTimeout(device.connect(), CONNECTION_TIMEOUT, `${deviceConfig.name} connect`);

      await this.withTimeout(
        device.set({ dps: DPS_CODES.mode, set: mode }),
        CONNECTION_TIMEOUT,
        `${deviceConfig.name} setMode`
      );

      await this.safeDisconnect(device);

      console.log(`  [OK] ${deviceConfig.name}: Modus ${mode}`);
      return { success: true };
    } catch (error) {
      await this.safeDisconnect(device);

      if (ver === '3.5' && retryCount === 0) {
        console.log(`  [Version] ${deviceConfig.name} setMode: 3.5 fehlgeschlagen, versuche 3.3...`);
        return this.setMode(deviceConfig, mode, 0, '3.3');
      }

      if (retryCount < this.maxRetries) {
        await this.sleep(2000 * (retryCount + 1));
        return this.setMode(deviceConfig, mode, retryCount + 1, ver);
      }

      return { success: false, error: error.message };
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Shutdown-Hook: Diese Version hält keine persistenten Verbindungen
   * (jede Operation trennt selbst via safeDisconnect). Daher hier nichts
   * zu schließen – Methode existiert nur, damit der Collector beim Beenden
   * nicht crasht.
   */
  async disconnectAll() {
    console.log('[TuyAPI] Keine persistenten Verbindungen – nichts zu trennen');
  }
}

module.exports = ThermostatController;
