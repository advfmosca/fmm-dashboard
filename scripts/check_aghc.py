#!/usr/bin/env python3
"""
check_aghc.py — core logic del 3-day check AGHC v3 (token-optimized).

Chiamato dal task scheduled `three-day-check-aghc`. Differenze chiave vs BeeFamily:
  - 3 account Meta condivisi → notifiche a 2 canali clienti contemporaneamente
  - 5 account TikTok attivi (no Google Ads)
  - DM finale a Francesco invece di heartbeat su canale anomalie
  - Bozze ripristino insoluto formato email formale (7.a Meta / 7.b TikTok)
  - state.json keyed by account_id puro (no platform: prefix), per compatibilità con il file esistente

Uso identico a check_beefamily.py:
    python3 check_aghc.py \\
      --roster /tmp/aghc-run/roster.json \\
      --state /tmp/aghc-run/state.json \\
      --prev-snap /tmp/aghc-run/prev_snap.json \\
      --meta-results /tmp/aghc-run/meta_results.json \\
      --tiktok-results /tmp/aghc-run/tiktok_results.json \\
      --today 2026-05-17 \\
      --out-snapshot snapshot.json \\
      --out-state state_updated.json \\
      --out-actions actions.json
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from copy import deepcopy

DASHBOARD_BASE = "https://advfmosca.github.io/fmm-dashboard"
TREND_DAYS = 14


# ────────────────────────────────────────────────────────────────────────────────
# Utility (identiche a check_beefamily.py)
# ────────────────────────────────────────────────────────────────────────────────

def fmt_eur(x):
    if x is None:
        return "—"
    return f"€{x:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def fmt_date_it(d_iso: str) -> str:
    months = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"]
    y, m, d = d_iso.split("-")
    return f"{int(d):02d} {months[int(m)-1]} {y}"


def days_between(a_iso: str, b_iso: str) -> int:
    return (date.fromisoformat(b_iso) - date.fromisoformat(a_iso)).days


def load_json(path: str, default=None):
    if not path or not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def aggregate_by_account(rows, platform: str):
    out = {}
    for r in rows:
        aid = str(r.get("account_id") or "").strip()
        if not aid:
            continue
        b = out.setdefault(aid, {
            "name": (r.get("account_name") or "").strip(),
            "platform": platform,
            "spend_by_date": {},
        })
        d = r.get("date")
        s = float(r.get("spend") or 0.0)
        if d:
            b["spend_by_date"][d] = b["spend_by_date"].get(d, 0.0) + s
        if r.get("account_name") and not b["name"]:
            b["name"] = r["account_name"].strip()
    return out


# ────────────────────────────────────────────────────────────────────────────────
# Templates Slack (replica di SKILL.md AGHC)
# ────────────────────────────────────────────────────────────────────────────────

def plat_label(p):
    return {"meta": "Meta", "tiktok": "TikTok"}.get(p, p)


def tpl_ripristino(account_name, platform, spend_yesterday, stopped_since, yesterday):
    stopped_label = stopped_since or "—"
    return (
        f"✅ *Account ripristinato — {fmt_date_it(yesterday)}*\n\n"
        f"Account: *{account_name}* ({plat_label(platform)})\n"
        f"Spesa di ieri: {fmt_eur(spend_yesterday)} (era fermo dal {stopped_label})\n\n"
        f"Tutto torna a girare. Nessun ulteriore promemoria."
    )


def tpl_fermo_nuovo(account_name, platform, spend_day_before, yesterday):
    return (
        f"<!channel> 🚨 *Campagna ferma — {fmt_date_it(yesterday)}*\n\n"
        f"Account: *{account_name}* ({plat_label(platform)})\n"
        f"Spesa ieri: €0,00 (vs {fmt_eur(spend_day_before)} dell'altro ieri)\n\n"
        f"Verificare insoluto, pausa account o problema di delivery. "
        f"Prossimo promemoria tra 3 giorni se non risolto."
    )


def tpl_promemoria(account_name, platform, last_spend_date, last_spend_value, stopped_since, today_iso, note=None):
    if last_spend_date and stopped_since:
        giorni_fermo = days_between(stopped_since, today_iso)
        return (
            f"<!channel> ⏰ *Promemoria — Account ancora fermo*\n\n"
            f"Account: *{account_name}* ({plat_label(platform)})\n"
            f"Ultima spesa registrata: {last_spend_date} ({fmt_eur(last_spend_value)})\n"
            f"Fermo da: {stopped_since} ({giorni_fermo} giorni)\n\n"
            f"Verificare insoluto, pausa account o problema di delivery. "
            f"Prossimo promemoria tra 3 giorni se non risolto."
        )
    note_text = note or "almeno 60 giorni"
    return (
        f"<!channel> ⏰ *Promemoria — Account ancora fermo*\n\n"
        f"Account: *{account_name}* ({plat_label(platform)})\n"
        f"Nessuna spesa registrata da {note_text}\n\n"
        f"Verificare se l'account è chiuso, sospeso o non più connesso a Windsor. "
        f"Prossimo promemoria tra 3 giorni se non risolto."
    )


def tpl_riepilogo_anomalie(yesterday, fermi_nuovi):
    lines = [
        f"<!channel> 🚨 *Anomalie AGHC — {fmt_date_it(yesterday)}*",
        "",
        f"Account fermi rilevati: {len(fermi_nuovi)}",
        "",
    ]
    for f in fermi_nuovi:
        clienti = " + ".join(f["clients"]) if isinstance(f["clients"], list) else f["clients"]
        lines.append(
            f"• {clienti}: {plat_label(f['platform'])} `{f['account_name']}` — €0,00 vs {fmt_eur(f['spend_day_before'])}"
        )
    lines.append("")
    lines.append("_Dettagli per cliente nei rispettivi canali #aghc-{slug}._")
    return "\n".join(lines)


def tpl_dm_francesco(yesterday, counters, dashboard_url):
    return (
        f"📊 *Check AGHC 3-giorni — {fmt_date_it(yesterday)}*\n\n"
        f"• Fermi nuovi: {counters['fermi_nuovi']}\n"
        f"• Promemoria: {counters['promemoria']}\n"
        f"• Ripristini: {counters['ripristini']} (di cui {counters['ripristini_insoluti']} con bozza 7.a/7.b postata)\n"
        f"• Errori: {counters['errori']}\n\n"
        f"🔗 <{dashboard_url}|Apri dashboard live (iPad-friendly)>"
    )


# ────────────────────────────────────────────────────────────────────────────────
# Bozze email ripristino post-insoluto (sezione 7 SKILL.md AGHC)
# ────────────────────────────────────────────────────────────────────────────────

EMAIL_RIPRISTINO_META = """Oggetto: Ripristino account pubblicitario Meta — campagne riattivate

