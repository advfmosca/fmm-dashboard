// fmm-dashboard hub — versione completa (Fase 4)
// Carica i manifest delle 3 sezioni, popola KPI + cards + sparkline.
// Deep-link via ?section=X&date=Y&client=Z. Filtri persistenti in localStorage.

const SECTIONS = ["spending", "beefamily", "aghc", "medtech", "other"];
const STATE = {
  spending:  { manifest: null, current: null, filterChip: "all", filterQuery: "" },
  beefamily: { manifest: null, current: null, filterChip: "all", filterQuery: "" },
  aghc:      { manifest: null, current: null, filterChip: "all", filterQuery: "" },
  medtech:   { manifest: null, current: null, filterChip: "all", filterQuery: "" },
  other:     { manifest: null, current: null, filterChip: "all", filterQuery: "" },
  // Cache globale: ownership map e owners metadata
  _owners: null,
  _accountOwner: null,   // Map: account_id (string) → {owner_id, label, color, subclient}
};

// ────────────────────────────────────────────────────────────────────────
// Utility formatting
// ────────────────────────────────────────────────────────────────────────

function fmtNum(n, decimals = 0) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return n.toLocaleString("it-IT", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtEUR(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function fmtDateIT(iso) {
  if (!iso) return "—";
  const months = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
  const [y, m, d] = iso.split("-");
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
}

function daysAgo(iso) {
  if (!iso) return null;
  const today = new Date();
  const then = new Date(iso);
  return Math.floor((today - then) / 86400000);
}

// ────────────────────────────────────────────────────────────────────────
// Loghi piattaforma (SVG inline brand colors)
// ────────────────────────────────────────────────────────────────────────

const PLATFORM_LOGOS = {
  meta: `<svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg" aria-label="Meta"><circle cx="18" cy="18" r="18" fill="#0866FF"/><path d="M22.5 22h-3v-7h2.5l.5-3h-3v-2.1c0-.8.3-1.5 1.4-1.5h1.6V6H19c-2.4 0-4 1.5-4 4v2h-2.5v3H15v7h3.5z" fill="#fff"/></svg>`,
  google: `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-label="Google Ads"><path fill="#4285F4" d="M43.6 22.5H42V22H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 8.3 29.3 6 24 6 14.1 6 6 14.1 6 24s8.1 18 18 18c10.5 0 17.4-7.4 17.4-17.8 0-1.2-.1-2.4-.4-3.7z"/><path fill="#34A853" d="M8.3 14.7l6.6 4.8c1.8-4.3 6-7.3 10.9-7.3 3 0 5.8 1.1 7.9 3L39.4 9.5C34 4.5 27 1.6 19.7 3 14.4 4 9.9 7 8.3 14.7z"/><path fill="#FBBC05" d="M24 42c5.2 0 10-1.8 13.6-4.9l-6.3-5.3c-1.9 1.3-4.4 2.2-7.3 2.2-5.3 0-9.7-3.4-11.3-8L5.9 31C8.6 37.6 15.7 42 24 42z"/><path fill="#EA4335" d="M43.6 22.5H42V22H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3c-.4.4 6.7-4.9 6.7-15.1 0-1.2-.1-2.4-.7-3.2z"/></svg>`,
  tiktok: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-label="TikTok"><path d="M21 8.5a6.4 6.4 0 0 1-4.1-1.5v8.3a6.4 6.4 0 1 1-6.4-6.4l.7.1v3.6a2.86 2.86 0 1 0 2 2.7V2h3.5a4.84 4.84 0 0 0 4.3 4.3z" fill="#25F4EE" transform="translate(-1,-1)"/><path d="M21 8.5a6.4 6.4 0 0 1-4.1-1.5v8.3a6.4 6.4 0 1 1-6.4-6.4l.7.1v3.6a2.86 2.86 0 1 0 2 2.7V2h3.5a4.84 4.84 0 0 0 4.3 4.3z" fill="#FE2C55" transform="translate(1,1)"/><path d="M21 8.5a6.4 6.4 0 0 1-4.1-1.5v8.3a6.4 6.4 0 1 1-6.4-6.4l.7.1v3.6a2.86 2.86 0 1 0 2 2.7V2h3.5a4.84 4.84 0 0 0 4.3 4.3z" fill="#000"/></svg>`,
};

function platformLogo(platform) {
  const k = (platform || "").toLowerCase();
  let svg = PLATFORM_LOGOS.meta;
  let label = "Meta";
  if (k === "google" || k === "google_ads") { svg = PLATFORM_LOGOS.google; label = "Google"; }
  else if (k === "tiktok") { svg = PLATFORM_LOGOS.tiktok; label = "TikTok"; }
  return `<span class="platform-logo" title="${label}">${svg}</span>`;
}

// ────────────────────────────────────────────────────────────────────────
// Ownership map (MIO CLIENTE > Sub-cliente)
// ────────────────────────────────────────────────────────────────────────

async function loadOwnersMap() {
  if (STATE._accountOwner) return STATE._accountOwner;
  try {
    const [owners, bf, aghc, other] = await Promise.all([
      fetchJson("../scripts/owners.json").catch(()=>null),
      fetchJson("../scripts/beefamily_roster.json").catch(()=>null),
      fetchJson("../scripts/aghc_roster.json").catch(()=>null),
      fetchJson("../scripts/other_roster.json").catch(()=>null),
    ]);
    STATE._owners = owners || {owners: {}, sub_clients: {}};
    const map = new Map();
    if (bf && bf.clients) {
      const o = STATE._owners.owners.beefamily;
      for (const c of bf.clients) {
        if (c.meta_id)   map.set(String(c.meta_id),   { owner: "beefamily", label: o.label, color: o.color, subclient: c.name });
        if (c.google_id) map.set(String(c.google_id), { owner: "beefamily", label: o.label, color: o.color, subclient: c.name });
      }
    }
    if (aghc && aghc.clients) {
      const o = STATE._owners.owners.aghc;
      for (const c of aghc.clients) {
        if (c.meta_id)   map.set(String(c.meta_id),   { owner: "aghc", label: o.label, color: o.color, subclient: c.name });
        if (c.tiktok_id) map.set(String(c.tiktok_id), { owner: "aghc", label: o.label, color: o.color, subclient: c.name });
      }
    }
    // CEA — solo Med & Tech
    const cea = STATE._owners.owners.cea;
    const medtech = STATE._owners.sub_clients && STATE._owners.sub_clients.medtech;
    if (cea && medtech && medtech.meta_id) {
      map.set(String(medtech.meta_id), { owner: "cea", label: cea.label, color: cea.color, subclient: medtech.label });
    }
    // Altri — auto-discovered
    if (other && other.accounts) {
      const o = STATE._owners.owners.other;
      for (const a of other.accounts) {
        if (a.account_id && !map.has(String(a.account_id))) {
          map.set(String(a.account_id), { owner: "other", label: o.label, color: o.color, subclient: a.name || "—" });
        }
      }
    }
    STATE._accountOwner = map;
    return map;
  } catch (e) {
    console.error("loadOwnersMap error:", e);
    STATE._accountOwner = new Map();
    return STATE._accountOwner;
  }
}

function accountOwner(accountId) {
  if (!STATE._accountOwner) return null;
  return STATE._accountOwner.get(String(accountId)) || null;
}

// Costruisce l'URL deep-link alla piattaforma pubblicitaria nativa.
function adAccountUrl(platform, accountId) {
  if (!accountId) return null;
  const p = (platform || "").toLowerCase();
  if (p === "meta" || p === "facebook") {
    return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${accountId}`;
  }
  if (p === "google" || p === "google_ads") {
    const clean = String(accountId).replace(/-/g, "");
    return `https://ads.google.com/aw/overview?__c=${clean}`;
  }
  if (p === "tiktok") {
    return `https://ads.tiktok.com/i18n/perf/campaign?aadvid=${accountId}`;
  }
  return null;
}

function platformLabel(p) {
  const k = (p || "").toLowerCase();
  if (k === "meta" || k === "facebook") return "Meta Ads Manager";
  if (k === "google" || k === "google_ads") return "Google Ads";
  if (k === "tiktok") return "TikTok Ads Manager";
  return "piattaforma";
}

// Genera un rational testuale italiano analizzando i punti del trend.
function analyzeTrend(points) {
  if (!points || points.length < 3) return null;
  const spends = points.map(p => p.spend || 0);
  const dates = points.map(p => p.date);
  const n = spends.length;
  const total = spends.reduce((a, b) => a + b, 0);
  const avg = total / n;
  const min = Math.min(...spends);
  const max = Math.max(...spends);
  const maxIdx = spends.indexOf(max);
  const minIdx = spends.indexOf(min);
  const zeros = spends.filter(s => s === 0).length;
  const nonZero = spends.filter(s => s > 0);
  const avgNonZero = nonZero.length ? nonZero.reduce((a,b)=>a+b,0) / nonZero.length : 0;

  // Confronto prima metà vs seconda metà
  const half = Math.floor(n / 2);
  const first = spends.slice(0, half);
  const second = spends.slice(n - half);
  const avgFirst = first.reduce((a,b)=>a+b,0) / first.length;
  const avgSecond = second.reduce((a,b)=>a+b,0) / second.length;
  const trend = avgFirst > 0 ? ((avgSecond / avgFirst - 1) * 100) : null;

  // Variabilità (coefficient of variation)
  const variance = spends.reduce((sum, s) => sum + (s - avg) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);
  const cv = avg > 0 ? (stdev / avg) * 100 : 0;

  // Componi rational
  let lines = [];
  lines.push(`<strong>Spesa totale</strong> ${fmtEUR(total)} su ${n} giorni · <strong>media</strong> ${fmtEUR(avg)}/giorno`);
  if (zeros > 0) {
    if (zeros === n) {
      lines.push(`⚠️ <strong>0 spesa</strong> in tutta la finestra — account fermo o non erogante.`);
    } else {
      lines.push(`${zeros} giorn${zeros>1?'i':'o'} a 0 € (media nei giorni eroganti: ${fmtEUR(avgNonZero)})`);
    }
  }
  if (max > 0) {
    lines.push(`picco a <strong>${fmtEUR(max)}</strong> il ${dates[maxIdx]}`);
  }
  if (trend !== null && Math.abs(trend) >= 10) {
    const arrow = trend > 0 ? "📈" : "📉";
    const dir = trend > 0 ? "in crescita" : "in calo";
    lines.push(`${arrow} <strong>${dir}</strong>: ${trend > 0 ? "+" : ""}${trend.toFixed(0)}% nella seconda metà vs prima`);
  } else if (trend !== null && avg > 0) {
    lines.push(`andamento <strong>stabile</strong> tra le due metà del periodo (Δ ${trend > 0 ? "+" : ""}${trend.toFixed(0)}%)`);
  }
  if (cv > 60 && avg > 0) {
    lines.push(`alta variabilità giornaliera (CV ${cv.toFixed(0)}%) — delivery irregolare`);
  } else if (cv < 25 && avg > 0 && zeros === 0) {
    lines.push(`delivery <strong>regolare</strong> (CV ${cv.toFixed(0)}%)`);
  }
  return lines.join(" · ") + ".";
}

// ────────────────────────────────────────────────────────────────────────
// URL / state helpers
// ────────────────────────────────────────────────────────────────────────

function parseUrl() {
  const params = new URLSearchParams(location.search);
  return {
    section: params.get("section") || (location.hash || "").replace("#", "") || localStorage.getItem("fmm.section") || "spending",
    date: params.get("date") || null,
    client: params.get("client") || null,
  };
}

function pushUrl(section, date) {
  const params = new URLSearchParams();
  params.set("section", section);
  if (date) params.set("date", date);
  history.replaceState(null, "", `?${params.toString()}#${section}`);
  localStorage.setItem("fmm.section", section);
}

// ────────────────────────────────────────────────────────────────────────
// Sparkline SVG inline (no dipendenze esterne)
// ────────────────────────────────────────────────────────────────────────

function sparklineSvg(points, width = 200, height = 36, opts = {}) {
  // points: [{date: 'YYYY-MM-DD', spend: float}]
  if (!points || points.length < 2) {
    return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><text x="${width/2}" y="${height/2}" text-anchor="middle" dominant-baseline="middle" fill="#9b9ba3" font-size="10">no data</text></svg>`;
  }
  const xs = points.map((_, i) => i);
  const ys = points.map(p => p.spend || 0);
  const maxY = Math.max(...ys, 1);
  const minY = 0;
  const padX = 2, padY = 4;
  const w = width - padX * 2;
  const h = height - padY * 2;
  const pts = xs.map((x, i) => {
    const px = padX + (x / Math.max(xs.length - 1, 1)) * w;
    const py = padY + h - ((ys[i] - minY) / (maxY - minY || 1)) * h;
    return [px, py];
  });
  const path = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  // Mark zeros in red
  const dots = pts.map((p, i) => {
    if (ys[i] === 0) {
      return `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2" fill="#e5484d" />`;
    }
    return "";
  }).join("");
  // Last point highlight
  const last = pts[pts.length - 1];
  const lastDot = `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.5" fill="#ff6b35" />`;
  const stroke = opts.stroke || "#ff6b35";
  const fillAreaPath = `M${pts[0][0].toFixed(1)},${(padY + h).toFixed(1)} L${path.replace(/^M/, "")} L${last[0].toFixed(1)},${(padY + h).toFixed(1)} Z`;
  return `
    <svg class="${opts.cls || 'sparkline'}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path d="${fillAreaPath}" fill="${stroke}" fill-opacity="0.12" />
      <path d="${path}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
      ${dots}
      ${lastDot}
    </svg>
  `;
}

