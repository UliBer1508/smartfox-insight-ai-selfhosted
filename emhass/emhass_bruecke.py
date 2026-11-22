# EMHASS-Brücke (22.11.2026) – doc/EMHASS-VERGLEICH-2026-11-22.md
# Läuft auf dem Österreich-PC in C:\EMHASS, jeden Morgen 03:45 (Aufgabenplanung „EMHASS Vergleich“).
#   1. holt beim Heizplaner (Supabase) die Daten des Vortags im EMHASS-Format  (aktion emhass_eingabe)
#   2. lässt EMHASS den Plan rechnen                                               (naive-mpc-optim, HiGHS)
#   3. schickt den Plan zurück; der Heizplaner bewertet ihn mit unserem Maßstab     (aktion emhass_bewerten)
#   4. (seit 22.11.2026) Prüfstein für unseren Planer: holt dasselbe Planungsproblem als LP (aktion highs_eingabe),
#      löst es mit HiGHS (highspy, kommt mit EMHASS) und schickt die Lösung zur Bewertung (aktion highs_bewerten).
#      doc/FIX-PLANER-HIGHS-2026-11-22.md – in der Cloud wäre das zu langsam (40–110 s je Tag).
# Aufruf:  venv\Scripts\python.exe emhass_bruecke.py                 → gestern
#          venv\Scripts\python.exe emhass_bruecke.py --tage 7        → die letzten 7 Tage (Nachtrag)
#          venv\Scripts\python.exe emhass_bruecke.py --tag 2026-11-20
# Nur Python-Standardbibliothek + EMHASS (im venv). Supabase-URL und Schlüssel liest sie aus dem Fronius-Dienst
# (C:\Users\ulibe\smartfox-collector\config.json) oder, falls vorhanden, aus bruecke.json.
import argparse, csv, datetime, json, logging, pathlib, subprocess, sys, time, urllib.request

ORDNER = pathlib.Path(__file__).resolve().parent
LAEUFE = ORDNER / "laeufe"
LOG = ORDNER / "bruecke.log"
logging.basicConfig(filename=LOG, level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", encoding="utf-8")
log = logging.getLogger("bruecke")

# Listen in der EMHASS-Konfiguration, die je Raum (= „deferrable load“) einen Eintrag brauchen
JE_RAUM = {
    "minimum_power_of_deferrable_loads": 0, "operating_hours_of_each_deferrable_load": 0,
    "start_timesteps_of_each_deferrable_load": 0, "end_timesteps_of_each_deferrable_load": 0,
    "treat_deferrable_load_as_semi_cont": True, "set_deferrable_load_single_constant": False,
    "set_deferrable_startup_penalty": 0.0, "is_electric_load": True, "cost_forecast_per_deferrable_load": None,
    "deferrable_load_max_cost": 0.0, "set_deferrable_max_startups": 0, "def_minimum_on_time": 0, "def_minimum_off_time": 0,
}


def melde(text):
    print(text)
    log.info(text)


def heizplaner(einst, body):
    req = urllib.request.Request(
        einst["supabase_url"].rstrip("/") + "/functions/v1/heizplaner", data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + einst["supabase_key"],
                 "apikey": einst["supabase_key"]}, method="POST")
    with urllib.request.urlopen(req, timeout=150) as r:
        return json.loads(r.read().decode("utf-8"))


