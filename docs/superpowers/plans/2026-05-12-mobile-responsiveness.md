# Mobile Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the EpiChat marketing site phone-compatible by adding a hamburger nav, a 640px breakpoint, and stacked-card layouts for JS-generated tables — without touching the desktop experience.

**Architecture:** All changes are confined to 4 existing files. `styles.css` receives all new media query rules. `site.js` gets a burger button and toggle handler added to `mountNav`. `landing.js` gains CSS class names on pipeline and roadmap rows. `index.html` gets CSS class hooks on three inline-styled divs.

**Tech Stack:** Vanilla HTML / CSS / JS. Verification via browser DevTools device emulation at 375px (iPhone SE — the narrowest common phone).

---

### Task 1: Nav hamburger

**Files:**
- Modify: `docs/site.js` (mountNav function, lines 10–30)
- Modify: `docs/styles.css` (append after existing rules)

- [ ] **Step 1: Rewrite `mountNav` in `docs/site.js`**

Replace the entire `mountNav` function (lines 10–30) with:

```js
function mountNav() {
  const host = document.querySelector("[data-mount='nav']");
  if (!host) return;
  host.innerHTML = `
    <nav class="nav">
      <div class="nav-inner">
        <a href="index.html" class="brand">
          <span class="brand-mark"></span>
          <span>EpiChat</span>
          <span class="brand-meta">v0.1 · prototype</span>
        </a>
        <div class="nav-links">
          ${NAV_LINKS.map(l => `
            <a href="${l.href}" class="${l.href === CURRENT ? "active" : ""}">${l.label}</a>
          `).join("")}
        </div>
        <a href="https://epichat.streamlit.app/" target="_blank" rel="noopener" class="nav-cta">Try the demo ↗</a>
        <button class="nav-burger" aria-label="Toggle menu" aria-expanded="false">☰</button>
      </div>
    </nav>
  `;

  const nav = host.querySelector('.nav');
  const burger = host.querySelector('.nav-burger');
  burger.addEventListener('click', () => {
    const open = nav.classList.toggle('nav-open');
    burger.setAttribute('aria-expanded', String(open));
    burger.textContent = open ? '✕' : '☰';
  });
  host.querySelectorAll('.nav-links a').forEach(a => {
    a.addEventListener('click', () => {
      nav.classList.remove('nav-open');
      burger.setAttribute('aria-expanded', 'false');
      burger.textContent = '☰';
    });
  });
}
```

- [ ] **Step 2: Add burger styles to `docs/styles.css`**

Append after the last rule in `docs/styles.css`:

```css
/* ------------------------------------------------------------
   Mobile nav burger
   ------------------------------------------------------------ */

.nav-burger {
  display: none;
  background: none;
  border: 1px solid var(--rule);
  border-radius: 2px;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  color: var(--ink);
  padding: 0.3rem 0.5rem;
}

@media (max-width: 640px) {
  .nav-burger { display: block; }
  .nav-inner { flex-wrap: wrap; }
  .nav-links,
  .nav-cta { display: none; }
  .nav.nav-open .nav-links {
    display: flex;
    flex-direction: column;
    width: 100%;
    gap: 0;
    padding: 0.5rem 0 0.75rem;
    border-top: 1px solid var(--rule);
    margin-top: 0.5rem;
  }
  .nav.nav-open .nav-links a {
    padding: 0.65rem 0;
    border-bottom: 1px solid var(--rule);
  }
  .nav.nav-open .nav-cta {
    display: block;
    margin: 0.75rem 0 0;
    text-align: center;
    width: 100%;
  }
}
```

- [ ] **Step 3: Verify in browser**

Open `docs/index.html`. DevTools → Toggle Device Toolbar → iPhone SE (375px).

Expected:
- Nav shows brand + ☰ button only; OVERVIEW/DOCS/CTA are hidden
- Tap ☰ → dropdown opens with OVERVIEW, DOCS links and the demo CTA full-width
- Button changes to ✕ when open
- Tapping a nav link closes the menu
- At 1200px desktop: burger invisible, nav unchanged

- [ ] **Step 4: Commit**

```bash
git add docs/site.js docs/styles.css
git commit -m "feat: add mobile hamburger nav"
```

---

