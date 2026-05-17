#!/usr/bin/env python3
"""
check_beefamily.py — core logic del daily check Bee Family v3 (token-optimized).

Chiamato dal task scheduled `daily-check-beefamily`. Riceve in input:
  - roster JSON (clienti + meta_id + google_id + channel_id)
  - state JSON (state.json del workspace BeeFamily — tracking anti-spam)
  - prev-snap JSON (snapshot precedente per riuso trend, opzionale)
  - results JSON Meta + results JSON Google (output dei get_data Windsor)
  - today (YYYY-MM-DD, opzionale; default: data odierna)

Produce in output:
  - snapshot.json (per la dashboard fmm-dashboard, sezione beefamily)
  - state_updated.json (nuovo state.json da scrivere nel workspace)
  - actions.json (lista di azioni Slack da inviare, in ordine)

Uso:
    python3 check_beefamily.py \\
      --roster /tmp/bf-run/roster.json \\
      --state /tmp/bf-run/state.json \\
      --prev-snap /tmp/bf-run/prev_snap.json \\
      --meta-results /tmp/bf-run/meta_results.json \\
      --google-results /tmp/bf-run/google_results.json \\
      --today 2026-05-17 \\
      --out-snapshot /tmp/bf-run/snapshot.json \\
      --out-state /tmp/bf-run/state_updated.json \\
      --out-actions /tmp/bf-run/actions.json

Stampa su stdout 1 riga compatta con i counter del run (per log nel prompt scheduled).
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from copy import deepcopy

DASHBOARD_BASE = "https://advfmosca.github.io/fmm-dashboard"
TREND_DAYS = 14  # finestra trend per snapshot (per ogni account in alert)


# ────────────────────────────────────────────────────────────────────────────────
# Utility
# ────────────────────────────────────────────────────────────────────────────────

def fmt_eur(x):
    """Formatta importo in EUR italiano (virgola decimale)."""
    if x is None:
        return "—"
    return f"€{x:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def fmt_date_it(d_iso: str) -> str:
    """ISO date → 'DD MMM YYYY' italiano abbreviato."""
    months = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"]
    y, m, d = d_iso.split("-")
    return f"{int(d):02d} {months[int(m)-1]} {y}"


def days_between(a_iso: str, b_iso: str) -> int:
    """b - a in giorni (intero)."""
    da = date.fromisoformat(a_iso)
    db = date.fromisoformat(b_iso)
    return (db - da).days


def load_json(path: str, default=None):
    if not path or not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ────────────────────────────────────────────────────────────────────────────────
# Aggregazione spend per account
# ────────────────────────────────────────────────────────────────────────────────

def aggregate_by_account(rows, platform: str):
    """
    Ricevi i risultati Windsor (lista di righe con account_id, account_name, date, spend)
    e ritorna: {account_id: {"name": str, "platform": str, "spend_by_date": {date: float}}}
    """
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
# Template messaggi Slack (replica dell'esistente SKILL.md)
# ────────────────────────────────────────────────────────────────────────────────

def tpl_ripristino(account_name, platform, spend_yesterday, stopped_since, yesterday):
    plat = "Meta" if platform == "meta" else "Google Ads"
    stopped_label = stopped_since or "—"
    return (
        f"✅ *Account ripristinato — {fmt_date_it(yesterday)}*\n\n"
        f"Account: *{account_name}* ({plat})\n"
        f"Spesa di ieri: {fmt_eur(spend_yesterday)} (era fermo dal {stopped_label})\n\n"
        f"Tutto torna a girare. Nessun ulteriore promemoria."
    )


def tpl_fermo_nuovo(account_name, platform, spend_day_before, yesterday):
    plat = "Meta" if platform == "meta" else "Google Ads"
    return (
        f"<!channel> 🚨 *Campagna ferma — {fmt_date_it(yesterday)}*\n\n"
        f"Account: *{account_name}* ({plat})\n"
        f"Spesa ieri: €0,00 (vs {fmt_eur(spend_day_before)} dell'altro ieri)\n\n"
        f"Verificare insoluto, pausa account o problema di delivery. "
        f"Prossimo promemoria tra 3 giorni se non risolto."
    )


def tpl_promemoria(account_name, platform, last_spend_date, last_spend_value, stopped_since, today_iso, note=None):
    plat = "Meta" if platform == "meta" else "Google Ads"
    if last_spend_date and stopped_since:
        giorni_fermo = days_between(stopped_since, today_iso)
        return (
            f"<!channel> ⏰ *Promemoria — Account ancora fermo*\n\n"
            f"Account: *{account_name}* ({plat})\n"
            f"Ultima spesa registrata: {last_spend_date} ({fmt_eur(last_spend_value)})\n"
            f"Fermo da: {stopped_since} ({giorni_fermo} giorni)\n\n"
            f"Verificare insoluto, pausa account o problema di delivery. "
            f"Prossimo promemoria tra 3 giorni se non risolto."
        )
    # fermo_storico
    note_text = note or "almeno 60 giorni"
    return (
        f"<!channel> ⏰ *Promemoria — Account ancora fermo*\n\n"
        f"Account: *{account_name}* ({plat})\n"
        f"Nessuna spesa registrata da {note_text}\n\n"
        f"Verificare se l'account è chiuso, sospeso o non più connesso a Windsor. "
        f"Prossimo promemoria tra 3 giorni se non risolto."
    )


def tpl_riepilogo_anomalie(yesterday, fermi_nuovi):
    """fermi_nuovi: list of dict {client, platform, account_name, spend_day_before}"""
    lines = [
        f"<!channel> 🚨 *Anomalie giornaliere Bee Family — {fmt_date_it(yesterday)}*",
        "",
        f"Account fermi rilevati: {len(fermi_nuovi)}",
        "",
    ]
    for f in fermi_nuovi:
        plat = "Meta" if f["platform"] == "meta" else "Google"
        lines.append(
            f"• {f['client']}: {plat} `{f['account_name']}` — €0,00 vs {fmt_eur(f['spend_day_before'])}"
        )
    lines.append("")
    lines.append("_Dettagli per cliente nei rispettivi canali #bf-{slug}._")
    return "\n".join(lines)


def tpl_heartbeat(yesterday, counters, dashboard_url):
    return (
        f"✅ *Daily check Bee Family completato — {fmt_date_it(yesterday)}*\n\n"
        f"• Account monitorati: {counters['monitorati']}\n"
        f"• Fermi nuovi: {counters['fermi_nuovi']}\n"
        f"• Ripristini: {counters['ripristini']} "
        f"(di cui {counters['ripristini_insoluti']} ex-insoluto con bozza WhatsApp 6.a/6.b postata)\n"
        f"• Promemoria inviati: {counters['promemoria']}\n"
        f"• Errori: {counters['errori']}\n\n"
        f"📊 <{dashboard_url}|Apri dashboard live (iPad-friendly)>"
    )


# ────────────────────────────────────────────────────────────────────────────────
# Bozze WhatsApp ripristino (sezione 6 SKILL.md)
# ────────────────────────────────────────────────────────────────────────────────

WA_RIPRISTINO_META = """Ciao,

