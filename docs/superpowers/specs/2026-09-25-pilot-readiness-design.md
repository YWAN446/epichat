# EpiChat Pilot Readiness — Web Tools, Annie's Data, Guardrails, Golden Set

**Date:** 2026-09-25
**Status:** Design approved section-by-section in session; awaiting written-spec review

## Problem

EpiChat is about to be piloted with epidemiology / public-health graduate
students, who will scrutinize every number, and we also want to learn about
clarity, guardrails, and usability. Four gaps block that:

1. **Over-promise.** The landing tagline (`app.py:787`) offers "share a URL ·
   ask me to search for outbreak news", but the agent (`epichat/agent.py`)
   has only six local tools — no web search or URL reading.
2. **Annie's parameter work is stranded.** `origin/feature/pipelines` gained
   five commits (faa3ee3..8b2a4ab, Sep 4–18) adding ~80 cited estimates
   (influenza, meningococcal, hepatitis A complete; pertussis +3 parameters;
   Ebola in progress). Her file is not valid JSON (empty values, `concensus`
   typo, legacy flat entries after the `diseases` block, duplicate `ebola`)
   and is edited from her own pre-integration draft, not main's normalized
   file — it must be ported, never merged.
3. **The agent cannot express uncertainty and improvises.** `lookup_disease`
   returns only min/typical/max + one source, so the agent cannot say how
   much the literature disagrees; seasonality is invented on "seasonal"
   prompts; vaccine campaigns always start on day 0.
4. **No automated quality signal.** The 50-prompt bank (`docs/prompt-bank.md`
   on `integrate/annie-pipelines`) and the Playwright replay harness
   (`talks/2026-09-cidmath/run_conversations.py`) need a human to judge
   results. Separately, 8 tests in `tests/test_chat_controller.py` call the
   live API unmocked and currently fail with a 401.

## Goals

1. Give the agent web search and URL fetch, without letting web content
   silently become simulation parameters.
2. Port Annie's data into main's schema, and make a malformed parameter file
   impossible to merge unnoticed.
3. Make uncertainty, assumptions, limitations, and scope guardrails explicit
   in agent behavior.
4. Build an automated, repeatable golden-set evaluation that gates pilot
   releases.

## Non-goals

- Conversation logging / feedback / consent (Phase 2, below — waits on the
  IRB-exempt consent text).
- Citation-backed `seasonality` data field (Annie's follow-up; this spec only
  stops the agent from presenting invented seasonality as fact).
- Integrating `grEPI.py` (WHO grEPI API probe) — stays on Annie's branch as
  exploration; a candidate cross-check source later.
- Model upgrade — the agent stays on `claude-opus-5`.
- Changes to the staged pipeline (`EPICHAT_AGENT=0`) beyond the test fix.

## Design

### 1. Web search and URL fetch

**Tools.** Add two Anthropic server tools to the agent's tool list alongside
the six `@beta_tool` functions:

```python
{"type": "web_search_20260209", "name": "web_search", "max_uses": 5}
{"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 3,
 "citations": {"enabled": True}, "max_content_tokens": 20000}
```

No domain allowlist (outbreak news is spread across too many sites). The
system prompt instead states a source preference: WHO, CDC, ECDC, ProMED,
ministries of health, peer-reviewed literature; name the source type when
relying on anything weaker.

**Grounding rule (system prompt).** Web content is *context*. Epidemiological
parameters still come from `lookup_disease` and the data tools. The agent may
quote a web figure with its link. If the user explicitly asks to use a web
figure in the simulation, the agent passes it through `configure_simulation`,
where it is labeled "web-sourced", shown with its URL, and range-checked
against the literature (existing warning path). URLs the agent relied on are
appended to `state.data_sources` so they appear under the plot and in exports.

**Runner compatibility (first implementation step).** Verify that
`client.beta.messages.tool_runner` accepts server-tool entries mixed with
`@beta_tool` functions and handles `pause_turn`. If it does not, replace the
runner in `EpiChatAgent.handle()` with an explicit loop (~30 lines):
call `client.beta.messages.create`, execute local `tool_use` blocks, resend on
`pause_turn`, stop on `end_turn`/`refusal`. `handle()`'s event contract is
unchanged either way.

**UI events.** `handle()` emits new events for `server_tool_use` blocks:
`web_search` → status line "🔎 Searching the web: *<query>*";
`web_fetch` → "📄 Reading: <domain/path>". Rendered with `status.write` lines
(never `status.update` mid-run — the Streamlit 1.54 "Bad delta path" crash).

**Errors.** Server-tool failures arrive as HTTP 200 with an error object in
the `*_tool_result` content (a list on success, an object on error). The
agent sees it and says search is unavailable; the turn continues. No
exception path is added.

**Landing copy.** The tagline stays as written — it becomes true.

### 2. Port Annie's data + integrity guard