Salve,

vi confermo con piacere che l'account pubblicitario è stato correttamente sbloccato a seguito del saldo della posizione insoluta. Vi ringrazio per la tempestività dell'intervento.

Di seguito gli step già conclusi da parte mia:
- verifica dello stato di tutte le campagne e degli adset precedentemente in pausa forzata
- riattivazione progressiva delle campagne, partendo da quelle con storico più consolidato
- controllo dei budget giornalieri, dei lifetime budget e dei limiti di spesa a livello account
- verifica del corretto funzionamento di Pixel e Conversions API e dell'integrità del metodo di pagamento principale

Nelle prossime 24-72 ore monitorerò con particolare attenzione l'erogazione, la frequenza e i CPM / CPL delle singole campagne. Come anticipato in fase di segnalazione, è fisiologico osservare una iniziale fase di assestamento, in cui gli adset rientrano nella "fase di apprendimento" e l'algoritmo di Meta riallinea i segnali raccolti: in questa finestra i KPI possono risultare temporaneamente meno efficienti rispetto al periodo pre-stop, salvo poi normalizzarsi nel giro di pochi giorni di erogazione continua.

Vi aggiornerò con un primo punto al termine della prima settimana piena di erogazione, così da condividere il confronto fra i dati post-ripristino e il trend storico.

