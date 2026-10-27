# Website Update Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The project website (GitHub Pages, `docs/` on `main`, https://ywan446.github.io/epichat/) describes the web agent as it is at `ff938ed`, not the v0.3 Streamlit prototype it was written for in May 2026. A visitor learns what the agent does, how it works, what data it uses, where the roadmap stands, and how to take part in the pilot; every number on the site is one the code or a real run produces.

**Architecture:** A static site with no build step: `index.html`, `docs.html`, `about.html` (reachable by address, not in the nav since April), `styles.css`, `site.js` (nav, footer, theme), `landing.js` (the overview's generated rows and chart). The pages keep their design system (Newsreader and JetBrains Mono, the paper and ink tokens, the light and dark themes, the 640 px and 900 px breakpoints) and their section structure; the content changes, and `landing.js`'s generated parts change shape where the content needs it (the layers become the six stages, the toy SEIR chart becomes the output of a real run, the roadmap's complexity column becomes a status column).

**Spec:** The owner's request of 2026-10-27 ("update the website based on the updated app"). The facts come from `README.md` (the web-agent section), `web/lib/tools/index.ts`, `web/lib/enums.ts`, `web/lib/config.ts`, `web/content/consent.md`, `epichat/params/registry.py`, `epichat/sim/diagnostics.py` and the disease database, all at `ff938ed`.

## Decisions (mine, stated for the owner)

- **The call to action is the web app**, https://epichat-ai.vercel.app, labelled as a pilot open to study participants, with a mail link to take part. The Streamlit address now redirects to a Streamlit sign-in, so its links go; the docs name the Streamlit prototype, the CLI and the templates as still in the repository.
- **No invented version number.** The site said "v0.3"; the web app carries none. The labels say "web agent · pilot".
- **The worked example is a real run.** Measles in Kenya at current coverage, built the way the agent's tools build it (database values, the Kenya pyramid, Prem matrix and household size, births and deaths, 88% immune at the start from the WHO and UNICEF first-dose estimate for 2024, R0 held at 15 on the age-structured network), 10,000 agents for a year, five replicates: median 9.9% infected, peak on day 111. The first suggested intervention ("Vaccinate 70% in a campaign from day 48 to day 78 and rerun"): 1.45%, peak on day 78. The chart draws both runs' daily infectious counts with their 10 to 90% bands, embedded as data. The reply in the example is a paraphrase and says so.
- **Tables from the source.** The disease table (16 diseases: R0, latent period, infectious period, fatality, typical value and range, or the database's status) and the parameter defaults are generated from the database and the registry, not retyped.
- **Team bios, the problem statement and the program text stay as written.** They are the owner's words and still true.
- **Not pushed.** Merged to `main` locally; it goes live when the owner pushes (which also redeploys the app on Vercel).

## Global Constraints

- No new dependency, no build step, no change outside `docs/` except this plan.
- Every external script or font stays as it is (Google Fonts only); no new external resources.
- The pages render without horizontal scroll at 375 px and keep working in both themes.
- No participant data: the example is the probe's run, not a stored conversation.
- Cache-busters bump on every changed CSS or JS file.

## Review Focus

- Every factual claim against the code at `ff938ed`: the tools and what they do, the stages, the defaults, the networks, the interventions, the fit, the diagnostics, the data sources and their country counts, the consent summary, the limits (120 s, two repairs, five replicates, the daily and monthly caps).
- Claims that overstate: "validated", "exact R0", what the diagnostics catch, what is shipped versus next.
- The example's numbers against the probe's output, and the chart's data.
- Links: none to the Streamlit app, every external link resolves, the anchors exist.
- Mobile layout of the changed rows (stages, roadmap, chart legend, the example's chips).

---

### Task 1: Shared chrome (`site.js`)

- The brand line reads "web agent · pilot"; the nav button and the footer link go to the web app; the footer lists the data review list on GitHub.
- Bump `site.js` and `styles.css` versions in all three pages if they change.

### Task 2: The overview (`index.html`, `landing.js`)

- Head: description and social text name the agent, Starsim, cited data.
- Hero: kicker, lede, buttons (how it works, open the app, GitHub); the terminal shows the measles walk-through as tool calls and the paraphrased reply; the stats strip shows six models, 16 diseases with cited data, six intervention types, 237 countries with age data (Prem matrices for 177).
- How it works: the six stages (Understand, Configure, Ground in data, Run, Interpret, Report), each with its tools and its output; the chart is the real run with the campaign, a legend and the campaign window shaded.
- By example: the question, the configuration card with each value's source, the stage line, the paraphrased reply and three "Try next" labels as the app shows them.
- Status: shipped (October 2026) and next.
- The demo section becomes the pilot section; the roadmap shows a status per phase; the FAQ answers for the web agent (safety, Starsim, diseases, validation, privacy, open source, collaboration); the third collaboration panel's data ask names what the database lacks.

### Task 3: The docs (`docs.html`)

- Sections: Architecture, Workflow, Agent tools, Disease models, Disease database, Parameters, Networks, Interventions, Fit and limits on spread, Diagnostics, Outputs, Data sources, Privacy, Query tips, Roadmap, Risks; the table of contents follows.

### Task 4: About (`about.html`)

- Version labels, the opportunity panels' wording (tools, not templates), the data collaborator panel, the timeline.

### Final

- `node --check` on both scripts; an HTML parse of the three pages with no unclosed tags; every anchor in the table of contents resolves; external links answer.
- Render in Chrome at 1280 px and 375 px, light and dark, no console errors.
- One fresh reviewer with the Review Focus above; one fix pass; merge to `main` by fast-forward; not pushed.