// ────────────────────────────────────────────────────────────────────────
// Fetch helpers
// ────────────────────────────────────────────────────────────────────────

async function fetchJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json();
}

async function loadManifest(section) {
  return fetchJson(`data/${section}/index.json`);
}

async function loadSnapshot(section, date) {
  return fetchJson(`data/${section}/${date}.json`);
}

// ────────────────────────────────────────────────────────────────────────
// Health dot
// ────────────────────────────────────────────────────────────────────────

function computeHealth(section, snap) {
  if (!snap) return { cls: "yellow", label: "Nessun dato" };
  const s = snap.summary || {};
  if (section === "spending") {
    const zero = s.zero_count || 0;
    const total = s.alerts_total || 0;
    if (zero >= 3) return { cls: "red", label: `${zero} account a zero · ${total} alert tot` };
    if (zero >= 1 || total >= 10) return { cls: "yellow", label: `${zero} zero · ${total} alert` };
    return { cls: "green", label: `${total} alert · tutto sotto controllo` };
  }
  // beefamily / aghc
  const fermi = s.fermi_attivi_tot || 0;
  const insoluti = (snap.fermi_attivi || []).filter(f => f.cause === "insoluto").length;
  if (insoluti >= 1) return { cls: "red", label: `${fermi} fermi · ${insoluti} INSOLUTI` };
  if (fermi >= 3) return { cls: "red", label: `${fermi} account fermi` };
  if (fermi >= 1) return { cls: "yellow", label: `${fermi} account fermi` };
  return { cls: "green", label: "Tutto attivo" };
}