Per evitare il ripetersi di episodi analoghi, mi permetto di suggerire — laddove possibile — l'impostazione di una carta di backup attiva all'interno del Business Manager e una soglia di addebito mensile coerente con i volumi di spesa medi: in questo modo, in caso di problema sulla carta primaria, il sistema continua a erogare senza interruzioni.

Resto naturalmente a disposizione per qualsiasi confronto sulle prossime ottimizzazioni e per condividere i primi dati post-ripristino.

Un caro saluto,
Francesco Mosca
Adv Specialist – AG Hotel Consulting
adv@aghotelconsulting.it"""

EMAIL_RIPRISTINO_TIKTOK = """Oggetto: Ripristino account pubblicitario TikTok — campagne riattivate

Salve,

vi confermo con piacere che l'account pubblicitario è stato correttamente sbloccato a seguito del saldo della posizione insoluta. Vi ringrazio per la tempestività dell'intervento.

Di seguito gli step già conclusi da parte mia:
- verifica dello stato di tutte le campagne e degli ad group precedentemente in pausa forzata
- riattivazione progressiva delle campagne, partendo da quelle con storico più consolidato
- controllo dei budget giornalieri, dei lifetime budget e del balance a livello account
- verifica del corretto funzionamento di Pixel TikTok ed Events API e dell'integrità del metodo di pagamento principale

Nelle prossime 24-72 ore monitorerò con particolare attenzione l'erogazione, la frequenza e i CPM / CPL delle singole campagne. Come anticipato in fase di segnalazione, è fisiologico osservare una iniziale fase di assestamento, in cui gli ad group rientrano in "learning phase" e l'algoritmo di TikTok riallinea i segnali raccolti: in questa finestra i KPI possono risultare temporaneamente meno efficienti rispetto al periodo pre-stop, salvo poi normalizzarsi nel giro di pochi giorni di erogazione continua.

Vi aggiornerò con un primo punto al termine della prima settimana piena di erogazione, così da condividere il confronto fra i dati post-ripristino e il trend storico.

Per evitare il ripetersi di episodi analoghi, mi permetto di suggerire — laddove possibile — l'impostazione di una carta di backup attiva all'interno di TikTok Ads Manager (Finanze → Metodi di pagamento) e una soglia di addebito mensile coerente con i volumi di spesa medi: in questo modo, in caso di problema sulla carta primaria, il sistema continua a erogare senza interruzioni.

Resto naturalmente a disposizione per qualsiasi confronto sulle prossime ottimizzazioni e per condividere i primi dati post-ripristino.

