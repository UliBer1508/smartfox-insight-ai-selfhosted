#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Lokaler Datensammler für Smartfox & Fronius
Sammelt Energiedaten und speichert sie in der Cloud-Datenbank.
"""

import json
import time
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from supabase import create_client, Client


def load_config() -> dict:
    """Lädt die Konfiguration aus config.json"""
    config_path = Path(__file__).parent / "config.json"
    
    if not config_path.exists():
        print("❌ Fehler: config.json nicht gefunden!")
        print("   Bitte kopiere config.example.json zu config.json und passe die Werte an.")
        sys.exit(1)
    
    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


def fetch_smartfox(ip: str) -> dict | None:
    """
    Holt Daten vom Smartfox Energy Manager.
    
    Returns:
        dict mit power_io, energy_in, energy_out, pv_power, consumption
        oder None bei Fehler
    """
    try:
        url = f"http://{ip}/all"
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        # Smartfox /all Endpunkt Datenstruktur
        power_in = data.get("power_in", 0) or 0
        power_out = data.get("power_out", 0) or 0
        power_io = power_out - power_in  # Positiv = Einspeisung, Negativ = Bezug
        
        # PV-Leistung (Array mit Werten pro Tracker)
        pv_power_array = data.get("PvPower", [])
        pv_power = sum(pv_power_array) if pv_power_array else 0
        
        # PV-Energie
        pv_energy_array = data.get("PvEnergy", [])
        pv_energy = sum(pv_energy_array) if pv_energy_array else 0
        
        # Verbrauch berechnen: PV-Produktion + Netzbezug - Einspeisung
        consumption = pv_power + power_in - power_out
        
        return {
            "power_io": power_io,
            "energy_in": data.get("energy_in", 0) or 0,
            "energy_out": data.get("energy_out", 0) or 0,
            "pv_power": pv_power,
            "pv_energy": pv_energy,
            "consumption": max(0, consumption),  # Mindestens 0
            "power_smartfox": data.get("power_sf", 0) or 0,
            "relay_status": data.get("outputs", []),
        }
        
    except requests.exceptions.Timeout:
        print(f"⚠️  Smartfox Timeout ({ip})")
        return None
    except requests.exceptions.ConnectionError:
        print(f"⚠️  Smartfox nicht erreichbar ({ip})")
        return None
    except Exception as e:
        print(f"⚠️  Smartfox Fehler: {e}")
        return None


def fetch_fronius_data(ip: str) -> dict | None:
    """
    Holt Batterie-Daten vom Fronius Wechselrichter.
    
    Returns:
        dict mit battery_soc und battery_power oder None bei Fehler
    """
    try:
        url = f"http://{ip}/solar_api/v1/GetPowerFlowRealtimeData.fcgi"
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        # Fronius PowerFlow API Struktur
        site_data = data.get("Body", {}).get("Data", {}).get("Site", {})
        inverters = data.get("Body", {}).get("Data", {}).get("Inverters", {})
        
        # Battery SOC
        battery_soc = site_data.get("SOC")
        if battery_soc is None:
            for inv_id, inv_data in inverters.items():
                if "SOC" in inv_data:
                    battery_soc = float(inv_data["SOC"])
                    break
        
        # Battery Power (P_Akku): positiv = laden, negativ = entladen
        battery_power = site_data.get("P_Akku")
        
        # Debug-Logging
        print(f"📋 Fronius Raw: P_Akku={battery_power}, SOC={battery_soc}")
        
        return {
            "battery_soc": float(battery_soc) if battery_soc is not None else None,
            "battery_power": float(battery_power) if battery_power is not None else None
        }
        
    except requests.exceptions.Timeout:
        print(f"⚠️  Fronius Timeout ({ip})")
        return None
    except requests.exceptions.ConnectionError:
        print(f"⚠️  Fronius nicht erreichbar ({ip})")
        return None
    except Exception as e:
        print(f"⚠️  Fronius Fehler: {e}")
        return None


def save_reading(supabase: Client, smartfox_data: dict, fronius_data: dict | None) -> bool:
    """
    Speichert einen Messwert in der Datenbank.
    
    Returns:
        True bei Erfolg, False bei Fehler
    """
    try:
        reading = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "power_io": smartfox_data["power_io"],
            "energy_in": smartfox_data["energy_in"],
            "energy_out": smartfox_data["energy_out"],
            "pv_power": smartfox_data["pv_power"],
            "consumption": smartfox_data["consumption"],
            "battery_soc": fronius_data["battery_soc"] if fronius_data else None,
            "battery_power": fronius_data["battery_power"] if fronius_data else None,
        }
        
        supabase.table("energy_readings").insert(reading).execute()
        return True
        
    except Exception as e:
        print(f"❌ Datenbank-Fehler: {e}")
        return False


def main():
    """Hauptprogramm"""
    print("=" * 50)
    print("🔌 Smartfox & Fronius Datensammler")
    print("=" * 50)
    
    # Konfiguration laden
    config = load_config()
    
    smartfox_ip = config.get("smartfox_ip", "192.168.188.45")
    fronius_ip = config.get("fronius_ip", "192.168.188.64")
    polling_interval = config.get("polling_interval", 30)
    supabase_url = config.get("supabase_url")
    supabase_key = config.get("supabase_key")
    
    if not supabase_url or not supabase_key:
        print("❌ Fehler: supabase_url und supabase_key müssen in config.json gesetzt sein!")
        sys.exit(1)
    
    print(f"📡 Smartfox IP: {smartfox_ip}")
    print(f"🔋 Fronius IP:  {fronius_ip}")
    print(f"⏱️  Intervall:   {polling_interval} Sekunden")
    print("-" * 50)
    
    # Supabase Client erstellen
    try:
        supabase: Client = create_client(supabase_url, supabase_key)
        print("✅ Datenbank-Verbindung hergestellt")
    except Exception as e:
        print(f"❌ Datenbank-Verbindung fehlgeschlagen: {e}")
        sys.exit(1)
    
    # Initiale Verbindungstests
    print("\n🔍 Teste Verbindungen...")
    
    smartfox_data = fetch_smartfox(smartfox_ip)
    if smartfox_data:
        print(f"✅ Smartfox OK - PV: {smartfox_data['pv_power']}W, Netz: {smartfox_data['power_io']}W")
    else:
        print("⚠️  Smartfox nicht erreichbar - wird weiter versucht...")
    
    fronius_data = fetch_fronius_data(fronius_ip)
    if fronius_data:
        soc_str = f"{fronius_data['battery_soc']:.1f}%" if fronius_data['battery_soc'] else "N/A"
        power_str = f"{fronius_data['battery_power']:.0f}W" if fronius_data['battery_power'] else "N/A"
        print(f"✅ Fronius OK - Batterie: {soc_str}, Power: {power_str}")
    else:
        print("⚠️  Fronius nicht erreichbar - wird weiter versucht...")
    
    print("-" * 50)
    print("🚀 Starte Datensammlung... (Strg+C zum Beenden)")
    print()
    
    # Hauptschleife
    success_count = 0
    error_count = 0
    consecutive_errors = 0
    BACKOFF_THRESHOLD = 5          # ab so vielen Fehlern in Folge
    BACKOFF_INTERVAL = 300         # max. Intervall in Sekunden (5 min)

    try:
        while True:
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            # Daten abrufen
            smartfox_data = fetch_smartfox(smartfox_ip)
            fronius_data = fetch_fronius_data(fronius_ip)

            if smartfox_data:
                # Daten speichern
                if save_reading(supabase, smartfox_data, fronius_data):
                    success_count += 1
                    if consecutive_errors >= BACKOFF_THRESHOLD:
                        print(f"[{timestamp}] ✅ Verbindung wiederhergestellt – normales Intervall")
                    consecutive_errors = 0
                    battery_str = f"{fronius_data['battery_soc']:.0f}%" if fronius_data and fronius_data['battery_soc'] else "N/A"
                    power_str = f"{fronius_data['battery_power']:+.0f}W" if fronius_data and fronius_data['battery_power'] else "N/A"
                    print(
                        f"[{timestamp}] ✅ "
                        f"PV: {smartfox_data['pv_power']:>5.0f}W | "
                        f"Netz: {smartfox_data['power_io']:>+6.0f}W | "
                        f"Verbr: {smartfox_data['consumption']:>5.0f}W | "
                        f"Batt: {battery_str:>4} ({power_str})"
                    )
                else:
                    error_count += 1
                    consecutive_errors += 1
            else:
                error_count += 1
                consecutive_errors += 1
                # Bei vielen Fehlern in Folge nur noch einmalig loggen pro Backoff-Intervall
                if consecutive_errors == BACKOFF_THRESHOLD:
                    print(f"[{timestamp}] ⏸️  {BACKOFF_THRESHOLD} Fehler in Folge – wechsle auf Backoff-Intervall ({BACKOFF_INTERVAL}s)")
                elif consecutive_errors < BACKOFF_THRESHOLD:
                    print(f"[{timestamp}] ⚠️  Keine Smartfox-Daten")

            # Status alle 10 Messungen
            total = success_count + error_count
            if total > 0 and total % 10 == 0:
                rate = (success_count / total) * 100
                print(f"    📊 Erfolgsrate: {rate:.1f}% ({success_count}/{total})")

            # Sleep mit Backoff: ab BACKOFF_THRESHOLD Fehlern auf BACKOFF_INTERVAL
            sleep_seconds = BACKOFF_INTERVAL if consecutive_errors >= BACKOFF_THRESHOLD else polling_interval
            time.sleep(sleep_seconds)
            
    except KeyboardInterrupt:
        print("\n")
        print("-" * 50)
        print("👋 Datensammlung beendet")
        print(f"   Erfolgreiche Messungen: {success_count}")
        print(f"   Fehlgeschlagene:        {error_count}")


if __name__ == "__main__":
    main()