function renderStatus(section, snap) {
  const card = document.getElementById(`status-${section}`);
  const dot = card.querySelector(".dot");
  const sub = card.querySelector(".status-sub");
  const h = computeHealth(section, snap);
  dot.className = "dot " + h.cls;
  sub.textContent = snap ? `${h.label} · check del ${fmtDateIT(snap.run_date)}` : h.label;
}

// ────────────────────────────────────────────────────────────────────────
// KPI grid
// ────────────────────────────────────────────────────────────────────────

function renderKpis(section, snap) {
  const box = document.getElementById(`kpi-${section}`);
  if (!snap) { box.innerHTML = ""; return; }
  const s = snap.summary || {};
  let html = "";
  if (section === "spending") {
    const zeroCls = (s.zero_count || 0) > 0 ? "critical" : "ok";
    html = `
      ${kpi("Alert tot", fmtNum(s.alerts_total), "")}
      ${kpi("Zero (€0)", fmtNum(s.zero_count), "", zeroCls)}
      ${kpi("Spike", fmtNum(s.spike_count), "")}
      ${kpi("Account", fmtNum((s.accounts_checked && Object.values(s.accounts_checked).reduce((a,b)=>a+b,0)) || 0), "Meta+Google+TikTok")}
      ${kpi("Speso ieri", fmtEUR(s.total_spend_yest), "")}
    `;
  } else if (section === "beefamily") {
    const fermCls = (s.fermi_attivi_tot || 0) >= 3 ? "critical" : (s.fermi_attivi_tot || 0) >= 1 ? "warning" : "ok";
    html = `
      ${kpi("Clienti", fmtNum(s.clienti_monitorati), "monitorati")}
      ${kpi("Fermi attivi", fmtNum(s.fermi_attivi_tot), "", fermCls)}
      ${kpi("Fermi nuovi", fmtNum(s.fermi_nuovi), "ieri")}
      ${kpi("Ripristini", fmtNum(s.ripristini), s.ripristini_insoluti ? `${s.ripristini_insoluti} ex-insoluti` : "")}
      ${kpi("Promemoria", fmtNum(s.promemoria_inviati), "inviati")}
    `;
  } else if (section === "aghc") {
    const fermCls = (s.fermi_attivi_tot || 0) >= 3 ? "critical" : (s.fermi_attivi_tot || 0) >= 1 ? "warning" : "ok";
    html = `
      ${kpi("Clienti", fmtNum(s.clienti_monitorati), "monitorati")}
      ${kpi("Account Meta", fmtNum(s.account_meta_unici), "unici")}
      ${kpi("Account TikTok", fmtNum(s.account_tiktok), "attivi")}
      ${kpi("Fermi attivi", fmtNum(s.fermi_attivi_tot), "", fermCls)}
      ${kpi("Fermi nuovi", fmtNum(s.fermi_nuovi), "ieri")}
      ${kpi("Ripristini", fmtNum(s.ripristini), s.ripristini_insoluti ? `${s.ripristini_insoluti} ex-insoluti` : "")}
    `;
  }
  box.innerHTML = html;
}