**Port (one-off script, not a git merge).**
1. Repair a scratch copy of `origin/feature/pipelines:epichat/data/disease_parameters.json`:
   empty values → `null`; `concensus` → `consensus` (3 occurrences); drop the
   legacy flat entries after the `diseases` block (dengue…mpox, already on
   main in rich form) and the duplicate flat `ebola`.
2. A conversion script copies into main's file: full entries for
   `influenza`, `meningococcal`, `hepatitis_a`, `ebola`; and pertussis
   `average_contacts_daily`, `immunity_duration`, `asymptomatic_fraction`.
   Pertussis fatality is compared against main and taken from Annie if main's
   is empty. measles/mumps/rubella/varicella/covid19 are unchanged in her
   branch and left alone. Output keeps main's formatting (2-space indent,
   UTF-8, `ensure_ascii=False`).
3. Blank stays blank: Ebola incubation and meningococcal R0 max/typical keep
   `null` consensus values; `_flatten_param` already omits non-numeric
   consensus, and the estimates stay available.
4. `"range": "N/A"` strings in estimates are normalized to `null`.

**Questionable values → `null` until Annie reviews.** Consensus
min/typical/max set to `null`, with `"status": "under_review"` and a
`"review_note"` on the parameter:

| Parameter | Issue |
|---|---|
| meningococcal `infectious_days` 1/1/1 | Reflects "non-infectious 24 h after antibiotics", not the untreated infectious/carriage period; would badly understate transmission |
| influenza `fatality_rate` max 13.5% | Appears to be a hospitalized-cohort figure, not a population CFR |
| hepatitis_a `immunity_duration` min `"7300"` (string), max `"lifelong"` | Mixed types; needs a numeric representation decision |

