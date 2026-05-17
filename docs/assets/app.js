// fmm-dashboard hub — versione placeholder (Fase 0).
// Carica i manifest delle 3 sezioni e mostra una card per l'ultimo check.
// La dashboard piena (sparkline + drill-down + filtri) arriva in Fase 4.

const SECTIONS = ["spending", "beefamily", "aghc"];

// Tab switcher con deep-link via URL hash + ?section=...
function activateTab(section) {
  if (!SECTIONS.includes(section)) section = "spending";
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.section === section));
  document.querySelectorAll(".section").forEach(s => s.classList.toggle("active", s.id === `section-${section}`));
  localStorage.setItem("fmm.section", section);
  history.replaceState(null, "", `#${section}`);
}

function parseInitialSection() {
  const fromHash = (location.hash || "").replace("#", "");
  const fromQuery = new URLSearchParams(location.search).get("section");
  const fromStorage = localStorage.getItem("fmm.section");
  return fromHash || fromQuery || fromStorage || "spending";
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const a = e.target.closest("a.tab");
  if (!a) return;
  e.preventDefault();
  activateTab(a.dataset.section);
});

function fmtNum(n, decimals = 0) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("it-IT", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtEUR(n) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function healthDot(section, check) {
  if (!check) return '<span class="dot yellow"></span>';
  if (section === "spending") {
    const zero = check.zero || 0;
    if (zero >= 3) return '<span class="dot red"></span>';
    if (zero >= 1) return '<span class="dot yellow"></span>';
    return '<span class="dot green"></span>';
  }
  // beefamily / aghc
  const fermi = check.fermi_attivi_tot || 0;
  if (fermi >= 3) return '<span class="dot red"></span>';
  if (fermi >= 1) return '<span class="dot yellow"></span>';
  return '<span class="dot green"></span>';
}

async function loadSection(section) {
  const container = document.getElementById(`card-${section}`);
  try {
    const res = await fetch(`data/${section}/index.json`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const idx = await res.json();
    const last = (idx.checks || [])[0];
    if (!last) {
      container.innerHTML = `<p class="muted">Nessuno snapshot ancora pubblicato.</p>`;
      return;
    }
    container.innerHTML = renderCard(section, last, idx);
  } catch (err) {
    container.innerHTML = `<p class="muted">Manifest non disponibile (${err.message}).</p>`;
  }
}

function renderCard(section, check, idx) {
  const dot = healthDot(section, check);
  const date = check.date;
  let kpis = "";
  if (section === "spending") {
    kpis = `
      <div class="kpi"><span class="label">Alert tot</span><span class="value">${fmtNum(check.alerts_total)}</span></div>
      <div class="kpi"><span class="label">Zero</span><span class="value">${fmtNum(check.zero)}</span></div>
      <div class="kpi"><span class="label">Spike</span><span class="value">${fmtNum(check.spike)}</span></div>
      <div class="kpi"><span class="label">Account</span><span class="value">${fmtNum(check.accounts_checked)}</span></div>
      <div class="kpi"><span class="label">Speso ieri</span><span class="value">${fmtEUR(check.total_spend_yest)}</span></div>
    `;
  } else {
    kpis = `
      <div class="kpi"><span class="label">Clienti</span><span class="value">${fmtNum(check.clienti_monitorati)}</span></div>
      <div class="kpi"><span class="label">Fermi nuovi</span><span class="value">${fmtNum(check.fermi_nuovi)}</span></div>
      <div class="kpi"><span class="label">Fermi attivi</span><span class="value">${fmtNum(check.fermi_attivi_tot)}</span></div>
      <div class="kpi"><span class="label">Ripristini</span><span class="value">${fmtNum(check.ripristini)}</span></div>
      <div class="kpi"><span class="label">Promem.</span><span class="value">${fmtNum(check.promemoria_inviati)}</span></div>
    `;
  }
  return `
    <div class="card">
      <h3>${dot}Ultimo check &middot; ${date}</h3>
      <div class="meta">Manifest aggiornato: ${idx.last_updated || "—"}</div>
      <div class="kpi-row">${kpis}</div>
      <div class="meta" style="margin-top:12px">
        <a href="data/${section}/${date}.json" target="_blank">snapshot raw JSON ↗</a>
        &middot; <a href="data/${section}/index.json" target="_blank">manifest ↗</a>
      </div>
    </div>
  `;
}

(async function init() {
  activateTab(parseInitialSection());
  document.getElementById("deploy-info").textContent = new Date().toISOString().slice(0, 10);
  await Promise.all(SECTIONS.map(loadSection));
})();