function kpi(label, value, sub = "", valueCls = "") {
  return `
    <div class="kpi">
      <span class="label">${label}</span>
      <span class="value ${valueCls}">${value}</span>
      ${sub ? `<span class="sub">${sub}</span>` : ""}
    </div>
  `;
}

// ────────────────────────────────────────────────────────────────────────
// Cards
// ────────────────────────────────────────────────────────────────────────

function getCardsForSection(section, snap) {
  // ── Sezioni speciali: medtech e other non leggono dagli snapshot fermi ──
  if (section === "medtech") {
    const sc = (STATE._owners && STATE._owners.sub_clients && STATE._owners.sub_clients.medtech) || {};
    return [{
      kind: "info",
      account_id: sc.meta_id || "—",
      name: "Med & Tech (CEA)",
      platform: "meta",
      report_url: sc.report_url,
      severity: "info",
      isMedtech: true,
    }];
  }
  if (section === "other") {
    const roster = STATE._otherRoster;
    if (!roster || !Array.isArray(roster.accounts)) return [];
    return roster.accounts.map(a => ({
      kind: "info",
      account_id: a.account_id,
      name: a.name || "—",
      platform: "meta",
      currency: a.currency,
      severity: "info",
      isOther: true,
    }));
  }
  if (!snap) return [];
  if (section === "spending") {
    const trend = snap.trend_30d || {};
    const zeros = (snap.zero_alerts || []).map(a => ({
      kind: "zero",
      account_id: a.account_id,
      name: a.name,
      platform: a.platform,
      spend_yest: a.spend_yest,
      avg7: a.avg7,
      delta_pct: a.delta_pct,
      triggers: a.triggers,
      cause: a.cause,
      trend: trend[a.account_id] || null,
      severity: a.cause === "Account sospeso o anomalia pagamenti" ? "critical" : "warning",
    }));
    const spikes = (snap.spike_alerts || []).map(a => ({
      kind: "spike",
      account_id: a.account_id,
      name: a.name,
      platform: a.platform,
      spend_yest: a.spend_yest,
      avg7: a.avg7,
      delta_pct: a.delta_pct,
      triggers: a.triggers,
      cause: null,
      trend: trend[a.account_id] || null,
      severity: "info",
    }));
    return [...zeros, ...spikes];
  }
  // beefamily / aghc — fermi_attivi + fermi_nuovi (i nuovi sono anche in fermi_attivi dopo lo script)
  const trend = snap.trend_14d_by_id || {};
  const fermi = snap.fermi_attivi || [];
  const newIds = new Set((snap.fermi_nuovi || []).map(f => f.account_id));
  return fermi.map(f => ({
    kind: newIds.has(f.account_id) ? "fermo_nuovo" : (f.status || "fermo"),
    account_id: f.account_id,
    name: f.account_name || (Array.isArray(f.clients) ? f.clients.join(" + ") : f.client),
    clients: f.clients || f.client,
    platform: f.platform,
    stopped_since: f.stopped_since,
    last_spend_date: f.last_spend_date,
    last_spend_value: f.last_spend_value !== undefined ? f.last_spend_value : f.last_spend_amount,
    notifications_count: f.notifications_count || f.count,
    status: f.status,
    cause: f.cause,
    shared: Array.isArray(f.clients) && f.clients.length > 1,
    trend: trend[f.account_id] || null,
    severity: f.cause === "insoluto" ? "critical" : (newIds.has(f.account_id) ? "warning" : "info"),
  }));
}