A review checklist for Annie is written to
`docs/annie-param-review-2026-09.md` (each item: value, issue, what's needed).

**Guard test** — `tests/test_disease_parameters.py`, no network/API key:
- file parses; every disease has `display_name`, `aliases`, and `parameters`
  (or `variants` for covid19);
- key whitelist at disease, parameter, consensus, and estimate levels
  (`concensus` fails);
- numeric consensus: `min ≤ typical ≤ max`;
- unit sanity: `percentage` in [0, 100], fraction-valued parameters
  (`asymptomatic_fraction`) in [0, 1], `days` > 0;
- every estimate has `title` and (`url` or `doi`);
- `status`, if present, is one of `ok`, `under_review`.

**Coverage report** — `scripts/param_coverage.py` prints a disease ×
parameter grid: filled / under review / estimates-only / missing.

**Prevention.**
- `.github/workflows/tests.yml`: run `pytest` (Python 3.10, requirements.txt)
  on push and pull request. Live-API tests are skipped (no secret configured).
- README section "Adding or editing a disease": branch from `main`, edit
  `epichat/data/disease_parameters.json`, run
  `pytest tests/test_disease_parameters.py`.

### 3. Agent behavior, guardrails, small fixes

**3a. `lookup_disease` exposes uncertainty.** For each of `r0`,
`incubation_days`, `infectious_days`, `fatality_rate`, return (in addition to
the current flat values):
`n_estimates`, `estimate_range` ([lowest, highest] across estimate values),
`notes` (consensus notes), and `status` (`ok` | `under_review` |
`no_source`). A parameter with no numeric consensus is still listed with its
status instead of being silently omitted. Implemented in `disease_db.py` (a
helper returning the per-parameter summary) and consumed by the tool.

**3b. System-prompt additions** (concise, matching current style):
- *Uncertainty:* give ranges with typical values; say when estimates disagree
  or come from narrow populations; never fill a parameter whose status is
  `under_review` or `no_source` — say so, and offer to use a user-supplied
  value labeled as the user's.
- *Assumptions labeled:* any setting not from a tool or the user (e.g.
  seasonality strength, contact structure) is marked as an illustrative
  assumption in the confirmation list and in the report.
- *Limitations:* the report includes one line on model limitations
  (homogeneous mixing / single pathogen / no behavior change, as applicable)
  and "illustrative scenario, not a forecast" when the user asks for
  predictions.
- *Web grounding:* the Section 1 rule.
- *Scope guardrails:* decline individual medical advice (point to a clinician
  or public-health authority); decline requests to enhance pathogen
  transmissibility/virulence or other biosafety misuse; hypothetical and
  extreme modeling scenarios (e.g. R0 = 20) remain allowed. Off-topic handling
  unchanged.

**3c. Vaccine campaign timing.** `configure_simulation` gains optional
`vaccine_start_day: int` (≥ 0), passed to `_upsert_intervention(...,
start_day=...)` at `agent.py:172`. `fetch_vaccination_coverage`
(`agent.py:398`) preserves an existing start day instead of forcing 0.
Default remains 0.

**3d. Hermetic tests.** The 8 `detect_run_intent` tests move behind a
`live` pytest marker (registered in `conftest.py`, skipped when
`ANTHROPIC_API_KEY` is unset). New offline tests with a fake client verify
yes/no parsing and that an API error returns `False` (an outage never
triggers an unconfirmed run).

### 4. Golden-set evaluation

**Harness.** `evals/golden/run.py` drives `EpiChatAgent` in-process,
capturing the `on_event` stream (text, tool_use with inputs, tool_result,
plot) plus final `AgentState`. Playwright (`run_conversations.py`) is kept
for a few UI smoke checks only, outside this harness.

**Case format** — `evals/golden/cases/*.yaml`:

```yaml
id: hepa-uncertainty-01
category: uncertainty          # coverage|language|fidelity|uncertainty|guardrail|workflow|web
critical: false                # critical cases must pass 3/3
real_sim: false                # true → real Starsim run; else stub executor
turns:
  - "What's the R0 of hepatitis A, and how sure are we?"
checks:
  tool_called: [lookup_disease]
  no_tool: [run_simulation, fetch_demographics]
  config: {}                   # e.g. {disease: rubella, iso3: VNM, r0: db.typical}
  reply_language: en
  judge:
    - "Gives a range, not only a single value"
    - "Says estimates vary by transmission setting"
```

**Checks.**
- *Deterministic trace checks:* tools called / not called, ordering rules
  (no `fetch_*` before the first confirmation turn; `run_simulation` only
  after a confirmation turn), final config fields, `data_sources` contents,
  reply language (via a lightweight detector), plot present/absent. Config
  expectations can reference the database (`db.typical`, `db.range`) so
  data updates do not require editing cases.
- *LLM judge:* each `judge` item is a binary criterion graded by
  `claude-opus-5` with the transcript; the judge must quote supporting text,
  and returns pass/fail per item. Web cases are judged on behavior (cited
  sources, kept DB parameters), never on news content.

**Starter set (~40 cases).** ~15 from the prompt bank (disease coverage,
5 languages, alias traps such as "german measles" → rubella, Niger vs
Nigeria); ~12 for Sections 1–3 (uncertainty, under-review honesty, labeled
assumptions, vaccine start day, web-figure adoption); ~8 guardrail cases
(medical advice, enhancement misuse, off-topic, allowed extreme scenarios);
~5 workflow-gate cases (waits for confirmation, never retypes fetched
values). Post-pilot, thumbs-down conversations are triaged into new cases.

**Nondeterminism.** `--repeats N` (default 1 in development, 3 before a
pilot release). Critical cases (all guardrail and workflow-gate cases) must
pass N/N; others report pass rate. Most cases use a stub executor returning
canned simulation stats; ~5 `real_sim: true` cases run Starsim end to end.

**Output.** `evals/golden/results/<timestamp>/` with `traces.jsonl` and
`report.md`: pass/fail by category, per-case detail with failing check and
judge quote, and a regression section listing cases that passed in the
previous run and fail now. `results/` is gitignored except for a committed
`baseline.json` summary.

**Cost.** Measured on the first 1× run and recorded in the report header
(tokens and estimated USD) before setting a cadence.

## Testing

- Unit: fake-client tests for web event emission, `data_sources` citation
  capture, server-tool error handling, `lookup_disease` summary fields,
  `vaccine_start_day` plumbing, `detect_run_intent` parsing/fail-safe.
- Data: `tests/test_disease_parameters.py` guard test.
- Behavior: golden set, run 1× after each section lands and 3× before the
  pilot.
- Manual: one browser pass on port 8502 per the project env notes
  (`py -3.10 -m streamlit run app.py --server.headless true --server.port 8502`).

## Build order

1. 3d hermetic tests + CI workflow (green baseline).
2. Section 2 data port, guard test, coverage script, Annie checklist.
3. 3a `lookup_disease` summary + 3c vaccine start day.
4. Section 1 web tools (runner compatibility check first).
5. 3b system-prompt additions.
6. Section 4 harness + starter cases; first measured run.

## Phase 2 (separate spec, after IRB consent text is in hand)

Pilot logging to Supabase (managed Postgres; the app writes directly, no
server): per-turn records (pseudonymous participant code, session, messages,
tool calls/results, final config, errors, latency, tokens, git SHA),
per-reply 👍/👎 + comment, end-of-session SUS + open questions, and a consent
screen whose text is a swap-in block. Thumbs-down turns feed golden-set
candidates. Streamlit Community Cloud's ephemeral disk rules out local files.

## Operational prerequisites (owner: Yuke)

- Confirm `ANTHROPIC_API_KEY` in `epichat/.env` and in the Streamlit Cloud
  secrets is valid (tests saw a 401).
- Annie rotates the US Census ACS key still in her branch history (open
  item from August).
