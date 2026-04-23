// EpiChat landing page — dynamic rendering for layers, curve, roadmap, faq
(function () {

// ============ LAYER PIPELINE ============
const LAYERS = [
  {
    idx: "01", status: "PROTOTYPE", title: "Parameter extraction",
    desc: "LLM with a purpose-built epi system prompt parses a query into a structured JSON schema.",
    inLbl: "natural language", outLbl: "JSON params",
  },
  {
    idx: "02", status: "PROPOSED", title: "Data-informed resolver",
    desc: "Enriches params with country-specific contact matrices, demographics, and vaccination rates.",
    inLbl: `"COVID in Kenya"`, outLbl: "calibrated params",
  },
  {
    idx: "03", status: "PROTOTYPE", title: "Template code generation",
    desc: "Validated parameters injected into Jinja2 templates per disease model — no free-form simulation code.",
    inLbl: "validated params", outLbl: "Starsim script",
  },
  {
    idx: "04", status: "PROTOTYPE", title: "Sandboxed execution",
    desc: "Timeout-bounded run with an automated error-recovery loop that re-invokes the LLM on failure.",
    inLbl: "script", outLbl: "raw results + traces",
  },
  {
    idx: "05", status: "PROTOTYPE", title: "Results summarization",
    desc: "Second LLM call translates peak timing, attack rate, intervention effect into plain language with uncertainty hedges.",
    inLbl: "simulation output", outLbl: "readable summary",
  },
];

const layersHost = document.getElementById("layers");
if (layersHost) {
  layersHost.innerHTML = LAYERS.map((L, i) => `
    <div style="display: grid; grid-template-columns: 80px 140px 1fr 240px; gap: 0;
                ${i < LAYERS.length - 1 ? "border-bottom: 1px solid var(--rule);" : ""}
                align-items: stretch;">
      <div style="padding: 1.6rem 1rem; border-right: 1px solid var(--rule); display: flex; flex-direction: column; gap: 0.3rem; align-items: center; justify-content: center; background: var(--paper-3);">
        <div class="mono" style="font-size: 0.64rem; color: var(--ink-3); letter-spacing: 0.14em;">LAYER</div>
        <div class="mono" style="font-size: 2rem; font-weight: 500; color: var(--accent); line-height: 1;">${L.idx}</div>
      </div>
      <div style="padding: 1.6rem 1.2rem; border-right: 1px solid var(--rule); display: flex; align-items: flex-start;">
        <span class="tag ${L.status === "PROTOTYPE" ? "filled" : "accent"}">${L.status}</span>
      </div>
      <div style="padding: 1.6rem 1.2rem; border-right: 1px solid var(--rule);">
        <h3 style="font-family: var(--serif); font-size: 1.2rem; font-weight: 500; margin: 0 0 0.4rem; letter-spacing: -0.01em;">${L.title}</h3>
        <p style="font-size: 0.95rem; line-height: 1.5; color: var(--ink-2); margin: 0; max-width: 52ch; text-wrap: pretty;">${L.desc}</p>
      </div>
      <div style="padding: 1.6rem 1.2rem; background: var(--paper-3); font-family: var(--mono); font-size: 0.76rem; display: flex; flex-direction: column; justify-content: center; gap: 0.4rem;">
        <div style="color: var(--ink-3);">▸ in  <span style="color: var(--ink);">${L.inLbl}</span></div>
        <div style="color: var(--ink-3);">▾ out <span style="color: var(--accent);">${L.outLbl}</span></div>
      </div>
    </div>
  `).join("");
}

// ============ EPI CURVE ============
// Simple SEIR numerical integration with vaccination

function seir({ N, beta, sigma, gamma, vax, days, I0 = 100, noise = 0 }) {
  // seed as exposed, not infectious, so initial I starts at 0 and grows smoothly
  let S = N * (1 - vax) - I0;
  let E = I0;
  let I = 0;
  let R = N * vax;
  const dt = 0.1;
  const out = [];
  let nextRecord = 0;
  for (let d = 0; d <= days + 1e-6; d += dt) {
    const newE = beta * S * I / N * dt;
    const newI = sigma * E * dt;
    const newR = gamma * I * dt;
    S -= newE;
    E += newE - newI;
    I += newI - newR;
    R += newR;
    if (d + 1e-6 >= nextRecord) {
      const n = 1 + (Math.random() - 0.5) * noise;
      out.push({ t: nextRecord, S, E, I: I * n, R });
      nextRecord += 1;
    }
  }
  return out;
}

const SCENARIOS = {
  measles: { N: 1200000, beta: 1.4, sigma: 1/12, gamma: 1/8, vax: 0.65, days: 200, I0: 500,
             label: "Measles · SEIR · n=1.2M · 500 seeds",
             peakCopy: "bell-shaped outbreak · growth damped by residual vaccination coverage" },
  covid:   { N: 330000000, beta: 0.5, sigma: 1/5, gamma: 1/8, vax: 0.40, days: 200, I0: 10000,
             label: "COVID-19 · SEIR · n=330M · 200 seeds",
             peakCopy: "wave peaks mid-window · IFR-weighted burden concentrated in 65+" },
  flu:     { N: 50000, beta: 0.55, sigma: 1/2, gamma: 1/5, vax: 0.45, days: 200, I0: 5,
             label: "Seasonal influenza · SEIR · n=50k · seasonal forcing",
             peakCopy: "seasonal peak · attack rate scales with vax coverage" }
};

function drawCurve(scenario = "measles") {
  const cfg = SCENARIOS[scenario];
  const W = 1200, H = 420, PAD_L = 70, PAD_R = 120, PAD_T = 30, PAD_B = 50;
  const iw = W - PAD_L - PAD_R, ih = H - PAD_T - PAD_B;

  // build ensemble
  const ENSEMBLE = 30;
  const runs = [];
  for (let k = 0; k < ENSEMBLE; k++) {
    runs.push(seir({ ...cfg, noise: 0.12, I0: cfg.I0 * (0.8 + Math.random() * 0.4) }));
  }
  const central = seir(cfg);

  const maxI = Math.max(...central.map(p => p.I)) * 1.15;

  const x = t => PAD_L + (t / cfg.days) * iw;
  const y = v => PAD_T + ih - (v / maxI) * ih;

  // pathify helpers
  const path = (arr, fn) => arr.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${fn(p).toFixed(1)}`).join(" ");

  // grid lines
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(f * maxI));
  const xTicks = [0, 50, 100, 150, 200].filter(t => t <= cfg.days);

  const peakPt = central.reduce((a, b) => b.I > a.I ? b : a, central[0]);

  const svg = `
<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: auto; display: block; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 3px;" font-family="JetBrains Mono, ui-monospace, monospace">
  <!-- plot area bg grid -->
  <g stroke="var(--rule)" stroke-width="0.5" opacity="0.6">
    ${yTicks.map(v => `<line x1="${PAD_L}" y1="${y(v)}" x2="${W - PAD_R}" y2="${y(v)}" stroke-dasharray="1 3"/>`).join("")}
    ${xTicks.map(t => `<line x1="${x(t)}" y1="${PAD_T}" x2="${x(t)}" y2="${H - PAD_B}" stroke-dasharray="1 3"/>`).join("")}
  </g>
  <!-- axes -->
  <line x1="${PAD_L}" y1="${H - PAD_B}" x2="${W - PAD_R}" y2="${H - PAD_B}" stroke="var(--ink-3)" stroke-width="1"/>
  <line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${H - PAD_B}" stroke="var(--ink-3)" stroke-width="1"/>

  <!-- ensemble -->
  <g fill="none" stroke="var(--accent)" stroke-width="1" opacity="0.18">
    ${runs.map(r => `<path d="${path(r, p => y(p.I))}"/>`).join("")}
  </g>

  <!-- central I(t) -->
  <path d="${path(central, p => y(p.I))}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-dasharray="1000" stroke-dashoffset="1000">
    <animate attributeName="stroke-dashoffset" from="1000" to="0" dur="1.8s" fill="freeze" />
  </path>

  <!-- peak marker -->
  <g>
    <circle cx="${x(peakPt.t)}" cy="${y(peakPt.I)}" r="4" fill="var(--ink)" />
    <circle cx="${x(peakPt.t)}" cy="${y(peakPt.I)}" r="10" fill="none" stroke="var(--ink)" stroke-width="0.8" opacity="0.4">
      <animate attributeName="r" from="4" to="14" dur="1.6s" repeatCount="indefinite" />
      <animate attributeName="opacity" from="0.5" to="0" dur="1.6s" repeatCount="indefinite" />
    </circle>
    <line x1="${x(peakPt.t)}" y1="${y(peakPt.I)}" x2="${x(peakPt.t) + 20}" y2="${y(peakPt.I) - 30}" stroke="var(--ink)" stroke-width="0.8"/>
    <text x="${x(peakPt.t) + 24}" y="${y(peakPt.I) - 34}" font-size="11" fill="var(--ink)">peak t=${Math.round(peakPt.t)}d</text>
    <text x="${x(peakPt.t) + 24}" y="${y(peakPt.I) - 20}" font-size="10" fill="var(--ink-3)">I=${Math.round(peakPt.I).toLocaleString()}</text>
  </g>

  <!-- y ticks labels -->
  ${yTicks.map(v => `
    <text x="${PAD_L - 10}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--ink-3)">${v.toLocaleString()}</text>
  `).join("")}
  <!-- x ticks -->
  ${xTicks.map(t => `
    <text x="${x(t)}" y="${H - PAD_B + 18}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${t}d</text>
  `).join("")}

  <!-- labels -->
  <text x="${PAD_L}" y="${PAD_T - 10}" font-size="10" fill="var(--ink-3)" letter-spacing="1.2">I(T) · INFECTED · ENSEMBLE N=${ENSEMBLE}</text>
  <text x="${W - PAD_R - 4}" y="${H - PAD_B + 34}" text-anchor="end" font-size="10" fill="var(--ink-3)" letter-spacing="1.2">TIME (DAYS) →</text>

  <!-- right panel: summary -->
  <g transform="translate(${W - PAD_R + 12}, ${PAD_T + 4})">
    <text font-size="9.5" fill="var(--ink-3)" letter-spacing="1.4">SCENARIO</text>
    <text y="16" font-size="11" fill="var(--ink)">${scenario.toUpperCase()}</text>

    <text y="44" font-size="9.5" fill="var(--ink-3)" letter-spacing="1.4">MODEL</text>
    <text y="60" font-size="11" fill="var(--ink)">SEIR</text>

    <text y="88" font-size="9.5" fill="var(--ink-3)" letter-spacing="1.4">POPULATION</text>
    <text y="104" font-size="11" fill="var(--ink)">n=${cfg.N.toLocaleString()}</text>

    <text y="132" font-size="9.5" fill="var(--ink-3)" letter-spacing="1.4">R₀ EST</text>
    <text y="148" font-size="11" fill="var(--accent)">${(cfg.beta / cfg.gamma).toFixed(2)}</text>

    <text y="176" font-size="9.5" fill="var(--ink-3)" letter-spacing="1.4">VAX COVERAGE</text>
    <text y="192" font-size="11" fill="var(--ink)">${Math.round(cfg.vax*100)}%</text>

    <text y="220" font-size="9.5" fill="var(--ink-3)" letter-spacing="1.4">STATUS</text>
    <text y="236" font-size="11" fill="var(--accent)">● converged</text>
  </g>
</svg>
<div style="font-family: var(--mono); font-size: 0.76rem; color: var(--ink-3); padding: 0.8rem 0; letter-spacing: 0.05em;">
  ⎿ narration · <span style="color: var(--ink-2); font-style: normal;">${cfg.peakCopy}</span>
</div>
  `;

  const host = document.getElementById("curve-host");
  host.innerHTML = svg;
}

drawCurve("measles");
document.querySelectorAll("[data-scenario]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-scenario]").forEach(b => b.classList.remove("accent"));
    btn.classList.add("accent");
    drawCurve(btn.dataset.scenario);
  });
});
document.querySelector("[data-scenario='measles']").classList.add("accent");


// ============ ROADMAP ============
const ROADMAP = [
  { p: "P4", name: "Country demographics (UN WPP, World Bank)", complexity: "Low–Medium", impact: "High", priority: 1 },
  { p: "P1", name: "Country contact matrices (Prem et al. 2021, 177 countries)", complexity: "Medium", impact: "High", priority: 2 },
  { p: "P3", name: "Age-specific severity (IFR, hospitalization by age)", complexity: "Medium", impact: "High", priority: 3 },
  { p: "P2", name: "HouseholdNet (DHS, IPUMS)", complexity: "High", impact: "Medium", priority: 4 },
  { p: "P5", name: "Calibration against surveillance data (OWID, CDC, FluNet)", complexity: "High", impact: "Very High", priority: 5 },
  { p: "P6", name: "STI & multi-route transmission (MFNet, MSMNet)", complexity: "Very High", impact: "Medium", priority: 6 },
  { p: "P7", name: "Geospatial / metapopulation (WorldPop, mobility)", complexity: "Very High", impact: "High", priority: 7 },
];

const impactBar = (v) => {
  const n = { "Medium": 2, "High": 3, "Very High": 4 }[v] || 1;
  return Array.from({length: 4}).map((_, i) =>
    `<span style="width: 5px; height: 12px; background: ${i < n ? 'var(--accent)' : 'var(--rule)'}; display: inline-block;"></span>`
  ).join("");
};

const roadmapHost = document.getElementById("roadmap-rows");
if (roadmapHost) {
  roadmapHost.innerHTML = ROADMAP.map((r, i) => `
    <div style="display: grid; grid-template-columns: 60px 1fr 140px 140px; gap: 0; background: ${i % 2 ? "var(--paper-2)" : "var(--paper)"};
                ${i < ROADMAP.length - 1 ? "border-bottom: 1px solid var(--rule);" : ""}">
      <div style="padding: 1rem; border-right: 1px solid var(--rule); font-family: var(--mono); color: var(--ink-3); display: flex; align-items: center; gap: 0.4rem;">
        <span style="color: var(--accent); font-weight: 500;">${r.priority}</span>
        <span style="font-size: 0.72rem;">${r.p}</span>
      </div>
      <div style="padding: 1rem 1.2rem; border-right: 1px solid var(--rule); font-family: var(--serif); font-size: 1rem;">${r.name}</div>
      <div style="padding: 1rem 1.2rem; border-right: 1px solid var(--rule); font-family: var(--mono); font-size: 0.78rem; color: var(--ink-2); display: flex; align-items: center;">${r.complexity}</div>
      <div style="padding: 1rem 1.2rem; font-family: var(--mono); font-size: 0.78rem; color: var(--ink-2); display: flex; align-items: center; gap: 0.6rem;">
        <span style="display: flex; gap: 2px; align-items: flex-end;">${impactBar(r.impact)}</span>
        <span>${r.impact}</span>
      </div>
    </div>
  `).join("");
}


// ============ FAQ ============
const FAQ = [
  {
    q: "Is this safe? Can the LLM produce invalid simulations?",
    a: "EpiChat never runs free-form LLM code. Layer 3 uses Jinja2 templates — validated parameters injected into fixed Python scripts. Layer 4 sandboxes execution with a 90-second timeout and a 3-attempt error-recovery loop.",
  },
  {
    q: "Which modeling framework do you use?",
    a: "Starsim — the Institute for Disease Modeling's open-source agent-based framework. Its declarative, dictionary-based parameter interface is unusually well-suited to LLM-driven translation from natural language. The architecture is framework-agnostic; EpiModel, Epydemic, and Mesa are natural follow-ons.",
  },
  {
    q: "What diseases does it handle today?",
    a: "SIR, SEIR, SIS — covering COVID (acute), influenza, measles, SARS-like diseases, Ebola, gonorrhea, and generic infections. SIRS, SEIRS, and SEIAR (waning immunity and asymptomatic transmission) land in months 1–6 of the proposed project.",
  },
  {
    q: "How do you validate accuracy?",
    a: "Two studies. (1) Concordance study: EpiChat-generated Starsim scripts compared against expert-coded reference models across COVID, measles, influenza, and HIV scenarios. Scoring on parameter-match rate within ±10% (continuous) or exact (categorical) and compartmental-structure correctness. (2) Usability study: masters-level epidemiology students complete standardized tasks; SUS scoring plus task-completion rates.",
  },
  {
    q: "Will it be open source?",
    a: "Yes. Open release under MIT license — plus a hosted demo and preprint — in month 11–12 of the proposed project.",
  },
  {
    q: "How can I help?",
    a: "Three roles: domain experts for benchmark queries, data contributors for Layer 02 resolver inputs (contact matrices, surveillance feeds, demographics), and modelers for expert reference code. Even a 'let's grab coffee' level ask works — email Yuke.",
  },
];

const faqHost = document.getElementById("faq-rows");
if (faqHost) {
  faqHost.innerHTML = FAQ.map((f, i) => `
    <details style="border-top: 1px solid var(--rule); padding: 1.4rem 0; ${i === FAQ.length - 1 ? "border-bottom: 1px solid var(--rule);" : ""}">
      <summary style="cursor: pointer; display: flex; align-items: baseline; gap: 1rem; list-style: none;">
        <span class="mono" style="font-size: 0.72rem; color: var(--ink-3); letter-spacing: 0.08em; min-width: 28px;">0${i+1}</span>
        <span style="font-family: var(--serif); font-size: 1.2rem; font-weight: 500; letter-spacing: -0.005em; flex: 1;">${f.q}</span>
        <span class="mono" style="color: var(--accent); font-size: 1.2rem;" class="faq-arrow">＋</span>
      </summary>
      <div style="padding: 1rem 0 0 3.5rem; font-family: var(--serif); font-size: 1.05rem; line-height: 1.55; color: var(--ink-2); max-width: 68ch; text-wrap: pretty;">
        ${f.a}
      </div>
    </details>
  `).join("");
}

})();
