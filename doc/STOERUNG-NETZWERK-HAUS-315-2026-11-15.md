# Störung Netzwerk Haus 315 – Thermostate und Fronius weg (15.11.2026)

**Kurz:** Nach einem Router-Neustart meldeten sich 11 Thermostate nicht mehr im WLAN. Beim Suchen wurde der
NICGIGA-Switch neu gestartet – dabei griff der Extend-Schalter, und der PC erreichte nichts mehr im Hausnetz
(auch den Fronius nicht). Beides behoben; dazu Thermostat Büro (seit 07.11. offline) wiedergefunden.

---

## 1. Wie das Netz in Haus 315 aufgebaut ist

| Teil | Was | Adresse |
|---|---|---|
| FRITZ!Box | Router, DHCP, Internet | 192.168.188.1 |
| Österreich-PC | Dienste SmartfoxTuya, SmartfoxFronius, Wallbox-Backend … (per Kabel) | 192.168.188.34 |
| NICGIGA-Switch (26 Port, PoE) | im Verteilerschrank neben „Boiler“; versorgt u. a. die Accesspoints | – |
| Cambium cnPilot e410 | WLAN-Accesspoints, verwaltet in cnMaestro: **315-Bue** (Büro OG, .102), **315-UG** (.101), 316-EG (.103), 316-OG (.104) | |
| WLAN | **„Venediger Privat“** (2,4 + 5 GHz, WPA2-PSK) und „Venediger Gast“ | |
| Thermostate (12 × Tuya) | im WLAN „Venediger Privat“, MAC beginnt mit **3C:0B:59**, Hostname „lwip0“ | siehe Tabelle unten |
| Fronius | Wechselrichter/Datamanager | 192.168.188.64 |

Die FRITZ!Box zeigt die Thermostate als „LAN“-Geräte, weil sie über die Cambium-Accesspoints (per Kabel) ins Netz kommen.

**Rote Power-LED am NICGIGA ist normal.**

### Thermostat-Adressen (Stand 15.11.2026)

| Raum | IP | MAC |
|---|---|---|
| Zimmer Luis | .27 | 3c-0b-59-bd-81-f1 |
| Büro | **.74** (vorher .42) | 3c-0b-59-bd-8d-07 |
| Wirtschaftsraum | .78 | 3c-0b-59-bd-83-e1 |
| Kinder Bad | .108 | 3c-0b-59-bd-79-90 |
| Haustür | **.137** (in der DB stand .174) | 3c-0b-59-bd-80-66 |
| Waschraum | .157 | 3c-0b-59-bd-b6-17 |
| Flur | .161 | 3c-0b-59-bd-8c-61 |
| Wohnzimmer | .165 | 3c-0b-59-bd-89-89 |
| Zimmer Uli | .173 | 3c-0b-59-bd-81-96 |
| Toilette Eingang | .176 (ganz oben, schwaches Signal −83 dBm – normal) | 3c-0b-59-bd-80-f8 |
| Bad Uli | .180 | 3c-0b-59-bd-b2-e0 |
| Zimmer Luca | .197 | 3c-0b-59-bd-73-f0 |

Die Steuerung nimmt die Adressen aus `C:\Users\ulibe\tuya-thermostat\config.json`; `rooms.thermostat_local_ip`
ist nur Anzeige – beide gleich halten. In der FRITZ!Box bei jedem Thermostat „IPv4-Adresse dauerhaft zuweisen“.

---

## 2. Was am 15.11. passiert ist