def emhass_rechnen(eingabe, tag):
    lauf = LAEUFE / tag
    (lauf / "data").mkdir(parents=True, exist_ok=True)
    cfg = json.loads((ORDNER / "basis_config.json").read_text(encoding="utf-8"))
    cfg.update(eingabe["config"])
    n = int(eingabe["config"]["number_of_deferrable_loads"])
    for k, v in JE_RAUM.items():
        cfg[k] = [v] * n
    (lauf / "config.json").write_text(json.dumps(cfg, indent=1, ensure_ascii=False), encoding="utf-8")
    (lauf / "runtime.json").write_text(json.dumps(eingabe["runtime"]), encoding="utf-8")
    exe = ORDNER / "venv" / ("Scripts/emhass.exe" if sys.platform == "win32" else "bin/emhass")
    befehl = [str(exe), "--action", "naive-mpc-optim", "--config", str(lauf / "config.json"),
              "--secrets", str(ORDNER / "secrets_emhass.yaml"), "--data", str(lauf / "data"), "--costfun", "cost",
              "--runtimeparams", json.dumps(eingabe["runtime"])]
    t0 = time.time()
    r = subprocess.run(befehl, capture_output=True, text=True, encoding="utf-8", errors="replace")
    (lauf / "emhass.log").write_text(r.stdout + r.stderr, encoding="utf-8")
    if r.returncode != 0:
        raise RuntimeError("EMHASS-Fehler: " + " | ".join((r.stdout + r.stderr).splitlines()[-5:]))
    zeilen = list(csv.DictReader(open(lauf / "data" / "opt_res_latest.csv", encoding="utf-8")))
    leistung = [[round(float(z.get(f"P_deferrable{k}", 0) or 0)) for z in zeilen] for k in range(n)]
    return {"raeume": eingabe["raeume"], "leistung_w": leistung, "status": zeilen[0].get("optim_status") if zeilen else None,
            "rechenzeit_s": round(time.time() - t0, 1)}


HIGHS_ZEITLIMIT_S = 300        # je Tag; Probe 22.11.2026: 40–110 s bis 0,5 % Abstand zum Optimum


def highs_tag(einst, tag):
    import highspy                                                # im venv (Abhängigkeit von EMHASS)
    eingabe = heizplaner(einst, {"aktion": "highs_eingabe", "tag": tag})
    if not eingabe.get("ok"):
        melde(f"{tag}: HiGHS übersprungen – {eingabe.get('grund') or eingabe.get('error')}")
        return False
    lauf = LAEUFE / tag
    lauf.mkdir(parents=True, exist_ok=True)
    lp_datei = lauf / "planer.lp"
    lp_datei.write_text(eingabe["lp"], encoding="utf-8")
    h = highspy.Highs()
    h.setOptionValue("log_to_console", False)                     # Protokoll nur in die Datei
    h.setOptionValue("time_limit", float(HIGHS_ZEITLIMIT_S))
    h.setOptionValue("mip_rel_gap", 0.005)
    h.setOptionValue("log_file", str(lauf / "highs.log"))
    h.readModel(str(lp_datei))
    t0 = time.time()
    h.run()
    status = h.modelStatusToString(h.getModelStatus())
    info = h.getInfo()
    if info.primal_solution_status != 2:                          # 2 = gültige Lösung vorhanden
        raise RuntimeError(f"HiGHS ohne Lösung (Status {status}) – siehe laeufe\\{tag}\\highs.log")
    werte = h.getSolution().col_value
    lp = h.getLp()
    namen = [h.getColName(i)[1] for i in range(lp.num_col_)]
    heiz = {n: round(werte[i], 3) for i, n in enumerate(namen) if n.startswith(("hn", "hp"))}
    erg = heizplaner(einst, {"aktion": "highs_bewerten", "tag": tag, "werte": heiz, "status": status,
                             "luecke": round(info.mip_gap, 4), "rechenzeit_s": round(time.time() - t0, 1)})
    e = erg.get("planer_highs") or {}
    melde(f"{tag}: Planer HiGHS {status} in {round(time.time() - t0)} s (Abstand {info.mip_gap:.1%}) – Netz {e.get('netz_kwh')} kWh "
          f"(bereinigt {e.get('netz_bereinigt_kwh')}), unter Min {e.get('unter_grenze_gradstd')} °C·h")
    return True


