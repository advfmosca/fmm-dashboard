#!/usr/bin/env python3
"""
publish_snapshot.py — pubblica uno snapshot JSON sull'hub fmm-dashboard.

Uso dal task schedulato:
    GITHUB_PAT=ghp_xxx \
    GITHUB_USER=advfmosca \
    GITHUB_REPO=fmm-dashboard \
    python3 publish_snapshot.py <section> /path/to/snapshot.json

Dove <section> ∈ {spending, beefamily, aghc}.

Lo snapshot.json deve avere almeno i campi `run_date` e `summary`. Lo script:
  1. clona (shallow) il repo in una temp dir
  2. scrive docs/data/{section}/{run_date}.json e aggiorna docs/data/{section}/index.json
  3. fa commit + push con il PAT
  4. stampa l'URL pubblico finale (utile per costruire il link Slack)

Dipende solo da: python3 stdlib + git installato.
"""
from __future__ import annotations
import json, os, subprocess, sys, tempfile, shutil
from datetime import datetime, timezone

VALID_SECTIONS = {"spending", "beefamily", "aghc"}


def run(cmd, cwd=None, check=True, capture=False):
    r = subprocess.run(cmd, cwd=cwd, check=check, text=True, capture_output=capture)
    return r


def summary_for_manifest(section: str, summary: dict) -> dict:
    """Estrae i campi rilevanti del summary per il manifest index.json."""
    if section == "spending":
        return {
            "alerts_total": summary.get("alerts_total", 0),
            "zero": summary.get("zero_count", 0),
            "spike": summary.get("spike_count", 0),
            "accounts_checked": sum((summary.get("accounts_checked") or {}).values()),
            "total_spend_yest": summary.get("total_spend_yest", 0.0),
        }
    if section == "beefamily":
        return {
            "clienti_monitorati": summary.get("clienti_monitorati", 0),
            "fermi_nuovi": summary.get("fermi_nuovi", 0),
            "fermi_attivi_tot": summary.get("fermi_attivi_tot", 0),
            "promemoria_inviati": summary.get("promemoria_inviati", 0),
            "ripristini": summary.get("ripristini", 0),
            "errori": summary.get("errori_connettori", 0),
        }
    if section == "aghc":
        return {
            "clienti_monitorati": summary.get("clienti_monitorati", 0),
            "fermi_nuovi": summary.get("fermi_nuovi", 0),
            "fermi_attivi_tot": summary.get("fermi_attivi_tot", 0),
            "promemoria_inviati": summary.get("promemoria_inviati", 0),
            "ripristini": summary.get("ripristini", 0),
            "errori": summary.get("errori_connettori", 0),
        }
    return {}


def main():
    if len(sys.argv) != 3:
        sys.exit("Usage: publish_snapshot.py <section> <snapshot.json>")
    section = sys.argv[1].lower().strip()
    snap_path = sys.argv[2]
    if section not in VALID_SECTIONS:
        sys.exit(f"Invalid section '{section}'. Must be one of: {sorted(VALID_SECTIONS)}")
    if not os.path.exists(snap_path):
        sys.exit(f"Snapshot not found: {snap_path}")

    pat = os.environ.get("GITHUB_PAT")
    user = os.environ.get("GITHUB_USER")
    repo = os.environ.get("GITHUB_REPO", "fmm-dashboard")
    branch = os.environ.get("GITHUB_BRANCH", "main")
    git_email = os.environ.get("GIT_EMAIL", "bot@fmmconsulting.it")
    git_name = os.environ.get("GIT_NAME", "FMM Dashboard Bot")
    if not pat or not user:
        sys.exit("Missing env: GITHUB_PAT and/or GITHUB_USER")

    with open(snap_path, encoding="utf-8") as f:
        snap = json.load(f)
    run_date = snap.get("run_date")
    if not run_date:
        sys.exit("Snapshot missing run_date")

    tmp = tempfile.mkdtemp(prefix=f"fmm-dashboard-{section}-")
    try:
        clone_url = f"https://{user}:{pat}@github.com/{user}/{repo}.git"
        run(["git", "clone", "--depth", "1", "--branch", branch, clone_url, tmp])
        run(["git", "config", "user.email", git_email], cwd=tmp)
        run(["git", "config", "user.name", git_name], cwd=tmp)

        data_dir = os.path.join(tmp, "docs", "data", section)
        os.makedirs(data_dir, exist_ok=True)

        # write snapshot (compact JSON)
        out_snap = os.path.join(data_dir, f"{run_date}.json")
        with open(out_snap, "w", encoding="utf-8") as f:
            json.dump(snap, f, separators=(",", ":"), ensure_ascii=False)

        # update manifest
        idx_path = os.path.join(data_dir, "index.json")
        if os.path.exists(idx_path):
            with open(idx_path, encoding="utf-8") as f:
                idx = json.load(f)
        else:
            idx = {"last_updated": None, "checks": []}
        idx["checks"] = [c for c in idx.get("checks", []) if c.get("date") != run_date]
        check_entry = {"date": run_date}
        check_entry.update(summary_for_manifest(section, snap.get("summary") or {}))
        idx["checks"].append(check_entry)
        idx["checks"].sort(key=lambda c: c["date"], reverse=True)
        idx["last_updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with open(idx_path, "w", encoding="utf-8") as f:
            json.dump(idx, f, indent=2, ensure_ascii=False)

        # commit + push (no-op tolerant)
        run(["git", "add", f"docs/data/{section}/"], cwd=tmp)
        status = run(["git", "status", "--porcelain"], cwd=tmp, capture=True).stdout
        if not status.strip():
            print("No changes to commit.")
        else:
            summary = snap.get("summary") or {}
            if section == "spending":
                msg = (
                    f"spending {run_date}: {summary.get('alerts_total', 0)} alert "
                    f"({summary.get('zero_count', 0)} zero, {summary.get('spike_count', 0)} spike)"
                )
            else:
                msg = (
                    f"{section} {run_date}: {summary.get('fermi_nuovi', 0)} fermi nuovi, "
                    f"{summary.get('ripristini', 0)} ripristini"
                )
            run(["git", "commit", "-m", msg], cwd=tmp)
            run(["git", "push", "origin", branch], cwd=tmp)

        public_url = f"https://{user}.github.io/{repo}/?section={section}&date={run_date}"
        print(public_url)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