ti aggiorno: l'account Meta è stato sbloccato dopo il saldo della posizione insoluta. Grazie per la rapidità!

Cosa ho già fatto:
• verificato campagne e adset rimasti in pausa
• riattivato le campagne progressivamente, partendo da quelle con storico più solido
• controllato budget giornalieri e limiti di spesa
• verificato Pixel/CAPI e metodo di pagamento

Nelle prossime 24-72 ore tengo d'occhio erogazione, frequenza e CPM/CPL: come ti dicevo, all'inizio è normale un po' di assestamento perché gli adset rientrano in learning phase. I KPI possono essere meno efficienti rispetto a prima, ma si normalizzano in qualche giorno di erogazione continua.

Ti aggiorno a fine settimana con il confronto post-ripristino vs trend storico.

Un consiglio per il futuro: se riesci, imposta una carta di backup nel Business Manager — così se la primaria dà problemi il sistema continua a erogare senza fermarsi.

Per qualsiasi cosa sono qui.

Un saluto"""

WA_RIPRISTINO_GOOGLE = """Ciao,

ti aggiorno: l'account Google Ads è stato sbloccato dopo il saldo della posizione insoluta. Grazie per la rapidità!

Cosa ho già fatto:
• verificato campagne rimaste in pausa
• riattivato le campagne progressivamente, partendo da quelle con storico più solido
• controllato budget giornalieri e limiti di spesa
• verificato tracking conversioni e metodo di pagamento