Un caro saluto,
Francesco Mosca
Adv Specialist – AG Hotel Consulting
adv@aghotelconsulting.it"""


# ────────────────────────────────────────────────────────────────────────────────
# Core
# ────────────────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--roster", required=True)
    ap.add_argument("--state", required=True)
    ap.add_argument("--prev-snap", default="")
    ap.add_argument("--meta-results", required=True)
    ap.add_argument("--tiktok-results", required=True)
    ap.add_argument("--today", default=date.today().isoformat())
    ap.add_argument("--out-snapshot", required=True)
    ap.add_argument("--out-state", required=True)
    ap.add_argument("--out-actions", required=True)
    args = ap.parse_args()

    today = args.today
    yesterday = (date.fromisoformat(today) - timedelta(days=1)).isoformat()
    day_before = (date.fromisoformat(today) - timedelta(days=2)).isoformat()

    roster = load_json(args.roster)
    state = load_json(args.state, default={"policy": {"reminder_interval_days": 3, "history_lookback_days": 60}, "accounts": {}})
    prev_snap = load_json(args.prev_snap, default={"trend_14d_by_id": {}})
    meta_rows = load_json(args.meta_results, default={"result": []}).get("result") or []
    tiktok_rows = load_json(args.tiktok_results, default={"result": []}).get("result") or []

    anomalie_channel = roster["anomalie_channel_id"]
    dm_francesco_channel = roster["dm_francesco_channel_id"]
    reminder_days = (state.get("policy") or {}).get("reminder_interval_days", 3)

    # Build mapping: account_id (any platform) → {clients: [...], channels: [...], platform}
    # For shared Meta accounts, this maps to 2 clients.
    # For TikTok, only the 5 active accounts.
    account_to_clients = {}  # account_id → {"client_names": [], "channels": [], "platform": "..."}
    monitored_meta_ids = set()
    monitored_tiktok_ids = set()
    by_client = {c["name"]: c for c in roster["clients"]}

    # Meta
    for c in roster["clients"]:
        mid = c.get("meta_id")
        if not mid:
            continue
        monitored_meta_ids.add(mid)
        entry = account_to_clients.setdefault(mid, {"client_names": [], "channels": [], "platform": "meta"})
        if c["name"] not in entry["client_names"]:
            entry["client_names"].append(c["name"])
            entry["channels"].append(c["channel_id"])

    # TikTok (5 attivi)
    for c in roster["clients"]:
        tid = c.get("tiktok_id")
        if not tid:
            continue
        monitored_tiktok_ids.add(tid)
        entry = account_to_clients.setdefault(tid, {"client_names": [], "channels": [], "platform": "tiktok"})
        if c["name"] not in entry["client_names"]:
            entry["client_names"].append(c["name"])
            entry["channels"].append(c["channel_id"])

    meta_agg = aggregate_by_account(meta_rows, "meta")
    tiktok_agg = aggregate_by_account(tiktok_rows, "tiktok")
    combined = {**meta_agg, **tiktok_agg}

    new_state = deepcopy(state)
    new_state.setdefault("accounts", {})
    new_state["last_run"] = today

    actions = []
    fermi_nuovi_list = []
    ripristini_list = []
    promemoria_list = []
    errori = []
    counters = {
        "monitorati_meta": len(monitored_meta_ids),
        "monitorati_tiktok": len(monitored_tiktok_ids),
        "fermi_nuovi": 0,
        "ripristini": 0,
        "ripristini_insoluti": 0,
        "promemoria": 0,
        "fermi_attivi_tot": 0,
        "errori": 0,
    }

    # ── 4.bis Ripristini ──
    for aid, st in list(new_state["accounts"].items()):
        agg = combined.get(aid)
        spend_yest = (agg["spend_by_date"].get(yesterday) or 0.0) if agg else 0.0
        if spend_yest <= 0:
            continue

        plat = st.get("platform") or (agg["platform"] if agg else "meta")
        account_name = st.get("account_name") or (agg["name"] if agg else aid)
        channels = st.get("notify_channel_ids") or []
        client_names = st.get("client_names") or []
        cause = st.get("cause") or "generico"

        # ✅ ripristino su tutti i canali coinvolti (1 o 2)
        for ch in channels:
            actions.append({
                "type": "ripristino",
                "channel_id": ch,
                "clients": client_names,
                "platform": plat,
                "account_id": aid,
                "text": tpl_ripristino(account_name, plat, spend_yest, st.get("stopped_since"), yesterday),
            })
        # bozza email se insoluto
        if cause == "insoluto":
            email = EMAIL_RIPRISTINO_META if plat == "meta" else EMAIL_RIPRISTINO_TIKTOK
            for ch in channels:
                actions.append({
                    "type": "bozza_ripristino_email",
                    "channel_id": ch,
                    "clients": client_names,
                    "platform": plat,
                    "account_id": aid,
                    "text": email,
                })
            counters["ripristini_insoluti"] += 1

        ripristini_list.append({
            "clients": client_names,
            "platform": plat,
            "account_id": aid,
            "account_name": account_name,
            "spend_yesterday": round(spend_yest, 2),
            "stopped_since": st.get("stopped_since"),
            "cause": cause,
            "channels": channels,
        })
        counters["ripristini"] += 1
        del new_state["accounts"][aid]

    # ── 5.a Fermi nuovi + 5.b Promemoria ──
    for aid, info in account_to_clients.items():
        agg = combined.get(aid)
        if not agg:
            errori.append({"account_id": aid, "clients": info["client_names"], "reason": "no_data_from_windsor"})
            counters["errori"] += 1
            continue

        spend_yest = agg["spend_by_date"].get(yesterday) or 0.0
        spend_db = agg["spend_by_date"].get(day_before) or 0.0
        account_name = agg["name"] or info["client_names"][0]
        plat = info["platform"]
        channels = info["channels"]
        client_names = info["client_names"]

        if spend_yest > 0:
            continue   # già attivo, niente da fare

        in_state = aid in new_state["accounts"]

        if not in_state:
            if spend_db > 0:
                # 5.a fermo nuovo
                for ch in channels:
                    actions.append({
                        "type": "fermo_nuovo",
                        "channel_id": ch,
                        "clients": client_names,
                        "platform": plat,
                        "account_id": aid,
                        "account_name": account_name,
                        "text": tpl_fermo_nuovo(account_name, plat, spend_db, yesterday),
                    })
                new_state["accounts"][aid] = {
                    "platform": plat,
                    "account_name": account_name,
                    "client_names": client_names,
                    "notify_channel_ids": channels,
                    "stopped_since": yesterday,
                    "last_spend_date": day_before,
                    "last_spend_amount": round(spend_db, 2),
                    "first_notified": today,
                    "last_notified": today,
                    "count": 1,
                    "status": "fermo",
                    "cause": "generico",
                }
                fermi_nuovi_list.append({
                    "clients": client_names,
                    "platform": plat,
                    "account_id": aid,
                    "account_name": account_name,
                    "spend_day_before": round(spend_db, 2),
                })
                counters["fermi_nuovi"] += 1
            else:
                # yest=0 day_before=0 NOT in state → fermo_storico silente
                new_state["accounts"][aid] = {
                    "platform": plat,
                    "account_name": account_name,
                    "client_names": client_names,
                    "notify_channel_ids": channels,
                    "stopped_since": None,
                    "last_spend_date": None,
                    "last_spend_amount": None,
                    "first_notified": today,
                    "last_notified": today,
                    "count": 0,
                    "status": "fermo_storico",
                    "cause": "generico",
                    "note": "Aggiunto in v3 senza fetch storico — verificare manualmente",
                }
        else:
            # 5.b promemoria periodico
            st = new_state["accounts"][aid]
            last_notified = st.get("last_notified")
            if last_notified and days_between(last_notified, today) >= reminder_days:
                channels_to_notify = st.get("notify_channel_ids") or channels
                for ch in channels_to_notify:
                    actions.append({
                        "type": "promemoria",
                        "channel_id": ch,
                        "clients": st.get("client_names") or client_names,
                        "platform": plat,
                        "account_id": aid,
                        "account_name": st["account_name"],
                        "text": tpl_promemoria(
                            st["account_name"], plat,
                            st.get("last_spend_date"), st.get("last_spend_amount"),
                            st.get("stopped_since"), today, st.get("note"),
                        ),
                    })
                st["last_notified"] = today
                st["count"] = (st.get("count") or 0) + 1
                promemoria_list.append({
                    "clients": st.get("client_names") or client_names,
                    "platform": plat,
                    "account_id": aid,
                    "account_name": st["account_name"],
                    "stopped_since": st.get("stopped_since"),
                })
                counters["promemoria"] += 1

    # ── 5.c Riepilogo #aghc-anomalie (solo se fermi nuovi) ──
    if fermi_nuovi_list:
        actions.append({
            "type": "riepilogo",
            "channel_id": anomalie_channel,
            "text": tpl_riepilogo_anomalie(yesterday, fermi_nuovi_list),
        })

    # ── 5.f DM Francesco RIMOSSA ──
    # In v3+brief: la DM Francesco "ricevuto della cron run" è stata eliminata perché ridondante.
    # Il riepilogo cross-portfolio (spending + bf + aghc) viene generato dal task fmm-morning-brief
    # (cron 0 8 * * *) che legge il manifest pubblicato e posta un brief consolidato in DM Francesco.
    # Se vuoi ripristinarla: scommenta il blocco sotto.
    # actions.append({"type": "dm_francesco", "channel_id": dm_francesco_channel,
    #                  "text": tpl_dm_francesco(yesterday, counters, f"{DASHBOARD_BASE}/?section=aghc&date={yesterday}")})
    counters["fermi_attivi_tot"] = len(new_state["accounts"])

    # ── Trend 14gg: riusa prev_snap, appendi yest ──
    prev_trend = (prev_snap or {}).get("trend_14d_by_id") or {}
    trend = {}
    for aid in list(new_state["accounts"].keys()) + [f["account_id"] for f in fermi_nuovi_list]:
        agg = combined.get(aid)
        pts = list(prev_trend.get(aid) or [])
        if agg and not any(p["date"] == yesterday for p in pts):
            pts.append({"date": yesterday, "spend": round(agg["spend_by_date"].get(yesterday) or 0.0, 2)})
        seen = {}
        for p in pts:
            seen[p["date"]] = p
        pts = sorted(seen.values(), key=lambda p: p["date"])[-TREND_DAYS:]
        if pts:
            trend[aid] = pts

    # ── Snapshot ──
    fermi_attivi_dump = []
    for aid, st in new_state["accounts"].items():
        fermi_attivi_dump.append({
            "account_id": aid,
            "platform": st.get("platform"),
            "account_name": st.get("account_name"),
            "clients": st.get("client_names"),
            "stopped_since": st.get("stopped_since"),
            "last_spend_date": st.get("last_spend_date"),
            "last_spend_amount": st.get("last_spend_amount"),
            "first_notified": st.get("first_notified"),
            "last_notified": st.get("last_notified"),
            "count": st.get("count"),
            "status": st.get("status"),
            "cause": st.get("cause"),
            "notify_channel_ids": st.get("notify_channel_ids"),
            "note": st.get("note"),
        })

    snapshot = {
        "section": "aghc",
        "run_date": yesterday,
        "executed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "summary": {
            "clienti_monitorati": len(roster["clients"]),
            "account_meta_unici": counters["monitorati_meta"],
            "account_tiktok": counters["monitorati_tiktok"],
            "fermi_nuovi": counters["fermi_nuovi"],
            "fermi_attivi_tot": counters["fermi_attivi_tot"],
            "promemoria_inviati": counters["promemoria"],
            "ripristini": counters["ripristini"],
            "ripristini_insoluti": counters["ripristini_insoluti"],
            "errori_connettori": counters["errori"],
        },
        "fermi_nuovi": fermi_nuovi_list,
        "fermi_attivi": fermi_attivi_dump,
        "ripristini": ripristini_list,
        "promemoria": promemoria_list,
        "errori": errori,
        "trend_14d_by_id": trend,
    }

    with open(args.out_snapshot, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, separators=(",", ":"), ensure_ascii=False)
    with open(args.out_state, "w", encoding="utf-8") as f:
        json.dump(new_state, f, indent=2, ensure_ascii=False)
    with open(args.out_actions, "w", encoding="utf-8") as f:
        json.dump({"actions": actions}, f, indent=2, ensure_ascii=False)

    print(
        f"yest={yesterday} meta={counters['monitorati_meta']} tiktok={counters['monitorati_tiktok']} "
        f"fermi_nuovi={counters['fermi_nuovi']} fermi_attivi={counters['fermi_attivi_tot']} "
        f"promemoria={counters['promemoria']} ripristini={counters['ripristini']} "
        f"(insoluti={counters['ripristini_insoluti']}) errori={counters['errori']} "
        f"actions={len(actions)}"
    )


if __name__ == "__main__":
    main()