function renderCard(section, c) {
  // ── Card speciale: Med & Tech (CEA, 1 brand + link a report storico esterno) ──
  if (c.isMedtech) {
    const owner = accountOwner(c.account_id) || { owner: "cea", label: "CEA", color: "#38d39f", subclient: "Med & Tech" };
    const adUrl = adAccountUrl("meta", c.account_id);
    return `
      <article class="alert-card info" data-account-id="${c.account_id}" data-owner="cea" style="--owner-color:${owner.color}">
        <div class="breadcrumb"><span class="owner-label" style="color:${owner.color}">${owner.label}</span> <span class="bc-sep">›</span> <span class="muted">${owner.subclient}</span></div>
        <div class="row">
          <div class="title">Total Lift + Total Sculpt</div>
          <div class="badges">
            <span class="badge owner" style="background:${owner.color};color:#000;border-color:${owner.color}">${owner.label}</span>
            ${platformLogo("meta")}
            <span class="badge fermo_storico">Lead Ads</span>
          </div>
        </div>
        <div class="meta-text">Account Meta: <code>${c.account_id}</code> · Daily check ore 14:58</div>
        <div class="spend-line" style="gap:8px;flex-wrap:wrap">
          ${c.report_url ? `<a class="open-ad-btn" href="${c.report_url}" target="_blank" rel="noopener">↗ Report storico Med &amp; Tech</a>` : ""}
          ${adUrl ? `<a class="open-ad-btn" href="${adUrl}" target="_blank" rel="noopener" style="background:transparent;color:${owner.color};border:1px solid ${owner.color}">↗ Apri su Meta</a>` : ""}
        </div>
      </article>
    `;
  }

  // ── Card speciale: Altri (auto-discovered, info minimal) ──
  if (c.isOther) {
    const owner = accountOwner(c.account_id) || { owner: "other", label: "ALTRI", color: "#9b9ba3", subclient: c.name };
    const adUrl = adAccountUrl("meta", c.account_id);
    return `
      <article class="alert-card info" data-account-id="${c.account_id}" data-owner="other" style="--owner-color:${owner.color}">
        <div class="breadcrumb"><span class="owner-label" style="color:${owner.color}">${owner.label}</span> <span class="bc-sep">›</span> <span class="muted">${c.name || "—"}</span></div>
        <div class="row">
          <div class="title">${c.name || "—"}</div>
          <div class="badges">
            <span class="badge owner" style="background:${owner.color};color:#000;border-color:${owner.color}">${owner.label}</span>
            ${platformLogo("meta")}
          </div>
        </div>
        <div class="meta-text">Account: <code>${c.account_id}</code>${c.currency ? ` · ${c.currency}` : ""}</div>
        ${adUrl ? `<div class="spend-line"><a class="open-ad-btn" href="${adUrl}" target="_blank" rel="noopener">↗ Apri su Meta Ads Manager</a></div>` : ""}
      </article>
    `;
  }

  // Owner lookup (MIO CLIENTE > Sub-cliente)
  const owner = accountOwner(c.account_id);
  const breadcrumb = owner
    ? `<div class="breadcrumb"><span class="owner-label" style="color:${owner.color}">${owner.label}</span> <span class="bc-sep">›</span> <span class="muted">${owner.subclient || c.name || "—"}</span></div>`
    : "";

  let badges = [];
  if (owner) badges.push(`<span class="badge owner" style="background:${owner.color};color:#000;border-color:${owner.color}">${owner.label}</span>`);
  if (c.platform) badges.push(platformLogo(c.platform));
  if (c.kind === "zero") badges.push(`<span class="badge zero">ZERO</span>`);
  if (c.kind === "spike") badges.push(`<span class="badge spike">SPIKE</span>`);
  if (c.kind === "fermo_nuovo") badges.push(`<span class="badge zero">NUOVO</span>`);
  if (c.cause === "insoluto") badges.push(`<span class="badge insoluto">INSOLUTO</span>`);
  if (c.shared) badges.push(`<span class="badge shared">CONDIVISO</span>`);
  if (c.status === "fermo_storico") badges.push(`<span class="badge fermo_storico">STORICO</span>`);

  let title = c.name || "—";
  if (Array.isArray(c.clients) && c.clients.length > 1) {
    title = `${c.name || "—"} <span class="muted" style="font-weight:400">(${c.clients.join(" + ")})</span>`;
  } else if (Array.isArray(c.clients) && c.clients.length === 1) {
    title = `${c.clients[0]} <span class="muted" style="font-weight:400">— ${c.name || ""}</span>`;
  }

  let metaText = "";
  if (section === "spending") {
    metaText = `media 7gg: ${fmtEUR(c.avg7)}`;
  } else {
    const giorni = c.stopped_since ? daysAgo(c.stopped_since) : null;
    metaText = c.stopped_since
      ? `fermo da ${c.stopped_since}${giorni !== null ? ` (${giorni} gg)` : ""}`
      : c.last_spend_date ? `ultima spesa ${c.last_spend_date} (${fmtEUR(c.last_spend_value)})` : "nessuna spesa registrata in finestra";
  }

  let spendLine = "";
  if (section === "spending") {
    const spendCls = c.spend_yest === 0 ? "zero" : "";
    const dCls = c.delta_pct > 0 ? "positive" : c.delta_pct < 0 ? "negative" : "";
    const dStr = c.delta_pct !== null && c.delta_pct !== undefined ? `${c.delta_pct > 0 ? "+" : ""}${fmtNum(c.delta_pct, 1)}%` : "—";
    spendLine = `
      <div class="spend-line">
        <span class="spend-yest ${spendCls}">${fmtEUR(c.spend_yest)}</span>
        <span class="delta ${dCls}">${dStr}</span>
      </div>
    `;
  } else {
    const promem = c.notifications_count !== undefined ? `${c.notifications_count} promemoria inviati` : "";
    spendLine = promem ? `<div class="spend-line"><span class="muted" style="font-size:12px">${promem}</span></div>` : "";
  }

  const cause = c.cause && section === "spending" ? `<div class="cause">${c.cause}</div>` : "";
  const sev = c.severity || "info";

  const sparkW = 280, sparkH = 36;
  const sparkPoints = c.trend || [];
  const sparkSvg = sparkPoints.length >= 2 ? sparklineSvg(sparkPoints, sparkW, sparkH) : "";

  return `
    <article class="alert-card ${sev}" data-account-id="${c.account_id}" data-platform="${(c.platform || "").toLowerCase()}" data-kind="${c.kind}" data-cause="${c.cause || ""}" data-shared="${c.shared ? '1' : '0'}" data-owner="${owner ? owner.owner : ''}" ${owner ? `style="--owner-color:${owner.color}"` : ''}>
      ${breadcrumb}
      <div class="row">
        <div class="title">${title}</div>
        <div class="badges">${badges.join("")}</div>
      </div>
      <div class="meta-text">${metaText}</div>
      ${spendLine}
      ${cause}
      ${sparkSvg}
    </article>
  `;
}

