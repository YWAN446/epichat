// EpiChat landing page: the workflow stages, the run chart, the roadmap and the FAQ.
(function () {

// Generated from a run of the simulation code at ff938ed (measles in Kenya, 10,000 agents, 365 days, five runs):
// infectious agents per day in the median run and the 10-90% band across the five runs.
const RUNS = {
  baseline: { peakDay: 111, peak: 104, attack: 0.0991,
    median: [0,0,0,0,0,0,0,0,0,0,0,0,12,12,12,12,12,12,12,12,0,0,0,0,2,3,6,10,13,17,18,20,18,17,14,10,8,4,6,6,11,16,23,24,24,27,26,27,23,19,13,13,15,13,12,11,13,15,20,26,30,39,43,45,43,42,39,35,32,29,30,30,31,39,48,56,59,61,61,63,71,63,57,53,55,55,59,62,60,70,74,80,82,91,92,91,93,89,85,84,78,71,72,72,75,83,99,99,99,99,100,104,104,97,83,79,79,77,78,75,76,85,88,93,99,102,94,100,93,87,80,73,69,67,70,63,60,55,62,61,61,58,54,49,54,50,48,52,53,50,50,52,49,50,46,42,35,35,37,34,34,32,29,27,30,29,26,25,20,21,21,21,17,17,18,19,18,15,14,14,16,16,11,11,12,12,11,9,7,5,5,3,3,4,4,4,6,6,7,8,7,6,6,5,4,3,2,1,1,1,1,2,1,1,1,1,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,1,3,3,3,3,2,2,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    p10: [0,0,0,0,0,0,0,0,0,0,0,0,3,3,3,3,3,3,3,3,0,0,0,0,0,1,1,1,2,2,3,4,3,3,3,3,1,1,1,0,0,0,0,1,1,1,2,3,3,3,3,2,2,2,1,0,1,1,2,2,3,3,3,4,4,3,2,2,1,1,1,1,1,2,2,3,4,5,6,5,5,5,5,5,4,3,2,2,3,4,4,5,8,10,11,10,11,10,9,8,6,5,5,5,5,7,8,10,13,14,15,15,17,17,16,14,10,11,10,14,15,16,19,21,22,24,28,29,27,27,25,25,27,28,26,29,30,30,34,34,34,33,32,29,29,27,26,30,31,29,31,33,34,35,33,31,28,30,29,28,26,26,26,25,24,23,26,25,22,23,23,22,19,18,18,17,17,15,13,14,15,14,10,12,11,11,11,9,6,4,4,2,2,3,2,3,4,5,5,6,5,4,4,3,2,1,1,0,1,1,1,2,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,1,0,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    p90: [0,0,0,0,0,0,0,0,0,0,0,0,10,10,10,10,10,10,10,10,0,0,0,0,2,3,5,8,10,13,15,17,15,14,12,9,7,6,6,5,8,12,17,18,20,22,22,24,21,19,15,14,14,11,11,10,13,14,20,25,28,35,37,39,38,39,35,31,29,27,28,28,28,35,42,49,51,55,59,61,67,60,57,53,55,51,53,57,54,63,68,75,80,90,91,92,100,94,87,85,80,78,79,80,82,91,106,112,115,114,116,117,111,104,96,92,89,93,95,99,102,106,112,111,114,111,105,102,100,94,86,91,93,94,93,95,91,95,93,89,87,88,84,79,82,84,84,82,80,78,83,86,85,81,78,75,79,81,79,77,75,71,72,75,75,72,71,69,66,72,77,74,71,74,75,76,74,68,65,64,62,58,59,57,63,62,62,64,62,66,65,67,60,64,61,63,69,72,70,70,74,72,70,67,62,56,58,54,54,56,62,65,70,74,76,80,78,77,75,73,68,61,56,54,57,57,54,53,55,59,62,64,66,64,61,58,54,53,50,44,38,40,42,44,45,44,44,48,47,43,41,37,38,37,34,30,29,30,33,35,35,33,31,32,32,29,24,21,17,16,17,15,13,15,16,18,20,20,20,17,16,14,13,9,8,6,8,9,10,10,11,13,14,14,13,12,12,12,11,8,6,7,5,6,5,6,5,5,5,5,4,3,3,3,3,3,3,3,3,4,4,3,2,2,2,2,2,1,1,1,1,2,2,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  },
  campaign: { peakDay: 78, peak: 20, attack: 0.0145,
    median: [0,0,0,0,0,0,0,0,0,0,0,0,3,3,3,3,3,3,3,3,0,0,0,0,1,1,2,2,3,3,4,6,5,5,4,4,3,3,4,3,3,3,4,7,9,11,9,10,11,11,11,8,6,4,4,2,5,7,7,9,13,16,19,19,15,13,12,10,7,5,3,3,5,7,10,14,17,16,20,20,19,17,14,10,9,9,4,5,4,4,7,10,7,11,12,12,13,14,11,8,8,5,4,4,3,5,6,6,7,9,10,10,10,8,7,8,7,5,4,3,3,2,2,2,2,2,3,3,4,5,5,5,5,4,3,3,2,2,3,2,4,5,5,5,6,5,4,5,3,2,2,2,3,3,4,4,4,5,5,7,5,5,4,4,4,4,4,2,2,4,5,4,4,3,3,3,3,1,0,0,0,0,1,1,1,1,1,2,5,5,4,4,4,4,4,3,0,1,1,1,2,3,3,3,4,3,4,4,3,2,2,2,1,1,2,2,2,2,3,3,3,3,2,3,3,3,3,3,3,3,2,1,1,1,0,2,2,2,2,2,2,3,3,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    p10: [0,0,0,0,0,0,0,0,0,0,0,0,3,3,3,3,3,3,3,3,0,0,0,0,0,1,1,1,2,2,3,4,3,3,3,3,1,1,1,0,0,0,0,1,1,1,2,3,3,3,3,2,2,2,1,0,1,1,2,2,3,3,3,4,4,3,2,2,1,1,1,1,1,2,2,2,3,3,5,4,4,3,3,3,2,2,0,0,0,0,0,1,2,4,4,4,4,4,4,3,3,1,0,0,0,0,0,0,1,1,1,1,2,2,2,1,1,1,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    p90: [0,0,0,0,0,0,0,0,0,0,0,0,10,10,10,10,10,10,10,10,0,0,0,0,2,3,5,8,10,13,15,17,15,14,12,9,7,6,6,5,8,12,17,18,20,22,22,24,21,19,15,14,14,11,11,10,13,14,20,25,28,35,37,39,38,38,33,29,26,22,22,21,21,26,29,33,35,37,39,39,42,35,32,28,26,22,19,21,18,20,21,22,25,30,28,27,28,26,25,25,20,16,14,13,11,13,14,13,11,11,14,12,12,9,8,8,8,7,6,6,6,7,7,6,7,7,6,7,7,5,5,5,5,4,4,3,3,3,4,4,4,5,5,5,5,4,4,5,4,3,3,3,3,3,4,3,3,4,3,5,3,3,3,3,3,3,3,2,2,3,4,3,3,2,2,2,2,1,1,1,1,1,1,1,1,1,1,1,3,3,2,3,3,3,3,2,1,1,1,1,1,2,2,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1,2,2,2,2,1,2,2,2,2,2,2,2,1,1,1,1,0,1,1,1,1,1,1,2,2,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  },
};

// ============ STAGES ============
// The six stages of the step strip under the chat (web/lib/enums.ts STAGES), with what runs at each.
const STAGES = [
  {
    idx: "01", title: "Understand", tools: ["lookup_disease", "web search"],
    desc: "The agent works out the disease, the place and the question, reads the disease's cited parameters from a database of 16 diseases, and asks when something it needs is missing.",
    inLbl: "your question", outLbl: "disease card with cited ranges",
  },
  {
    idx: "02", title: "Configure", tools: ["configure_simulation", "describe_parameters"],
    desc: "A validated configuration: every value is checked against one parameter registry (bounds, units, the models it applies to), and the transmission rate is calibrated to the R₀ you give.",
    inLbl: "values from you or the database", outLbl: "configuration card",
  },
  {
    idx: "03", title: "Ground in data", tools: ["fetch_demographics", "fetch_vaccination_coverage", "fetch_health_system"],
    desc: "The country's age pyramid, birth and death rates, contact matrix and household size, its vaccination coverage and its hospital capacity, applied by the tools rather than retyped by the model.",
    inLbl: "a country", outLbl: "data card with citations",
  },
  {
    idx: "04", title: "Run", tools: ["run_simulation"],
    desc: "A private Starsim 3.7 service runs the agent-based model, up to five times with different random seeds, and makes up to two repairs to a configuration it cannot run.",
    inLbl: "configuration", outLbl: "series · statistics · diagnostics",
  },
  {
    idx: "05", title: "Interpret", tools: ["diagnostics", "what_if"],
    desc: "Diagnostics read the whole run: an outbreak that died out early, one that had not finished, a measured R₀ far from the configured one. Each offers fixes, and a sound baseline offers interventions, as one-click replies.",
    inLbl: "results", outLbl: "explanation · Try next",
  },
  {
    idx: "06", title: "Report", tools: ["write_report"],
    desc: "A report built from the stored runs, with every data source and assumption, to download as Word, PDF, HTML or Markdown, and a read-only link to share the conversation.",
    inLbl: "the scenario", outLbl: "report · share link",
  },
];

const stagesHost = document.getElementById("layers");
if (stagesHost) {
  stagesHost.innerHTML = STAGES.map((S, i) => `
    <div class="layer-row" style="display: grid; grid-template-columns: 80px 230px 1fr 240px; gap: 0;
                ${i < STAGES.length - 1 ? "border-bottom: 1px solid var(--rule);" : ""}
                align-items: stretch;">
      <div class="layer-num" style="padding: 1.6rem 1rem; border-right: 1px solid var(--rule); display: flex; flex-direction: column; gap: 0.3rem; align-items: center; justify-content: center; background: var(--paper-3);">
        <div class="mono" style="font-size: 0.64rem; color: var(--ink-3); letter-spacing: 0.14em;">STAGE</div>
        <div class="mono" style="font-size: 2rem; font-weight: 500; color: var(--accent); line-height: 1;">${S.idx}</div>
      </div>
      <div class="layer-status" style="padding: 1.6rem 1rem; border-right: 1px solid var(--rule); display: flex; flex-wrap: wrap; align-content: flex-start; gap: 0.35rem;">
        ${S.tools.map(t => `<span class="tool">${t}</span>`).join("")}
      </div>
      <div class="layer-desc" style="padding: 1.6rem 1.2rem; border-right: 1px solid var(--rule);">
        <h3 style="font-family: var(--serif); font-size: 1.2rem; font-weight: 500; margin: 0 0 0.4rem; letter-spacing: -0.01em;">${S.title}</h3>
        <p style="font-size: 0.95rem; line-height: 1.5; color: var(--ink-2); margin: 0; max-width: 52ch; text-wrap: pretty;">${S.desc}</p>
      </div>
      <div class="layer-io" style="padding: 1.6rem 1.2rem; background: var(--paper-3); font-family: var(--mono); font-size: 0.76rem; display: flex; flex-direction: column; justify-content: center; gap: 0.4rem;">
        <div style="color: var(--ink-3);">▸ in  <span style="color: var(--ink);">${S.inLbl}</span></div>
        <div style="color: var(--ink-3);">▾ out <span style="color: var(--accent);">${S.outLbl}</span></div>
      </div>
    </div>
  `).join("");
}

// ============ RUN CHART ============
// Measles in Kenya, 88% immune at the start: the baseline and the first intervention its run suggested.
const CAMPAIGN = { start: 48, end: 78 };

function drawChart() {
  const host = document.getElementById("curve-host");
  if (!host) return;
  const W = 1200, H = 440, PAD_L = 64, PAD_R = 24, PAD_T = 44, PAD_B = 50;
  const days = RUNS.baseline.median.length - 1;
  const iw = W - PAD_L - PAD_R, ih = H - PAD_T - PAD_B;
  const maxY = 130;
  const x = d => PAD_L + (d / days) * iw;
  const y = v => PAD_T + ih - (v / maxY) * ih;
  const pts = arr => arr.map((v, d) => `${x(d).toFixed(1)},${y(v).toFixed(1)}`);
  const line = arr => "M" + pts(arr).join(" L");
  const band = (lo, hi) => "M" + pts(hi).join(" L") + " L" + pts(lo).reverse().join(" L") + " Z";
  const yTicks = [0, 25, 50, 75, 100, 125];
  const xTicks = [0, 60, 120, 180, 240, 300, 360];
  const B = RUNS.baseline, C = RUNS.campaign;

  const svg = `
<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Infectious agents per day over a year: the baseline peaks at ${B.peak} on day ${B.peakDay}; with the campaign the peak is ${C.peak} on day ${C.peakDay}." style="width: 100%; height: auto; display: block; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 3px;" font-family="JetBrains Mono, ui-monospace, monospace">
  <g stroke="var(--rule)" stroke-width="0.6" opacity="0.7">
    ${yTicks.map(v => `<line x1="${PAD_L}" y1="${y(v)}" x2="${W - PAD_R}" y2="${y(v)}" stroke-dasharray="1 3"/>`).join("")}
    ${xTicks.map(t => `<line x1="${x(t)}" y1="${PAD_T}" x2="${x(t)}" y2="${H - PAD_B}" stroke-dasharray="1 3"/>`).join("")}
  </g>
  <rect x="${x(CAMPAIGN.start)}" y="${PAD_T}" width="${x(CAMPAIGN.end) - x(CAMPAIGN.start)}" height="${ih}" fill="var(--accent)" opacity="0.08"/>
  <text x="${x(CAMPAIGN.start) + 6}" y="${PAD_T + 16}" font-size="12" fill="var(--accent)">campaign · days ${CAMPAIGN.start}–${CAMPAIGN.end}</text>
  <line x1="${PAD_L}" y1="${H - PAD_B}" x2="${W - PAD_R}" y2="${H - PAD_B}" stroke="var(--ink-3)" stroke-width="1"/>
  <line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${H - PAD_B}" stroke="var(--ink-3)" stroke-width="1"/>

  <path d="${band(B.p10, B.p90)}" fill="var(--ink-3)" opacity="0.16"/>
  <path d="${line(B.median)}" fill="none" stroke="var(--ink-2)" stroke-width="1.8"/>
  <path d="${band(C.p10, C.p90)}" fill="var(--accent)" opacity="0.2"/>
  <path d="${line(C.median)}" fill="none" stroke="var(--accent)" stroke-width="2.4" pathLength="1000" stroke-dasharray="1000" stroke-dashoffset="1000">
    <animate attributeName="stroke-dashoffset" from="1000" to="0" dur="1.8s" fill="freeze" />
  </path>

  <g>
    <circle cx="${x(B.peakDay)}" cy="${y(B.peak)}" r="4" fill="var(--ink)" />
    <text x="${x(B.peakDay) + 10}" y="${y(B.peak) - 8}" font-size="13" fill="var(--ink)">baseline · peak day ${B.peakDay}</text>
    <circle cx="${x(C.peakDay)}" cy="${y(C.peak)}" r="4" fill="var(--accent)" />
    <text x="${x(C.peakDay) + 10}" y="${y(C.peak) - 10}" font-size="13" fill="var(--accent)">with the campaign · peak day ${C.peakDay}</text>
  </g>

  ${yTicks.map(v => `<text x="${PAD_L - 10}" y="${y(v) + 4}" text-anchor="end" font-size="12" fill="var(--ink-3)">${v}</text>`).join("")}
  ${xTicks.map(t => `<text x="${x(t)}" y="${H - PAD_B + 20}" text-anchor="middle" font-size="12" fill="var(--ink-3)">${t}</text>`).join("")}
  <text x="${PAD_L}" y="${PAD_T - 16}" font-size="12" fill="var(--ink-3)" letter-spacing="1.2">INFECTIOUS AGENTS OUT OF 10,000 · MEDIAN RUN OF 5, 10–90% BAND</text>
  <text x="${W - PAD_R - 4}" y="${H - PAD_B + 40}" text-anchor="end" font-size="12" fill="var(--ink-3)" letter-spacing="1.2">DAY →</text>
</svg>
<dl class="kv chart-kv">
  <dt>scenario</dt> <dd>measles · Kenya · SEIR on the age-structured network</dd>
  <dt>run</dt>      <dd>10,000 agents · 365 days · five runs, the median run shown</dd>
  <dt>R₀</dt>       <dd>15, from the database</dd>
  <dt>immune</dt>   <dd>88% at the start (WHO/UNICEF first dose, 2024)</dd>
  <dt>infected</dt> <dd><span style="color: var(--ink-2);">baseline ${(B.attack * 100).toFixed(1)}%</span> · <span style="color: var(--accent);">with the campaign ${(C.attack * 100).toFixed(2)}%</span> of the population within the year</dd>
  <dt>campaign</dt> <dd>vaccinate 70% from day ${CAMPAIGN.start} to day ${CAMPAIGN.end}, the first intervention the run suggested</dd>
</dl>
  `;
  host.innerHTML = svg;
}

drawChart();


// ============ ROADMAP ============
const ROADMAP = [
  { name: "Country demographics", note: "UN WPP 2024 age pyramids for 237 countries and areas; birth and death rates", status: "Done", impact: "High" },
  { name: "Country contact matrices", note: "Prem et al. 2021, 177 countries, on the age-structured network", status: "Done", impact: "High" },
  { name: "Households, schools and workplaces", note: "the hybrid network, with UN household sizes for 189 countries", status: "Done", impact: "Medium" },
  { name: "Age-specific severity", note: "fatality by age is a parameter; cited values are in literature review", status: "In progress", impact: "High" },
  { name: "Calibration against surveillance data", note: "a run fits one known outcome today; fitting a reported case series is next", status: "In progress", impact: "Very High" },
  { name: "STI and multi-route transmission", note: "MFNet, MSMNet", status: "Later", impact: "Medium" },
  { name: "Geospatial / metapopulation", note: "WorldPop, mobility", status: "Later", impact: "High" },
];

const STATUS_MARK = { "Done": ["●", "var(--accent)"], "In progress": ["◐", "var(--ink)"], "Later": ["○", "var(--ink-3)"] };

const impactBar = (v) => {
  const n = { "Medium": 2, "High": 3, "Very High": 4 }[v] || 1;
  return Array.from({length: 4}).map((_, i) =>
    `<span style="width: 5px; height: 12px; background: ${i < n ? 'var(--accent)' : 'var(--rule)'}; display: inline-block;"></span>`
  ).join("");
};

const roadmapHost = document.getElementById("roadmap-rows");
if (roadmapHost) {
  roadmapHost.innerHTML = ROADMAP.map((r, i) => {
    const [mark, color] = STATUS_MARK[r.status];
    return `
    <div class="roadmap-row" style="display: grid; grid-template-columns: 60px 1fr 140px 140px; gap: 0; background: ${i % 2 ? "var(--paper-2)" : "var(--paper)"};
                ${i < ROADMAP.length - 1 ? "border-bottom: 1px solid var(--rule);" : ""}">
      <div class="road-pri" style="padding: 1rem; border-right: 1px solid var(--rule); font-family: var(--mono); color: var(--ink-3); display: flex; align-items: center;">
        <span style="color: var(--accent); font-weight: 500;">${i + 1}</span>
      </div>
      <div class="road-name" style="padding: 1rem 1.2rem; border-right: 1px solid var(--rule); font-family: var(--serif); font-size: 1rem;">
        ${r.name}
        <div style="font-family: var(--mono); font-size: 0.72rem; color: var(--ink-3); margin-top: 0.25rem;">${r.note}</div>
      </div>
      <div class="road-cmplx" style="padding: 1rem 1.2rem; border-right: 1px solid var(--rule); font-family: var(--mono); font-size: 0.78rem; color: ${color}; display: flex; align-items: center; gap: 0.4rem;">
        <span>${mark}</span><span>${r.status}</span>
      </div>
      <div class="road-impact" style="padding: 1rem 1.2rem; font-family: var(--mono); font-size: 0.78rem; color: var(--ink-2); display: flex; align-items: center; gap: 0.6rem;">
        <span style="display: flex; gap: 2px; align-items: flex-end;">${impactBar(r.impact)}</span>
        <span>${r.impact}</span>
      </div>
    </div>
  `;
  }).join("");
}


// ============ FAQ ============
const FAQ = [
  {
    q: "Is this safe? Can the AI produce an invalid simulation?",
    a: "The model never writes simulation code. It calls tools with structured arguments, and every value passes one parameter registry (bounds, units, the models it applies to) before a private Starsim service runs it, under a time limit and with up to two automatic repairs of a configuration that fails. After every run, diagnostics check the result itself and say when something looks wrong.",
  },
  {
    q: "Which modeling framework do you use?",
    a: "Starsim, the Institute for Disease Modeling's open-source agent-based framework, pinned at version 3.7.2. The first prototype generated Starsim scripts from templates; the web agent calls the same Python package through a private simulation service. The architecture is framework-agnostic; EpiModel and Mesa are natural follow-ons.",
  },
  {
    q: "What diseases does it handle today?",
    a: "Any infection that fits one of six models: SIR, SEIR, SIS, SIRS, SEIRS and SEIAR. Sixteen diseases have cited parameters in the database: cholera, COVID-19, dengue, Ebola, hepatitis A, influenza, measles, meningococcal disease, mpox, mumps, pertussis, polio, RSV, rubella, tuberculosis and varicella. The app lists every estimate with its title and year and applies a single estimate with one click.",
  },
  {
    q: "How do you validate accuracy?",
    a: "Inside the app, the R₀ is exact by construction on the random and age-structured networks and measured by a short pilot run on the household, school and work network, and diagnostics flag results that do not add up. Every push runs over 1,600 automated tests, including a fixed simulation baseline. Two studies follow: a usability study of the web agent with graduate students, epidemiologists and decision makers, then a concordance study against expert-coded reference models.",
  },
  {
    q: "What happens to what I type?",
    a: "Using the pilot means taking part in a study, and the consent screen at first sign-in says what is recorded: your conversations, the agent's summarized reasoning, and how you use the app. Your messages go to Anthropic's Claude API; public data sources receive only a country code. A shared link shows a copy of a conversation without your email.",
  },
  {
    q: "Will it be open source?",
    a: "The code is already public on GitHub. A formal open release under the MIT license, with a preprint, is planned for 2027.",
  },
  {
    q: "How can I collaborate?",
    a: "Three roles: domain experts for benchmark questions and what a correct answer looks like, data contributors for the cited values the database still lacks (intervention effects, fatality by age, vaccine efficacy), and modelers for expert reference models. Even a 'let's grab coffee' level ask works: email Yuke.",
  },
];

const faqHost = document.getElementById("faq-rows");
if (faqHost) {
  faqHost.innerHTML = FAQ.map((f, i) => `
    <details style="border-top: 1px solid var(--rule); padding: 1.4rem 0; ${i === FAQ.length - 1 ? "border-bottom: 1px solid var(--rule);" : ""}">
      <summary style="cursor: pointer; display: flex; align-items: baseline; gap: 1rem; list-style: none;">
        <span class="mono" style="font-size: 0.72rem; color: var(--ink-3); letter-spacing: 0.08em; min-width: 28px;">0${i+1}</span>
        <span style="font-family: var(--serif); font-size: 1.2rem; font-weight: 500; letter-spacing: -0.005em; flex: 1;">${f.q}</span>
        <span class="mono faq-arrow" style="color: var(--accent); font-size: 1.2rem;">＋</span>
      </summary>
      <div style="padding: 1rem 0 0 3.5rem; font-family: var(--serif); font-size: 1.05rem; line-height: 1.55; color: var(--ink-2); max-width: 68ch; text-wrap: pretty;">
        ${f.a}
      </div>
    </details>
  `).join("");
}

})();
