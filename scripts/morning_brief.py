#!/usr/bin/env python3
"""
morning_brief.py — genera il testo del Morning Brief FMM consolidato.

Legge gli ultimi snapshot delle 3 sezioni (spending / beefamily / aghc) dall'hub
fmm-dashboard pubblicato su GitHub Pages, calcola gli alert top e produce
un singolo messaggio Slack consolidato.

Uso:
    python3 morning_brief.py \\
      --base https://advfmosca.github.io/fmm-dashboard \\
      --out-text /tmp/brief/text.txt \\
      --out-meta /tmp/brief/meta.json

Output:
  - text.txt: testo Slack pronto da inviare con slack_send_message
  - meta.json: counters + dashboard_url + sezioni con date dei rispettivi snapshot
"""
from __future__ import annotations
import argparse
import json
import os
import sys
import urllib.request
from datetime import date, datetime
from urllib.error import HTTPError, URLError


SECTIONS = ["spending", "beefamily", "aghc"]


def fmt_date_it(d_iso):
    if not d_iso:
        return "—"
    months = ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"]
    y, m, d = d_iso.split("-")
    return f"{int(d):02d} {months[int(m)-1]} {y}"


def fmt_eur(n):
    if n is None:
        return "—"
    return f"{n:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".") + " €"


def days_since(d_iso):
    if not d_iso:
        return None
    return (date.today() - date.fromisoformat(d_iso)).days


def fetch_json(url, timeout=10):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "fmm-morning-brief"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except (HTTPError, URLError, json.JSONDecodeError, TimeoutError) as e:
        return None


def health_emoji(section, snap):
    if not snap:
        return "⚪"  # no data
    s = snap.get("summary") or {}
    if section == "spending":
        zero = s.get("zero_count", 0)
        if zero >= 3:
            return "🔴"
        if zero >= 1:
            return "🟡"
        return "🟢"
    fermi = s.get("fermi_attivi_tot", 0)
    insoluti = sum(1 for f in (snap.get("fermi_attivi") or []) if f.get("cause") == "insoluto")
    if insoluti >= 1:
        return "🔴"
    if fermi >= 3:
        return "🔴"
    if fermi >= 1:
        return "🟡"
    return "🟢"


def render_spending(snap, dashboard_base):
    if not snap:
        return "*Spending* ⚪\nDati non disponibili."
    s = snap.get("summary") or {}
    yest = snap.get("run_date")
    zero = s.get("zero_count", 0)
    spike = s.get("spike_count", 0)
    total = s.get("alerts_total", 0)
    speso = s.get("total_spend_yest", 0)
    dot = health_emoji("spending", snap)

    lines = [
        f"{dot} *Spending — controllo del {fmt_date_it(yest)}*",
        f"{total} alert tot · {zero} zero · {spike} spike · {fmt_eur(speso)} speso",
    ]
    # Top 3 critical
    zeros = sorted(
        (snap.get("zero_alerts") or []),
        key=lambda a: (0 if a.get("cause") == "Account sospeso o anomalia pagamenti" else 1, -(a.get("spend_yest") or 0)),
    )
    spikes = sorted((snap.get("spike_alerts") or []), key=lambda a: -(a.get("spend_yest") or 0))
    top = (zeros + spikes)[:3]
    for a in top:
        plat = a.get("platform", "")
        name = (a.get("name") or "").strip() or "—"
        if a in zeros:
            cause = a.get("cause") or "Causa da verificare"
            lines.append(f"  • ⚡ {name} ({plat}) — 0,00 € · _{cause}_")
        else:
            delta = a.get("delta_pct")
            d_str = f" ({'+' if (delta or 0) > 0 else ''}{delta:.1f}%)" if delta is not None else ""
            lines.append(f"  • 🔥 {name} ({plat}) — {fmt_eur(a.get('spend_yest'))}{d_str}")
    if total > 3:
        lines.append(f"  _+ {total - 3} altri alert_")
    lines.append(f"  <{dashboard_base}/?section=spending&date={yest}|→ Apri sezione>")
    return "\n".join(lines)