function passesFilter(section, c, filterChip, filterQuery) {
  const q = filterQuery.trim().toLowerCase();
  if (q) {
    const haystack = ((c.name || "") + " " + (Array.isArray(c.clients) ? c.clients.join(" ") : (c.clients || ""))).toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (filterChip === "all") return true;
  if (section === "spending") {
    if (filterChip === "zero")  return c.kind === "zero";
    if (filterChip === "spike") return c.kind === "spike";
    return (c.platform || "") === filterChip;   // Meta/Google/TikTok
  }
  if (filterChip === "fermo_nuovo") return c.kind === "fermo_nuovo";
  if (filterChip === "insoluto")    return c.cause === "insoluto";
  if (filterChip === "shared")      return c.shared;
  return (c.platform || "").toLowerCase() === filterChip;  // meta/google/tiktok
}

function renderAlerts(section) {
  const st = STATE[section];
  const cards = getCardsForSection(section, st.current);
  const filtered = cards.filter(c => passesFilter(section, c, st.filterChip, st.filterQuery));
  const box = document.getElementById(`alerts-${section}`);
  if (filtered.length === 0) {
    if (cards.length === 0) {
      box.innerHTML = `<div class="empty-state">Nessun alert/fermo in questo snapshot. ${section === "spending" ? "Tutto sotto controllo. ✅" : "Tutti gli account stanno girando. ✅"}</div>`;
    } else {
      box.innerHTML = `<div class="empty-state">Nessun risultato con i filtri correnti.</div>`;
    }
    return;
  }
  // Sort: critical first, then warning, then info; secondarily by name
  filtered.sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    const d = (order[a.severity] || 9) - (order[b.severity] || 9);
    if (d !== 0) return d;
    return (a.name || "").localeCompare(b.name || "");
  });
  box.innerHTML = filtered.map(c => renderCard(section, c)).join("");
  // Wire click → modal
  box.querySelectorAll(".alert-card").forEach(el => {
    el.addEventListener("click", () => {
      const aid = el.dataset.accountId;
      const c = cards.find(x => x.account_id === aid);
      if (c) showModal(section, c);
    });
  });
}