def ein_tag(einst, tag):
    eingabe = heizplaner(einst, {"aktion": "emhass_eingabe", "tag": tag})
    if not eingabe.get("ok"):
        melde(f"{tag}: übersprungen – {eingabe.get('grund') or eingabe.get('error')}")
        return False
    plan = emhass_rechnen(eingabe, tag)
    if plan["status"] != "Optimal":                               # keine Lösung → nichts bewerten, im Log melden
        raise RuntimeError(f"EMHASS ohne Lösung (Status {plan['status']}) – siehe laeufe\\{tag}\\emhass.log")
    begrenzt = [f"{r['name']} {r['min_begrenzt']} °C" for r in eingabe["raeume"] if r.get("min_begrenzt") is not None]
    if begrenzt:
        melde(f"{tag}: Min laut Modell nicht haltbar, für EMHASS begrenzt: {', '.join(begrenzt)}")
    erg = heizplaner(einst, {"aktion": "emhass_bewerten", "tag": tag, "plan": plan})
    e = erg.get("emhass") or {}
    melde(f"{tag}: EMHASS {plan['status']} in {plan['rechenzeit_s']} s – Netz {e.get('netz_kwh')} kWh "
          f"(bereinigt {e.get('netz_bereinigt_kwh')}), unter Min {e.get('unter_grenze_gradstd')} °C·h")
    return True


def einstellungen():
    """Supabase-URL und Schlüssel: bruecke.json, sonst wie der Fronius-Dienst (smartfox-collector\\config.json)."""
    eigen = ORDNER / "bruecke.json"
    if eigen.exists():
        return json.loads(eigen.read_text(encoding="utf-8"))
    collector = pathlib.Path.home() / "smartfox-collector" / "config.json"
    for kandidat in (collector, pathlib.Path(r"C:\Users\ulibe\smartfox-collector\config.json")):
        if kandidat.exists():
            sb = json.loads(kandidat.read_text(encoding="utf-8-sig"))["supabase"]
            return {"supabase_url": sb["url"], "supabase_key": sb.get("service_role_key") or sb["anon_key"]}
    raise RuntimeError("Weder bruecke.json noch smartfox-collector\\config.json gefunden")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag")
    ap.add_argument("--tage", type=int, default=1)
    args = ap.parse_args()
    einst = einstellungen()
    heute = datetime.date.today()
    # Einmaliger Nachtrag ohne Hand am PC (22.11.2026): steht in nachrechnen.txt eine Zahl, rechnet der nächste
    # geplante Lauf so viele Tage und löscht die Datei danach.
    marke = ORDNER / "nachrechnen.txt"
    if not args.tag and args.tage == 1 and marke.exists():
        try:
            args.tage = max(1, min(14, int(marke.read_text(encoding="utf-8").strip() or "1")))
            melde(f"Nachtrag laut nachrechnen.txt: {args.tage} Tage")
        except ValueError:
            pass
        marke.unlink(missing_ok=True)
    tage = [args.tag] if args.tag else [(heute - datetime.timedelta(days=i)).isoformat() for i in range(args.tage, 0, -1)]
    fehler = 0
    for tag in tage:
        # 22.11.2026: Gegenrechnung (tatsächlich + Planer gierig) zuerst neu rechnen, damit alle Spalten mit demselben,
        # gerade gelernten Raummodell gerechnet sind – das Modell lernt jede Nacht neu (19.11.: gierig mit Modell vom 20.11.,
        # HiGHS mit Modell vom 22.11. → Toilette Eingang 0,8 gegen 18,7 °C·h unter Min, unfairer Vergleich).
        try:
            heizplaner(einst, {"aktion": "vergleich", "tag": tag})
        except Exception as ex:
            melde(f"{tag}: Gegenrechnung nicht neu gerechnet – {ex}")
        for schritt in (ein_tag, highs_tag):                       # EMHASS und HiGHS unabhängig voneinander
            try:
                schritt(einst, tag)
            except Exception as ex:                               # ein Fehler darf den Rest nicht aufhalten
                fehler += 1
                melde(f"{tag}: FEHLER ({'EMHASS' if schritt is ein_tag else 'HiGHS'}) {ex}")
                if "401" in str(ex):
                    melde("Der Heizplaner lehnt den Schlüssel ab – in bruecke.json den service_role-Schlüssel eintragen "
                          "(Supabase › Project Settings › API Keys), siehe doc/EMHASS-VERGLEICH-2026-11-22.md")
                    sys.exit(1)
    sys.exit(1 if fehler else 0)


if __name__ == "__main__":
    main()