def render_account_check(section, label, snap, dashboard_base):
    if not snap:
        return f"*{label}* ⚪\nDati non disponibili."
    s = snap.get("summary") or {}
    yest = snap.get("run_date")
    age = days_since(yest)
    age_str = f" ({age} giorni fa)" if age and age > 1 else ""
    fermi = s.get("fermi_attivi_tot", 0)
    nuovi = s.get("fermi_nuovi", 0)
    ripristini = s.get("ripristini", 0)
    insoluti = s.get("ripristini_insoluti", 0)
    promemoria = s.get("promemoria_inviati", 0)
    dot = health_emoji(section, snap)

    lines = [
        f"{dot} *{label} — controllo del {fmt_date_it(yest)}{age_str}*",
        f"{fermi} fermi attivi · {nuovi} nuovi · {ripristini} ripristini" + (f" ({insoluti} ex-insoluti)" if insoluti else "") + f" · {promemoria} promemoria",
    ]
    # Critical highlights: insoluti + nuovi
    fermi_attivi = snap.get("fermi_attivi") or []
    insol = [f for f in fermi_attivi if f.get("cause") == "insoluto"]
    if insol:
        lines.append(f"  🚨 *{len(insol)} INSOLUTI da risolvere*:")
        for f in insol[:3]:
            clients = f.get("clients") or [f.get("client") or "—"]
            clients_str = " + ".join(clients) if isinstance(clients, list) else str(clients)
            plat = (f.get("platform") or "").capitalize()
            lines.append(f"    • {clients_str} ({plat}) — fermo dal {f.get('stopped_since') or 'data ignota'}")
    nuovi_list = snap.get("fermi_nuovi") or []
    if nuovi_list:
        lines.append(f"  ⚠️ *Nuovi fermi ieri*:")
        for f in nuovi_list[:3]:
            clients = f.get("clients") or [f.get("client") or "—"]
            clients_str = " + ".join(clients) if isinstance(clients, list) else str(clients)
            plat = (f.get("platform") or "").capitalize()
            lines.append(f"    • {clients_str} ({plat}) — €0 vs {fmt_eur(f.get('spend_day_before'))} altro ieri")
    lines.append(f"  <{dashboard_base}/?section={section}&date={yest}|→ Apri sezione>")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://advfmosca.github.io/fmm-dashboard")
    ap.add_argument("--out-text", required=True)
    ap.add_argument("--out-meta", required=True)
    args = ap.parse_args()

    base = args.base.rstrip("/")
    snaps = {}
    errors = []
    for sect in SECTIONS:
        idx = fetch_json(f"{base}/data/{sect}/index.json")
        if not idx or not (idx.get("checks") or []):
            snaps[sect] = None
            if not idx:
                errors.append(f"{sect}: manifest non raggiungibile")
            continue
        last_date = idx["checks"][0].get("date")
        snap = fetch_json(f"{base}/data/{sect}/{last_date}.json")
        if not snap:
            errors.append(f"{sect}: snapshot {last_date} non raggiungibile")
            snaps[sect] = None
        else:
            snaps[sect] = snap

    # Compose message
    today_str = fmt_date_it(date.today().isoformat())
    msg_lines = [f"☀️ *Morning Brief FMM — {today_str}*", ""]
    msg_lines.append(render_spending(snaps.get("spending"), base))
    msg_lines.append("")
    msg_lines.append(render_account_check("beefamily", "Bee Family", snaps.get("beefamily"), base))
    msg_lines.append("")
    msg_lines.append(render_account_check("aghc", "AGHC", snaps.get("aghc"), base))
    msg_lines.append("")
    if errors:
        msg_lines.append("⚠️ _Avvisi: " + " · ".join(errors) + "_")
    msg_lines.append(f"📊 <{base}/|Apri dashboard live (iPad-friendly)>")

    text = "\n".join(msg_lines)

    meta = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "today": date.today().isoformat(),
        "dashboard_url": base,
        "sections": {
            sect: {
                "run_date": (snaps[sect] or {}).get("run_date"),
                "summary": (snaps[sect] or {}).get("summary"),
                "available": snaps[sect] is not None,
            }
            for sect in SECTIONS
        },
        "errors": errors,
    }

    os.makedirs(os.path.dirname(args.out_text) or ".", exist_ok=True)
    with open(args.out_text, "w", encoding="utf-8") as f:
        f.write(text)
    with open(args.out_meta, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    print(f"brief generated · {len(text)} chars · sections available: " + ", ".join(s for s in SECTIONS if snaps[s]))


if __name__ == "__main__":
    main()