### Task 2: Global 640px breakpoint + class hooks

**Files:**
- Modify: `docs/index.html` (add class hooks to 3 divs + 1 roadmap header div)
- Modify: `docs/styles.css` (append new 640px block)

- [ ] **Step 1: Add `stats-strip` class in `docs/index.html`**

Find the stats strip div (approx. line 70). Change:

```html
<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; margin-top: 3rem; border: 1px solid var(--rule); border-radius: 3px; background: var(--paper-2);">
```

to:

```html
<div class="stats-strip" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; margin-top: 3rem; border: 1px solid var(--rule); border-radius: 3px; background: var(--paper-2);">
```

- [ ] **Step 2: Add `team-card` class to both team grids in `docs/index.html`**

Find the Yuke Wang grid (approx. line 367). Change:

```html
<div style="display: grid; grid-template-columns: 220px 1fr; gap: 2.5rem; align-items: start;">
```

to:

```html
<div class="team-card" style="display: grid; grid-template-columns: 220px 1fr; gap: 2.5rem; align-items: start;">
```

Find the Annie Wang grid (approx. line 398). Change:

```html
<div style="display: grid; grid-template-columns: 220px 1fr; gap: 2.5rem; align-items: start; margin-top: 3rem; padding-top: 3rem; border-top: 1px solid var(--rule);">
```

to:

```html
<div class="team-card" style="display: grid; grid-template-columns: 220px 1fr; gap: 2.5rem; align-items: start; margin-top: 3rem; padding-top: 3rem; border-top: 1px solid var(--rule);">
```

- [ ] **Step 3: Add `roadmap-header` class in `docs/index.html`**

Find the roadmap column-header row (approx. line 337, inside `#roadmap` section). Change:

```html
<div style="display: grid; grid-template-columns: 60px 1fr 140px 140px; gap: 0; background: var(--paper-3); font-family: var(--mono); font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-3);">
```

to:

```html
<div class="roadmap-header" style="display: grid; grid-template-columns: 60px 1fr 140px 140px; gap: 0; background: var(--paper-3); font-family: var(--mono); font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-3);">
```

- [ ] **Step 4: Append global 640px rules to `docs/styles.css`**

Append after the burger block added in Task 1:

```css
/* ------------------------------------------------------------
   Global 640px breakpoint
   ------------------------------------------------------------ */

@media (max-width: 640px) {
  html, body { font-size: 15px; }
  .wrap { padding: 0 1rem; }
  section { padding: 2.5rem 0; }

  /* footer: collapse 2-col to 1-col */
  footer.site .cols { grid-template-columns: 1fr; }

  /* stats strip: 4-col → 2×2 */
  .stats-strip { grid-template-columns: 1fr 1fr !important; }

  /* team cards: stack photo above bio */
  .team-card { grid-template-columns: 1fr !important; }
  .team-card > img { width: 120px !important; height: auto !important; }

  /* roadmap: hide header row (rows are self-labelled as cards) */
  .roadmap-header { display: none !important; }

  /* safety net: allow tables to scroll if anything still overflows */
  #layers, #roadmap-rows { overflow-x: auto; }
}

@media (max-width: 400px) {
  /* stats strip: 2×2 → single column */
  .stats-strip { grid-template-columns: 1fr !important; }
}
```

- [ ] **Step 5: Verify in browser at 375px**

