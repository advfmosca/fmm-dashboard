# SETUP — Deploy hub `fmm-dashboard`

Tempo stimato: **~15 minuti**. Da fare **una sola volta**. Tutto il lavoro successivo (Fase 1–6) gira sopra questo setup.

## 1. Verifica prerequisiti

- `gh` CLI installato e autenticato (`gh auth status`). Se non lo è: `gh auth login` e segui il flow.
- Cartella `/Users/francescomariamosca/Desktop/FMM/fmm-dashboard/` già presente (creata da Claude in Fase 0).

## 2. Crea il repo + push iniziale (un solo comando)

Dal terminale:

```bash
cd "/Users/francescomariamosca/Desktop/FMM/fmm-dashboard"
git init -b main
git add .
git commit -m "scaffold fmm-dashboard hub (Fase 0)"
gh repo create advfmosca/fmm-dashboard \
  --public \
  --description "Hub dashboard FMM — spending anomalies + Bee Family + AGHC" \
  --source . \
  --remote origin \
  --push
```

Output atteso: ultima riga `https://github.com/advfmosca/fmm-dashboard.git`.

## 3. Abilita GitHub Pages

```bash
gh api -X POST "repos/advfmosca/fmm-dashboard/pages" \
  -f "source[branch]=main" \
  -f "source[path]=/docs"
```

In alternativa via UI: `https://github.com/advfmosca/fmm-dashboard/settings/pages` → Source: `main` / `/docs` → Save.

Dopo 1–2 minuti la dashboard placeholder è viva su:

**https://advfmosca.github.io/fmm-dashboard/**

(deve mostrare 3 tab — Spending / Bee Family / AGHC — e una card "Nessuno snapshot ancora pubblicato" per BeeFamily/AGHC. La tab Spending sar&agrave; popolata in Fase 3 dopo la migrazione.)

## 4. Genera Personal Access Token (PAT) fine-grained

Vai su https://github.com/settings/personal-access-tokens/new

- **Token name**: `FMM Dashboard Bot`
- **Expiration**: 1 anno (o "No expiration" se preferisci)
- **Repository access**: Only select repositories → `fmm-dashboard`
- **Repository permissions**:
  - Contents: **Read and write**
  - Metadata: Read-only (auto)
- **Generate token** → copia subito il valore (inizia con `github_pat_...`)

⚠️ Salvalo in 1Password o nel tuo password manager. GitHub non lo mostra una seconda volta.

## 5. Comunicami il PAT (chat sicura)

Quando hai il PAT, incollamelo qui in chat — io aggiorno l'env del task `alert-spending-anomalie-windsor` (Fase 3) e lo userò anche per Fase 1 e 2.

In alternativa, se preferisci tenerlo solo tu: aggiungi manualmente queste env al task `alert-spending-anomalie-windsor` in Cowork:

- `GITHUB_PAT` = `<incolla qui il PAT>`
- `GITHUB_USER` = `advfmosca`
- `GITHUB_REPO` = `fmm-dashboard`

## Riepilogo file scaffolding

```
fmm-dashboard/
├── README.md
├── SETUP.md                ← questo file
├── .gitignore
├── docs/
│   ├── .nojekyll
│   ├── index.html          ← hub placeholder (3 tab)
│   ├── assets/
│   │   ├── style.css       ← dark mode + brand FMM (#ff6b35)
│   │   └── app.js          ← tab switcher + load manifest
│   └── data/
│       ├── schema.md       ← schema JSON dei 3 tipi snapshot
│       ├── spending/
│       │   └── index.json  ← manifest vuoto (popolato in Fase 3)
│       ├── beefamily/
│       │   └── index.json  ← manifest vuoto (popolato in Fase 1)
│       └── aghc/
│           └── index.json  ← manifest vuoto (popolato in Fase 2)
└── scripts/
    ├── publish_snapshot.py    ← generico multi-type
    ├── accounts.json          ← lista account spending (da fmm-anomalie-spending)
    ├── beefamily_roster.json  ← placeholder, popolato in Fase 1
    └── aghc_roster.json       ← placeholder, popolato in Fase 2
```

## Troubleshooting

| Problema | Soluzione |
|---|---|
| `gh: command not found` | `brew install gh` |
| `gh auth` errore | `gh auth login`, scegli GitHub.com → HTTPS → autentica via browser |
| Pages 404 dopo 5+ min | Verifica Settings → Pages: branch `main`, folder `/docs`; controlla che `docs/.nojekyll` esista |
| Push respinto | Repo già esistente: cambia il nome o cancellalo prima da github.com |