| Zeit | Ereignis | Folge |
|---|---|---|
| 07:33 | FRITZ!Box neu gestartet; Accesspoints starten mit (Stromunterbrechung) | 11 Thermostate melden sich danach **nicht wieder an** – sie suchen das WLAN nicht mehr. Nur Toilette Eingang kommt zurück. |
| 07:55 | Alarm-Mails (system-alert) je Thermostat | |
| 09:09 | NICGIGA-Switch neu gestartet (Verdacht auf Switch) | Extend-Schalter stand auf **ON** → wirkt erst beim Einschalten → Anschlüsse voneinander abgeschottet. PC kommt ins Internet, aber nicht mehr zu Fronius und Thermostaten. Fronius-Daten fehlen ab 09:09. |
| ~09:57 | alle FI aus und wieder an | Thermostate wieder im WLAN (in cnMaestro sichtbar) – aber der PC erreicht sie wegen Extend nicht |
| 10:33 | Extend-Schalter auf **OFF**, Switch neu gestartet | Fronius und 11/12 Thermostate wieder da |
| 10:45 | Büro: neue IP .74 in config.json, Dienst neu gestartet | **12/12** |

Nicht die Ursache (geprüft): Tuya-Cloud (IoT-Core-Testphase abgelaufen, Verlängerung beantragt – betrifft nur den
Cloud-Notweg), Dienste auf dem PC (liefen die ganze Zeit), WLAN-Einstellungen (Kanal 11, WPA2, keine Client Isolation).

---

## 3. Anleitung: Thermostate oder Fronius plötzlich weg

1. **Systemstatus** in der Heizungs-App (oben rechts „x Probleme“): Seit wann? Gleiche Minute bei allen = Netz, nicht Gerät.
2. **Am PC prüfen, ob er die Geräte erreicht:**
   ```
   ping 192.168.188.1        # FRITZ!Box
   ping 192.168.188.102      # Accesspoint Büro
   ping 192.168.188.176      # ein Thermostat
   ping 192.168.188.64       # Fronius
   ```
   FRITZ!Box ja, Rest nein → **Switch/Extend-Schalter** (Schritt 4).
3. **cnMaestro → Devices → AP → Clients:** Stehen die Thermostate (3C:0B:59…) unter „Wireless Clients“?
   - **Ja** → sie sind im WLAN, Problem liegt zwischen PC und WLAN → Schritt 2/4.
   - **Nein** (auch nicht unter „Unconnected Clients“) → Thermostate hängen → **Stromneustart: alle FI kurz aus, 10 s, wieder an** (es gibt keine eigenen Sicherungen für die Thermostate). Danach etwa 5 min warten.
4. **NICGIGA-Extend-Schalter muss auf OFF stehen.** Nach dem Umstellen den Switch kurz vom Strom trennen – er liest den Schalter nur beim Einschalten.
5. **Einzelnes Thermostat weg, in der App aber online** → IP gewechselt. Am PC:
   ```
   1..254 | ForEach-Object { ping -n 1 -w 100 192.168.188.$_ > $null }
   arp -a | findstr "3c-0b-59"
   ```
   Die unbekannte Zeile ist das gesuchte Thermostat. Adresse in `config.json` ändern (ohne BOM speichern!), `Restart-Service SmartfoxTuya`, in der FRITZ!Box fest zuweisen.
   ```
   $p='C:\Users\ulibe\tuya-thermostat\config.json'; Copy-Item $p "$p.bak"
   $t=[IO.File]::ReadAllText($p); [IO.File]::WriteAllText($p, $t.Replace('"ALT"','"NEU"'))
   ```
6. **Nicht** die Thermostate in der Smart-Life-App neu koppeln: dabei bekommen sie neue Local Keys, und die Steuerung kann sie nicht mehr ansprechen.

**Vorbeugen:** Router nur neu starten, wenn nötig – danach im Systemstatus prüfen, ob alle Thermostate zurück sind.

---

## 4. Datenbank-Hinweis

`rooms.thermostat_local_ip` ist durch den Trigger `protect_rooms_sensitive_columns` geschützt: Ohne JWT-Rolle
(z. B. SQL über das Supabase-MCP) wird die Änderung **still zurückgesetzt**. So ändern:
```sql
begin;
select set_config('request.jwt.claims','{"role":"service_role"}', true);
update rooms set thermostat_local_ip = '192.168.188.74' where name = 'Büro';
commit;
```