Nelle prossime 24-72 ore tengo d'occhio impression share, frequenza e CPC/CPA: come ti dicevo, all'inizio è normale un po' di assestamento perché lo Smart Bidding rientra in fase di apprendimento. I KPI possono essere meno efficienti rispetto a prima, ma si normalizzano in qualche giorno di erogazione continua.

Ti aggiorno a fine settimana con il confronto post-ripristino vs trend storico.

Un consiglio per il futuro: se riesci, imposta una carta di backup da Google Ads (Strumenti → Fatturazione → Metodi di pagamento) — così se la primaria dà problemi il sistema continua a erogare senza fermarsi.

Per qualsiasi cosa sono qui.

Un saluto"""


# ────────────────────────────────────────────────────────────────────────────────
# Core: build state delta + actions + snapshot
# ────────────────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--roster", required=True)
    ap.add_argument("--state", required=True)
    ap.add_argument("--prev-snap", default="")
    ap.add_argument("--meta-results", required=True)
    ap.add_argument("--google-results", required=True)
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
    google_rows = load_json(args.google_results, default={"result": []}).get("result") or []

    anomalie_channel = roster["anomalie_channel_id"]
    reminder_days = (state.get("policy") or {}).get("reminder_interval_days", 3)

    # Index roster by (platform, account_id)
    by_key = {}   # "meta:<id>" / "google:<id>" → client_info
    for c in roster["clients"]:
        if c.get("meta_id"):
            by_key[f"meta:{c['meta_id']}"] = c
        if c.get("google_id") and not c.get("google_not_connected"):
            by_key[f"google:{c['google_id']}"] = c

    meta_agg = aggregate_by_account(meta_rows, "meta")
    google_agg = aggregate_by_account(google_rows, "google")

    # Combine into 1 dict keyed by "<platform>:<account_id>"
    combined = {}
    for aid, info in meta_agg.items():
        combined[f"meta:{aid}"] = info
    for aid, info in google_agg.items():
        combined[f"google:{aid}"] = info

    new_state = deepcopy(state)
    new_state.setdefault("accounts", {})
    new_state["last_run"] = today

    actions = []                # ordered list of Slack actions
    fermi_nuovi_list = []       # for riepilogo 4.c
    ripristini_list = []
    promemoria_list = []
    errori = []
    counters = {
        "monitorati": len(by_key),
        "fermi_nuovi": 0,
        "ripristini": 0,
        "ripristini_insoluti": 0,
        "promemoria": 0,
        "fermi_attivi_tot": 0,
        "errori": 0,
    }

    # ── 3.bis Account ripristinati ──
    for key, st in list(new_state["accounts"].items()):
        plat = key.split(":")[0]
        aid = key.split(":", 1)[1]
        agg = combined.get(key)
        spend_yest = (agg["spend_by_date"].get(yesterday) or 0.0) if agg else 0.0
        if spend_yest > 0:
            client = st.get("client") or "—"
            channel_id = st.get("channel_id")
            account_name = st.get("account_name") or (agg["name"] if agg else aid)
            cause = st.get("cause") or "generico"

            # 1) msg ripristino
            actions.append({
                "type": "ripristino",
                "channel_id": channel_id,
                "client": client,
                "platform": plat,
                "account_id": aid,
                "text": tpl_ripristino(account_name, plat, spend_yest, st.get("stopped_since"), yesterday),
            })
            # 2) bozza WhatsApp se cause=insoluto
            if cause == "insoluto":
                wa_text = WA_RIPRISTINO_META if plat == "meta" else WA_RIPRISTINO_GOOGLE
                actions.append({
                    "type": "bozza_ripristino_wa",
                    "channel_id": channel_id,
                    "client": client,
                    "platform": plat,
                    "account_id": aid,
                    "text": wa_text,
                })
                counters["ripristini_insoluti"] += 1

            ripristini_list.append({
                "client": client,
                "platform": plat,
                "account_id": aid,
                "account_name": account_name,
                "spend_yesterday": round(spend_yest, 2),
                "stopped_since": st.get("stopped_since"),
                "cause": cause,
                "channel_id": channel_id,
            })
            counters["ripristini"] += 1
            # rimuovi da state
            del new_state["accounts"][key]

    # ── 4.a Fermi nuovi + 4.b Promemoria ──
    for key, client_info in by_key.items():
        plat = key.split(":")[0]
        aid = key.split(":", 1)[1]
        agg = combined.get(key)
        if not agg:
            # connettore non ha tornato dati → segnalalo come errore se ci aspettavamo di vederlo
            errori.append({"key": key, "client": client_info["name"], "reason": "no_data_from_windsor"})
            counters["errori"] += 1
            continue
        spend_yest = agg["spend_by_date"].get(yesterday) or 0.0
        spend_db = agg["spend_by_date"].get(day_before) or 0.0
        account_name = agg["name"] or client_info["name"]

        in_state = key in new_state["accounts"]

        if spend_yest > 0:
            # account attivo, niente da fare (i ripristini sono già stati gestiti sopra)
            continue

        # spend_yest == 0
        if not in_state:
            if spend_db > 0:
                # ── 4.a Fermo nuovo ──
                actions.append({
                    "type": "fermo_nuovo",
                    "channel_id": client_info["channel_id"],
                    "client": client_info["name"],
                    "platform": plat,
                    "account_id": aid,
                    "account_name": account_name,
                    "text": tpl_fermo_nuovo(account_name, plat, spend_db, yesterday),
                })
                new_state["accounts"][key] = {
                    "client": client_info["name"],
                    "platform": plat,
                    "account_name": account_name,
                    "channel_id": client_info["channel_id"],
                    "stopped_since": yesterday,
                    "last_spend_date": day_before,
                    "last_spend_value": round(spend_db, 2),
                    "first_notified": today,
                    "last_notified": today,
                    "notifications_count": 1,
                    "status": "fermo",
                    "cause": "generico",
                }
                fermi_nuovi_list.append({
                    "client": client_info["name"],
                    "platform": plat,
                    "account_id": aid,
                    "account_name": account_name,
                    "spend_day_before": round(spend_db, 2),
                })
                counters["fermi_nuovi"] += 1
            else:
                # ── 3 bottom: yest=0 day_before=0 NOT in state → fermo_storico aggiunto silenziosamente ──
                # NB: SKILL.md prevede fetch storico 60d per trovare last_spend_date.
                # In v3 lo evitiamo (token-saving): segniamo solo come fermo_storico senza fetch storico.
                # Sarà visibile sulla dashboard come "fermo storico" senza date precise.
                new_state["accounts"][key] = {
                    "client": client_info["name"],
                    "platform": plat,
                    "account_name": account_name,
                    "channel_id": client_info["channel_id"],
                    "stopped_since": None,
                    "last_spend_date": None,
                    "last_spend_value": None,
                    "first_notified": today,
                    "last_notified": today,
                    "notifications_count": 0,
                    "status": "fermo_storico",
                    "cause": "generico",
                    "note": "Aggiunto in v3 senza fetch storico — verificare manualmente",
                }
        else:
            # ── 4.b Promemoria periodico ──
            st = new_state["accounts"][key]
            last_notified = st.get("last_notified")
            if last_notified and days_between(last_notified, today) >= reminder_days:
                actions.append({
                    "type": "promemoria",
                    "channel_id": st["channel_id"],
                    "client": st["client"],
                    "platform": plat,
                    "account_id": aid,
                    "account_name": st["account_name"],
                    "text": tpl_promemoria(
                        st["account_name"], plat,
                        st.get("last_spend_date"), st.get("last_spend_value"),
                        st.get("stopped_since"), today, st.get("note"),
                    ),
                })
                st["last_notified"] = today
                st["notifications_count"] = (st.get("notifications_count") or 0) + 1
                promemoria_list.append({
                    "client": st["client"],
                    "platform": plat,
                    "account_id": aid,
                    "account_name": st["account_name"],
                    "stopped_since": st.get("stopped_since"),
                })
                counters["promemoria"] += 1

    # ── 4.c Riepilogo #bf-anomalie (solo se fermi nuovi) ──
    if fermi_nuovi_list:
        actions.append({
            "type": "riepilogo",
            "channel_id": anomalie_channel,
            "text": tpl_riepilogo_anomalie(yesterday, fermi_nuovi_list),
        })

    # ── Heartbeat 7.a SEMPRE ──
    dashboard_url = f"{DASHBOARD_BASE}/?section=beefamily&date={yesterday}"
    counters["fermi_attivi_tot"] = len(new_state["accounts"])
    actions.append({
        "type": "heartbeat",
        "channel_id": anomalie_channel,
        "text": tpl_heartbeat(yesterday, counters, dashboard_url),
    })

    # ── Trend 14gg: riusa prev_snap, appendi yest, fallback se nuovo ──
    prev_trend = (prev_snap or {}).get("trend_14d_by_id") or {}
    trend = {}
    for key in {**{a["account_id"]: True for a in fermi_nuovi_list}, **new_state["accounts"]}.keys():
        # key qui può essere account_id puro (fermi_nuovi_list) oppure "platform:account_id" (state)
        if ":" in key:
            aid = key.split(":", 1)[1]
        else:
            aid = key
        agg = None
        for pkey, info in combined.items():
            if pkey.endswith(f":{aid}"):
                agg = info
                break
        pts = list(prev_trend.get(aid) or [])
        if agg:
            # appendi yesterday se non c'è già
            if not any(p["date"] == yesterday for p in pts):
                pts.append({"date": yesterday, "spend": round(agg["spend_by_date"].get(yesterday) or 0.0, 2)})
        # dedup + sort + clamp
        seen = {}
        for p in pts:
            seen[p["date"]] = p
        pts = sorted(seen.values(), key=lambda p: p["date"])[-TREND_DAYS:]
        if pts:
            trend[aid] = pts

    # ── Snapshot finale per la dashboard ──
    fermi_attivi_dump = []
    for key, st in new_state["accounts"].items():
        plat, aid = key.split(":", 1)
        fermi_attivi_dump.append({
            "client": st.get("client"),
            "platform": plat,
            "account_id": aid,
            "account_name": st.get("account_name"),
            "stopped_since": st.get("stopped_since"),
            "last_spend_date": st.get("last_spend_date"),
            "last_spend_value": st.get("last_spend_value"),
            "first_notified": st.get("first_notified"),
            "last_notified": st.get("last_notified"),
            "notifications_count": st.get("notifications_count"),
            "status": st.get("status"),
            "cause": st.get("cause"),
            "channel_id": st.get("channel_id"),
            "note": st.get("note"),
        })

    snapshot = {
        "section": "beefamily",
        "run_date": yesterday,
        "executed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "summary": {
            "clienti_monitorati": len(roster["clients"]),
            "accounts_monitorati": counters["monitorati"],
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

    # Write outputs
    with open(args.out_snapshot, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, separators=(",", ":"), ensure_ascii=False)
    with open(args.out_state, "w", encoding="utf-8") as f:
        json.dump(new_state, f, indent=2, ensure_ascii=False)
    with open(args.out_actions, "w", encoding="utf-8") as f:
        json.dump({"actions": actions}, f, indent=2, ensure_ascii=False)

    # 1-line log
    print(
        f"yest={yesterday} monitorati={counters['monitorati']} "
        f"fermi_nuovi={counters['fermi_nuovi']} fermi_attivi={counters['fermi_attivi_tot']} "
        f"promemoria={counters['promemoria']} ripristini={counters['ripristini']} "
        f"(insoluti={counters['ripristini_insoluti']}) errori={counters['errori']} "
        f"actions={len(actions)}"
    )


if __name__ == "__main__":
    main()
