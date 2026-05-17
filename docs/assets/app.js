// fmm-dashboard hub — versione completa (Fase 4)
// Carica i manifest delle 3 sezioni, popola KPI + cards + sparkline.
// Deep-link via ?section=X&date=Y&client=Z. Filtri persistenti in localStorage.

const SECTIONS = ["spending", "beefamily", "aghc"];
const STATE = {
  spending:  { manifest: null, current: null, filterChip: "all", filterQuery: "" },
  beefamily: { manifest: null, current: null, filterChip: "all", filterQuery: "" },
  aghc:      { manifest: null, current: null, filterChip: "all", filterQuery: "" },
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
  let badges = [];
  if (c.platform) badges.push(`<span class="badge ${c.platform.toLowerCase()}">${c.platform}</span>`);
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
    <article class="alert-card ${sev}" data-account-id="${c.account_id}" data-platform="${(c.platform || "").toLowerCase()}" data-kind="${c.kind}" data-cause="${c.cause || ""}" data-shared="${c.shared ? '1' : '0'}">
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

  let sparkBlock = "";
  if (c.trend && c.trend.length >= 2) {
    sparkBlock = `
      <h3>Trend ${c.trend.length} giorni</h3>
      ${sparklineSvg(c.trend, 540, 120, { cls: "sparkline-large" })}
    `;
  }

  body.innerHTML = `<div>${kvHtml}</div>${sparkBlock}`;
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
    renderStatus(section, null);
    document.getElementById(`alerts-${section}`).innerHTML =
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

  const url = parseUrl();
  activateTab(url.section);

  await loadAll();

  // Reload tab once data ready (in case targetDate from URL)
  if (url.date && STATE[url.section]) {
    await loadSection(url.section, url.date);
  }

  document.getElementById("page-loaded").textContent = new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
})();