// ────────────────────────────────────────────────────────────────────────
// Modal drill-down
// ────────────────────────────────────────────────────────────────────────

function showModal(section, c) {
  const modal = document.getElementById("modal");
  const title = document.getElementById("modal-title");
  const body  = document.getElementById("modal-body");

  let titleStr = c.name || "—";
  if (Array.isArray(c.clients) && c.clients.length > 0) titleStr = `${c.name || ""} — ${c.clients.join(" + ")}`;
  title.innerHTML = titleStr;

  let kvHtml = "";
  function kv(k, v) { kvHtml += `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`; }
  kv("Piattaforma", c.platform || "—");
  kv("Account ID", `<code>${c.account_id}</code>`);
  if (section === "spending") {
    kv("Spesa ieri", `<span style="${c.spend_yest===0?'color:#e5484d':''}">${fmtEUR(c.spend_yest)}</span>`);
    kv("Media 7gg", fmtEUR(c.avg7));
    if (c.delta_pct !== null && c.delta_pct !== undefined) kv("Delta vs media", `${c.delta_pct > 0 ? "+" : ""}${fmtNum(c.delta_pct, 1)}%`);
    if (c.triggers) kv("Triggers", c.triggers.join(", "));
    if (c.cause) kv("Causa", c.cause);
  } else {
    kv("Status", c.status || "—");
    kv("Causa", c.cause || "generico");
    if (c.shared) kv("Account condiviso", "sì (notifiche su 2 canali)");
    if (c.stopped_since) {
      const g = daysAgo(c.stopped_since);
      kv("Fermo dal", `${c.stopped_since}${g !== null ? ` (${g} giorni fa)` : ""}`);
    }
    if (c.last_spend_date) kv("Ultima spesa", `${c.last_spend_date} (${fmtEUR(c.last_spend_value)})`);
    if (c.notifications_count !== undefined) kv("Promemoria inviati", c.notifications_count);
  }

  // Pulsante deep-link all'account pubblicitario
  const adUrl = adAccountUrl(c.platform, c.account_id);
  const openBtn = adUrl
    ? `<a class="open-ad-btn" href="${adUrl}" target="_blank" rel="noopener">↗ Apri su ${platformLabel(c.platform)}</a>`
    : "";

  // Trend + rational
  let sparkBlock = "";
  if (c.trend && c.trend.length >= 2) {
    const rational = analyzeTrend(c.trend);
    sparkBlock = `
      <h3>Trend ${c.trend.length} giorni</h3>
      ${sparklineSvg(c.trend, 540, 120, { cls: "sparkline-large" })}
      ${rational ? `<p class="rational">${rational}</p>` : ""}
    `;
  }

  body.innerHTML = `<div>${kvHtml}</div>${openBtn}${sparkBlock}`;
  modal.hidden = false;
}

function closeModal() {
  document.getElementById("modal").hidden = true;
}

// ────────────────────────────────────────────────────────────────────────
// Date picker
// ────────────────────────────────────────────────────────────────────────