Expected:
- Section vertical spacing is noticeably tighter
- Stats strip shows 2 metrics per row (4 total in 2 rows)
- Team section: photo above bio text (not side-by-side)
- Footer: all columns stack vertically in one column
- Roadmap column headers (# / Phase / Complexity / Impact) are hidden
- At 1200px desktop: nothing regressed

- [ ] **Step 6: Commit**

```bash
git add docs/index.html docs/styles.css
git commit -m "feat: global 640px breakpoint, stats strip and team card fixes"
```

---

### Task 3: Pipeline stacked cards

**Files:**
- Modify: `docs/landing.js` (pipeline rendering block, lines 34–56)
- Modify: `docs/styles.css` (append new rules)

- [ ] **Step 1: Add class names to pipeline rows in `docs/landing.js`**

Replace the entire `if (layersHost)` block (lines 34–56) with:

```js
const layersHost = document.getElementById("layers");
if (layersHost) {
  layersHost.innerHTML = LAYERS.map((L, i) => `
    <div class="layer-row" style="display: grid; grid-template-columns: 80px 140px 1fr 240px; gap: 0;
                ${i < LAYERS.length - 1 ? "border-bottom: 1px solid var(--rule);" : ""}
                align-items: stretch;">
      <div class="layer-num" style="padding: 1.6rem 1rem; border-right: 1px solid var(--rule); display: flex; flex-direction: column; gap: 0.3rem; align-items: center; justify-content: center; background: var(--paper-3);">
        <div class="mono" style="font-size: 0.64rem; color: var(--ink-3); letter-spacing: 0.14em;">LAYER</div>
        <div class="mono" style="font-size: 2rem; font-weight: 500; color: var(--accent); line-height: 1;">${L.idx}</div>
      </div>
      <div class="layer-status" style="padding: 1.6rem 1.2rem; border-right: 1px solid var(--rule); display: flex; align-items: flex-start;">
        <span class="tag ${L.status === "PROTOTYPE" ? "filled" : "accent"}">${L.status}</span>
      </div>
      <div class="layer-desc" style="padding: 1.6rem 1.2rem; border-right: 1px solid var(--rule);">
        <h3 style="font-family: var(--serif); font-size: 1.2rem; font-weight: 500; margin: 0 0 0.4rem; letter-spacing: -0.01em;">${L.title}</h3>
        <p style="font-size: 0.95rem; line-height: 1.5; color: var(--ink-2); margin: 0; max-width: 52ch; text-wrap: pretty;">${L.desc}</p>
      </div>
      <div class="layer-io" style="padding: 1.6rem 1.2rem; background: var(--paper-3); font-family: var(--mono); font-size: 0.76rem; display: flex; flex-direction: column; justify-content: center; gap: 0.4rem;">
        <div style="color: var(--ink-3);">▸ in  <span style="color: var(--ink);">${L.inLbl}</span></div>
        <div style="color: var(--ink-3);">▾ out <span style="color: var(--accent);">${L.outLbl}</span></div>
      </div>
    </div>
  `).join("");
}
```

- [ ] **Step 2: Add pipeline mobile CSS to `docs/styles.css`**

Append:

```css
/* ------------------------------------------------------------
   Pipeline — stacked card layout on mobile
   ------------------------------------------------------------ */

@media (max-width: 640px) {
  .layer-row {
    display: flex !important;
    flex-wrap: wrap !important;
    align-items: flex-start !important;
  }
  /* layer number + status sit side-by-side (auto-width, don't fill row) */
  .layer-num {
    flex: 0 0 auto !important;
    flex-direction: row !important;
    gap: 0.4rem !important;
    padding: 0.75rem !important;
    border-right: none !important;
    background: transparent !important;
    justify-content: flex-start !important;
    align-items: center !important;
  }
  .layer-num .mono:last-child { font-size: 1.2rem !important; }
  .layer-status {
    flex: 0 0 auto !important;
    padding: 0.75rem 0.75rem 0.75rem 0 !important;
    border-right: none !important;
    align-items: center !important;
  }
  /* description and in/out each fill full width */
  .layer-desc {
    flex: 0 0 100% !important;
    padding: 0 0.75rem 0.5rem !important;
    border-right: none !important;
  }
  .layer-io {
    flex: 0 0 100% !important;
    padding: 0.5rem 0.75rem 0.75rem !important;
    flex-direction: column !important;
    justify-content: flex-start !important;
    background: var(--paper-2) !important;
  }
}
```

- [ ] **Step 3: Verify in browser at 375px**

Expected for each pipeline row:
```
[01] [PROTOTYPE]
Parameter extraction
LLM with a purpose-built epi system prompt...
▸ in  natural language query
▾ out JSON params
```
- Layer number and status badge on one line
- Title + description full-width below
- in/out labels full-width at the bottom on a paper-2 background
- At 1200px desktop: 4-column grid unchanged

- [ ] **Step 4: Commit**

```bash
git add docs/landing.js docs/styles.css
git commit -m "feat: pipeline stacked card layout on mobile"
```

---

### Task 4: Roadmap stacked cards

**Files:**
- Modify: `docs/landing.js` (roadmap rendering block, lines 228–244)
- Modify: `docs/styles.css` (append new rules)

- [ ] **Step 1: Add class names to roadmap rows in `docs/landing.js`**

Replace the entire `if (roadmapHost)` block (lines 228–244) with:

```js
const roadmapHost = document.getElementById("roadmap-rows");
if (roadmapHost) {
  roadmapHost.innerHTML = ROADMAP.map((r, i) => `
    <div class="roadmap-row" style="display: grid; grid-template-columns: 60px 1fr 140px 140px; gap: 0; background: ${i % 2 ? "var(--paper-2)" : "var(--paper)"};
                ${i < ROADMAP.length - 1 ? "border-bottom: 1px solid var(--rule);" : ""}">
      <div class="road-pri" style="padding: 1rem; border-right: 1px solid var(--rule); font-family: var(--mono); color: var(--ink-3); display: flex; align-items: center;">
        <span style="color: var(--accent); font-weight: 500;">${r.priority}</span>
      </div>
      <div class="road-name" style="padding: 1rem 1.2rem; border-right: 1px solid var(--rule); font-family: var(--serif); font-size: 1rem;">${r.name}</div>
      <div class="road-cmplx" style="padding: 1rem 1.2rem; border-right: 1px solid var(--rule); font-family: var(--mono); font-size: 0.78rem; color: var(--ink-2); display: flex; align-items: center;">${r.complexity}</div>
      <div class="road-impact" style="padding: 1rem 1.2rem; font-family: var(--mono); font-size: 0.78rem; color: var(--ink-2); display: flex; align-items: center; gap: 0.6rem;">
        <span style="display: flex; gap: 2px; align-items: flex-end;">${impactBar(r.impact)}</span>
        <span>${r.impact}</span>
      </div>
    </div>
  `).join("");
}
```

- [ ] **Step 2: Add roadmap mobile CSS to `docs/styles.css`**

Append:

```css
/* ------------------------------------------------------------
   Roadmap — stacked card layout on mobile
   ------------------------------------------------------------ */

@media (max-width: 640px) {
  .roadmap-row {
    display: grid !important;
    grid-template-columns: 32px 1fr !important;
    grid-template-rows: auto auto !important;
  }
  /* priority number spans both rows on the left */
  .road-pri {
    grid-column: 1;
    grid-row: 1 / 3;
    padding: 0.9rem 0.4rem !important;
    border-right: none !important;
    align-items: flex-start !important;
  }
  .road-name {
    grid-column: 2;
    grid-row: 1;
    padding: 0.75rem 0.75rem 0.2rem !important;
    border-right: none !important;
    font-size: 0.95rem !important;
  }
  .road-cmplx {
    grid-column: 2;
    grid-row: 2;
    padding: 0 0.75rem 0.75rem !important;
    border-right: none !important;
    font-size: 0.72rem !important;
  }
  /* impact bar hidden — complexity label is sufficient at this size */
  .road-impact { display: none !important; }
}
```

- [ ] **Step 3: Verify in browser at 375px**

Expected for each roadmap row:
```
1  Country demographics (UN WPP, World Bank)
   Low–Medium
```
- Priority number in narrow left column, spanning both rows
- Phase name top-right, complexity text bottom-right
- Impact bar hidden
- At 1200px desktop: 4-column grid unchanged

- [ ] **Step 4: Commit**

```bash
git add docs/landing.js docs/styles.css
git commit -m "feat: roadmap stacked card layout on mobile"
```

---

### Task 5: Cross-page verification and push

**Files:** None modified — verification only.

- [ ] **Step 1: Verify `docs/docs.html` at 375px**

Open in DevTools at 375px. The nav hamburger and footer stack apply automatically via shared `site.js`/`styles.css`. Check for any overflow or broken layouts specific to that page.

- [ ] **Step 2: Verify `docs/about.html` at 375px**

Same check as Step 1.

- [ ] **Step 3: Full desktop smoke-test at 1200px**

Load `index.html` at full width. Scroll through all sections. Verify:
- 4-column pipeline grid intact
- 4-column roadmap grid intact with header row visible
- Stats strip 4-column intact
- Team photos at full 220px width
- Nav shows all links without burger

- [ ] **Step 4: Push**

```bash
git push
```
