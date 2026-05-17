# Schema JSON — snapshot fmm-dashboard

Tutti gli snapshot vivono in `docs/data/{section}/{run_date}.json` dove `section ∈ {spending, beefamily, aghc}`. Ogni snapshot ha campi comuni e campi specifici della sezione.

## Manifest (`docs/data/{section}/index.json`)

Aggiornato a ogni run dal `publish_snapshot.py`. Schema:

```json
{
  "last_updated": "2026-05-17T08:32:14+00:00",
  "checks": [
    {
      "date": "2026-05-16",
      "alerts_total": 28,
      "summary_extra": { ... }
    },
    ...
  ]
}
```

`checks` ordinato per data discendente. `summary_extra` cambia per sezione (zero/spike per spending, fermi_nuovi/promemoria/ripristini per beefamily/aghc).

## Snapshot `spending`

Invariato rispetto a v3 di `fmm-anomalie-spending`. Schema riassunto:

```json
{
  "run_date": "2026-05-16",
  "executed_at": "2026-05-17T06:35:58+00:00",
  "summary": {
    "accounts_checked": {"Meta": 48, "Google": 17, "TikTok": 5},
    "total_spend_yest": 4521.30,
    "spend_by_platform": {"Meta": 3120.00, "Google": 950.30, "TikTok": 451.00},
    "alerts_total": 28,
    "zero_count": 7,
    "spike_count": 21
  },
  "excluded_accounts": [...],
  "zero_alerts": [...],
  "spike_alerts": [...],
  "trend_30d": {"<account_id>": [{"date": "...", "spend": 0.0}, ...]}
}
```

## Snapshot `beefamily`

Schema proposto (nuovo, da consolidare in Fase 1):

```json
{
  "section": "beefamily",
  "run_date": "2026-05-16",
  "executed_at": "2026-05-17T08:00:00+00:00",
  "summary": {
    "clienti_monitorati": 22,
    "fermi_nuovi": 1,
    "fermi_attivi_tot": 3,
    "promemoria_inviati": 2,
    "ripristini": 1,
    "ripristini_insoluti": 0,
    "errori_connettori": 0
  },
  "fermi_nuovi": [
    {
      "client": "BONADIES",
      "platform": "Meta",
      "account_id": "1234016965549263",
      "stopped_since": "2026-05-15",
      "spend_day_before": 12.50,
      "cause": "generico",
      "slack_channel": "C0B0AAV9M33"
    }
  ],
  "fermi_attivi": [...],
  "ripristini": [...],
  "promemoria": [...],
  "errori": [],
  "trend_14d_by_id": {"<account_id>": [{"date": "...", "spend": 0.0}, ...]}
}
```

## Snapshot `aghc`

Schema proposto (nuovo, da consolidare in Fase 2). Stessa struttura di `beefamily` ma con:
- `summary.clienti_monitorati`: 18
- `summary.account_meta_unici`: 15
- `summary.account_tiktok`: 5
- `account_condivisi`: mappa account_id → [client_a, client_b] per Meta condivisi (3 casi)
- ogni fermo/ripristino ha `slack_channels` (lista, non singolo) per gestire account condivisi

## Note

- Tutti gli importi in EUR.
- Date in formato ISO `YYYY-MM-DD`.
- `executed_at` in ISO 8601 UTC.
- I JSON sono serializzati con `separators=(",",":")` per minimizzare la dimensione (eccetto `index.json` che resta pretty-printed per leggibilità).