function renderDatePicker(section) {
  const sel = document.getElementById(`date-${section}`);
  const checks = (STATE[section].manifest && STATE[section].manifest.checks) || [];
  if (checks.length === 0) {
    sel.innerHTML = `<option value="">— nessun dato —</option>`;
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  const current = STATE[section].current ? STATE[section].current.run_date : checks[0].date;
  sel.innerHTML = checks.map(c =>
    `<option value="${c.date}" ${c.date === current ? "selected" : ""}>${fmtDateIT(c.date)}</option>`
  ).join("");
}

// ────────────────────────────────────────────────────────────────────────
// Section orchestrator
// ────────────────────────────────────────────────────────────────────────

async function loadSection(section, targetDate = null) {
  try {
    // ── Sezioni speciali senza snapshot temporali ──
    if (section === "medtech") {
      const status = document.getElementById("status-medtech");
      const dot = status.querySelector(".dot");
      const sub = status.querySelector(".status-sub");
      dot.className = "dot green";
      sub.textContent = "Daily check Total Lift / Total Sculpt — gira tutti i giorni alle 14:58";
      document.getElementById("kpi-medtech").innerHTML = "";
      renderAlerts(section);
      return;
    }
    if (section === "other") {
      // Carica roster Altri se non già in cache
      if (!STATE._otherRoster) {
        STATE._otherRoster = await fetchJson("../scripts/other_roster.json").catch(() => ({accounts: []}));
      }
      const accs = (STATE._otherRoster.accounts || []);
      const status = document.getElementById("status-other");
      const dot = status.querySelector(".dot");
      const sub = status.querySelector(".status-sub");
      if (accs.length === 0) {
        dot.className = "dot yellow";
        sub.textContent = "Roster non ancora popolato — il task fmm-discover-other-accounts gira ogni notte alle 06:00";
      } else {
        dot.className = "dot green";
        sub.textContent = `${accs.length} account Meta auto-discovered · ultimo update ${STATE._otherRoster.last_updated || "—"}`;
      }
      document.getElementById("kpi-other").innerHTML = "";
      renderAlerts(section);
      return;
    }
    // ── Sezioni standard (spending / beefamily / aghc) ──
    if (!STATE[section].manifest) {
      STATE[section].manifest = await loadManifest(section);
    }
    const checks = STATE[section].manifest.checks || [];
    if (checks.length === 0) {
      STATE[section].current = null;
      renderStatus(section, null);
      renderKpis(section, null);
      renderAlerts(section);
      renderDatePicker(section);
      return;
    }
    const date = targetDate || (STATE[section].current && STATE[section].current.run_date) || checks[0].date;
    if (!STATE[section].current || STATE[section].current.run_date !== date) {
      STATE[section].current = await loadSnapshot(section, date);
    }
    renderStatus(section, STATE[section].current);
    renderKpis(section, STATE[section].current);
    renderAlerts(section);
    renderDatePicker(section);
  } catch (err) {
    console.error(`Errore caricamento ${section}:`, err);
    const alertsEl = document.getElementById(`alerts-${section}`);
    if (alertsEl) alertsEl.innerHTML =
      `<div class="empty-state">Errore di caricamento (${err.message}). La sezione sarà popolata dopo il primo run del task scheduled.</div>`;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tabs
// ────────────────────────────────────────────────────────────────────────

function activateTab(section, date = null) {
  if (!SECTIONS.includes(section)) section = "spending";
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.section === section));
  document.querySelectorAll(".section").forEach(s => s.classList.toggle("active", s.id === `section-${section}`));
  pushUrl(section, date || (STATE[section].current && STATE[section].current.run_date));
  if (!STATE[section].current) {
    loadSection(section, date);
  } else if (date && STATE[section].current.run_date !== date) {
    loadSection(section, date);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Event wiring
// ────────────────────────────────────────────────────────────────────────

function wireEvents() {
  // Tab switcher
  document.getElementById("tabs").addEventListener("click", (e) => {
    const a = e.target.closest("a.tab");
    if (!a) return;
    e.preventDefault();
    activateTab(a.dataset.section);
  });

  // Date picker
  SECTIONS.forEach(section => {
    document.getElementById(`date-${section}`).addEventListener("change", (e) => {
      loadSection(section, e.target.value);
      pushUrl(section, e.target.value);
    });
  });

  // Filter chips
  document.querySelectorAll(".filter-chips").forEach(box => {
    box.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      const section = box.dataset.section;
      box.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      STATE[section].filterChip = btn.dataset.filter;
      localStorage.setItem(`fmm.${section}.filterChip`, btn.dataset.filter);
      renderAlerts(section);
    });
  });

  // Filter search
  document.querySelectorAll(".filter-input").forEach(inp => {
    inp.addEventListener("input", (e) => {
      const section = inp.dataset.section;
      STATE[section].filterQuery = e.target.value;
      localStorage.setItem(`fmm.${section}.filterQuery`, e.target.value);
      renderAlerts(section);
    });
  });

  // Reload button
  document.getElementById("btn-reload").addEventListener("click", () => {
    SECTIONS.forEach(s => { STATE[s].manifest = null; STATE[s].current = null; });
    loadAll();
  });

  // Modal
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal").addEventListener("click", (e) => {
    if (e.target.id === "modal") closeModal();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
}

// ────────────────────────────────────────────────────────────────────────
// Restore filters from localStorage
// ────────────────────────────────────────────────────────────────────────

function restoreFilters() {
  SECTIONS.forEach(section => {
    const chip = localStorage.getItem(`fmm.${section}.filterChip`) || "all";
    const query = localStorage.getItem(`fmm.${section}.filterQuery`) || "";
    STATE[section].filterChip = chip;
    STATE[section].filterQuery = query;
    document.querySelectorAll(`.filter-chips[data-section="${section}"] .chip`).forEach(c => {
      c.classList.toggle("active", c.dataset.filter === chip);
    });
    const inp = document.querySelector(`.filter-input[data-section="${section}"]`);
    if (inp) inp.value = query;
  });
}

// ────────────────────────────────────────────────────────────────────────
// Bootstrap
// ────────────────────────────────────────────────────────────────────────

async function loadAll() {
  await Promise.all(SECTIONS.map(s => loadSection(s)));
}

(async function init() {
  wireEvents();
  restoreFilters();

  // Carica ownership map PRIMA del primo render delle card
  await loadOwnersMap();

  const url = parseUrl();
  activateTab(url.section);

  await loadAll();

  // Reload tab once data ready (in case targetDate from URL)
  if (url.date && STATE[url.section]) {
    await loadSection(url.section, url.date);
  }

  document.getElementById("page-loaded").textContent = new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
})();
