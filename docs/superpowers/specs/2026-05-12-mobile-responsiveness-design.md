---
name: Mobile Responsiveness
description: Make the EpiChat marketing website compatible with phone users
type: project
---

# Mobile Responsiveness — Design Spec

## Goal

Make the EpiChat marketing website (`docs/`) fully usable on phones (≥320px). Desktop layout is unchanged. No new dependencies.

## Files Changed

| File | Change |
|------|--------|
| `docs/styles.css` | Add hamburger nav styles + 640px breakpoint block |
| `docs/site.js` | Add burger button to nav markup + JS toggle handler |
| `docs/landing.js` | Add CSS class names to pipeline/roadmap rows and wrappers |
| `docs/index.html` | Add `stats-strip` and `team-card` classes to inline-styled divs |

---

## Section 1 — Nav Hamburger

**Trigger:** ≤640px

**Markup change (`site.js`):**
- Add `<button class="nav-burger" aria-label="Toggle menu">☰</button>` inside `.nav-inner`, after `.nav-links`.
- Add a JS click handler that toggles class `.nav-open` on the `<nav>` element.

**CSS behavior:**
- At ≤640px: `.nav-links` and `.nav-cta` are `display: none` by default.
- When `nav.nav-open`: they become `display: flex; flex-direction: column` in a full-width dropdown below the brand row.
- `.nav-burger` is `display: none` above 640px; visible below.
- Clicking a nav link or the burger again closes the menu.

---

## Section 2 — Global Breakpoint Fixes (≤640px)

New `@media (max-width: 640px)` block in `styles.css`:

| Property | Desktop | Mobile |
|----------|---------|--------|
| `section` padding | `calc(6rem * var(--density))` | `2.5rem 0` |
| `footer.site .cols` grid | `1fr 1fr` (at 900px) | `1fr` |
| `html, body` font-size | `17px` | `15px` |
| `.wrap` padding | `0 var(--pad)` (2rem) | `0 1rem` |

The existing 900px breakpoint (grid-2/3/4, section-head collapse) is untouched.

---

## Section 3 — Inline-Styled Element Fixes

**Stats strip (`index.html` + `styles.css`):**
- Add class `stats-strip` to the 4-column stats grid div.
- Keep inline `grid-template-columns: repeat(4, 1fr)` in place (desktop).
- At ≤640px: override to `grid-template-columns: 1fr 1fr` (2×2).
- At ≤400px: override to `grid-template-columns: 1fr` (single column).

**Team photo grids (`index.html` + `styles.css`):**
- Add class `team-card` to both `display: grid; grid-template-columns: 220px 1fr` divs (Yuke and Annie).
- At ≤640px: override to `grid-template-columns: 1fr` (stacked).
- At ≤640px: team photo `width: 120px; height: auto` (removes fixed crop height).

---

## Section 4 — JS-Generated Tables (Stacked Cards)

**Layer pipeline (`landing.js` + `styles.css`):**
- Add class `layer-row` to each row `<div>` in the pipeline.
- Wrap the entire `#layers` output in a `<div class="layers-table" style="overflow-x:auto">`.
- At ≤640px, `.layer-row` switches from its 4-column inline grid to a block layout:

```
LAYER 01 · PROTOTYPE
─────────────────────
Parameter extraction
LLM with a purpose-built epi system prompt...
▸ in  natural language query
▾ out JSON params
```

CSS: `.layer-row { display: flex; flex-direction: column; }` with child borders removed and padding tightened.

**Roadmap (`landing.js` + `styles.css`):**
- Add class `roadmap-row` to each row `<div>`.
- Wrap `#roadmap-rows` output in `<div class="roadmap-table" style="overflow-x:auto">`.
- At ≤640px, `.roadmap-row` collapses to 2 visible columns (`auto 1fr`) — priority number + phase name — with complexity and impact shown as a smaller line below the name.

---

## Breakpoints Summary

| Breakpoint | What changes |
|------------|-------------|
| 900px (existing) | grid-2/3/4 → 1 col; section-head → 1 col; footer → 2 col |
| 640px (new) | Nav hamburger; section padding; font size; wrap padding; stats strip 2×2; team cards stack; pipeline/roadmap card layout; footer 1 col |
| 400px (new) | Stats strip → 1 col |

---

## Out of Scope

- Dark mode toggle on mobile (tweaks panel is already hidden by default)
- Touch-specific interactions beyond standard tap
- The `docs.html` and `about.html` pages (they share the same nav/footer/CSS so the nav fix applies automatically; their body content uses the same grid classes that already collapse at 900px)
