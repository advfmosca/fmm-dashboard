# FMM Dashboard

Hub centrale FMM Consulting per le dashboard live alimentate da scheduled task Cowork. Tutti i dati sono snapshot JSON pubblicati staticamente su GitHub Pages — consultabili anche da iPad / smartphone, senza dipendenza dal Mac di Francesco.

URL pubblico: `https://advfmosca.github.io/fmm-dashboard/`

## Sezioni

| Sezione | Origine dati | Cadenza | Task Cowork |
|---|---|---|---|
| **Spending Anomalies** | `docs/data/spending/{date}.json` | giornaliera (08:35 → ora 07:00 dopo migrazione) | `alert-spending-anomalie-windsor` |
| **Bee Family Daily Check** | `docs/data/beefamily/{date}.json` | giornaliera (10:00 → ora 07:00 dopo migrazione) | `daily-check-beefamily` |
| **AGHC 3-Day Check** | `docs/data/aghc/{date}.json` | ogni 3 giorni (10:00 → ora 07:00 dopo migrazione) | `three-day-check-aghc` |

Ogni snapshot è auto-contenuto: il task scheduled fetcha i dati Windsor, calcola anomalie/fermi, salva il JSON nel repo, pubblica via Pages. La dashboard HTML è statica e legge solo i JSON.

## Struttura repo

```
fmm-dashboard/
├── README.md              ← questo file
├── SETUP.md               ← istruzioni one-time setup
├── .gitignore
├── docs/                  ← GitHub Pages root (Settings → Pages → /docs)
│   ├── .nojekyll          ← disabilita Jekyll
│   ├── index.html         ← hub dashboard (3 tab)
│   ├── assets/
│   │   ├── style.css
│   │   └── app.js
│   └── data/
│       ├── schema.md      ← schema JSON dei 3 tipi di snapshot
│       ├── spending/
│       │   ├── index.json ← manifest (lista date)
│       │   └── {date}.json
│       ├── beefamily/
│       │   ├── index.json
│       │   └── {date}.json
│       └── aghc/
│           ├── index.json
│           └── {date}.json
└── scripts/
    ├── publish_snapshot.py   ← script generico (multi-type) per push GitHub
    ├── accounts.json         ← lista account per task spending
    ├── beefamily_roster.json ← lista clienti BeeFamily
    └── aghc_roster.json      ← lista clienti AGHC
```

## Migrazione da `fmm-anomalie-spending`

Il vecchio repo `fmm-anomalie-spending` resta come archivio storico. Il task `alert-spending-anomalie-windsor` viene migrato a questo repo cambiando l'env `GITHUB_REPO=fmm-dashboard`. Lo schema dello snapshot spending è **invariato** rispetto a v2 / v3 — cambia solo il path (`docs/data/spending/{date}.json`).

## Schema JSON

Vedi `docs/data/schema.md`.
