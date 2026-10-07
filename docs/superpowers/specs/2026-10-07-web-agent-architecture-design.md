# EpiChat Web Agent — Architecture Design

**Date:** 2026-10-07
**Status:** Approved section by section in session; written spec awaiting review
**Scope:** The umbrella architecture for rebuilding EpiChat as a web agent in
CampusOtter's shape (Next.js on Vercel, Supabase, a private Python simulation
service), with a tracked, guided simulation workflow and structured output at
every step. It fixes the cross-cutting decisions and defines five ordered
sub-projects. Sub-project 1 (Foundation) is specified here in enough detail to
plan directly; sub-projects 2–5 get short specs of their own when reached.

## 1. Problem

EpiChat today is a Streamlit app served from the owner's machine. The agent
(`epichat/agent.py`) is sound — six deterministic tools, web search and fetch,
uncertainty rules, a golden-set eval — but the shell around it cannot support a
pilot with graduate students:

- No sign-in, no spend caps, no per-user limits; one process serves everyone.
- Conversation state lives in Streamlit session memory and is lost on reload.
- Every result is prose plus a static PNG. Students cannot inspect the
  configuration, the fetched data, or the series; the researcher cannot see
  where students stall.
- Streamlit's rendering model fights the agent's event stream (the
  `status.update()` "Bad delta path" crash is a standing workaround).

CampusOtter (`stat/b4-meet-faculty`, github.com/YWAN446/campusotter) already
solved the shell problem for a sibling tool: Next.js 16 on Vercel, Supabase
code sign-in, a streaming tool loop, usage caps enforced in the database, a
journey strip with suggested replies, and fenced blocks that render as cards.
This design brings EpiChat into that shape while keeping Starsim and the
Python package where they are.

## 2. Goals

1. A signed-in web app on Vercel, backed by Supabase, in CampusOtter's shape.
2. The simulation workflow — understand, configure, ground in data, run,
   interpret — visible to the user as a step strip with suggested next
   replies, and recorded for the researcher as step events.
3. Every tool result rendered as a structured card (disease parameters,
   configuration, fetched data with citations, run results with an
   interactive chart) instead of being retyped by the model.
4. Conversations, scenarios, and runs persisted server-side; research use
   governed by recorded consent.
5. Spend can never exceed a monthly ceiling; each user has a daily turn cap.
6. The Python package, templates, CLI, disease database, and golden-set eval
   keep working; the Streamlit app retires only after a parity checklist.

## 3. Non-goals

- Replacing Starsim or rewriting the simulation in TypeScript.
- Changing the epidemiological logic (validation, calibration, auto-apply
  rules, warnings). It is ported, not redesigned; parity is tested.
- An admin UI beyond one researcher page and saved SQL reports.
- A custom domain, a public landing page, or billing. Later.
- Translating the UI chrome. The model answers in the user's language as it
  does today; buttons and labels stay in English for version 1.

## 4. Decisions made during design

| Question | Decision |
|---|---|
| Who tracks the workflow | Both: the user sees the strip and their scenario state; the researcher sees step events and consented conversations |
| Access | Emailed one-time code sign-in; allowed email domains are a setting, starting with `emory.edu`; daily turn cap per user; monthly budget cap |
| Consent | A consent screen at first sign-in with versioned text; agreement or decline recorded with a timestamp. Every conversation is stored because the app needs it; consent governs research use only. Decliners are excluded from research queries and their conversations are purged after 30 days |
| Architecture | TypeScript agent on Next.js; Python only for the simulation, behind a private service in the same Vercel project |
| Branch base | `pilot-readiness` fast-forwarded into `main` (done 2026-10-07, main at 7c90a88) |
| Simulation errors | The sim service keeps the LLM parameter repair the CLI has, with a visible repair log and its usage reported |
| Default chat model | `claude-opus-5-5`; the repair call uses the same model. The golden set is re-run on it in sub-project 5 |
| Stage | Derived deterministically from tool events; the model authors only the suggested replies |

## 5. Architecture

```
Browser ──SSE──> web (Next.js on Vercel) ──> Anthropic API (Claude Opus 5.5; web search/fetch server tools)
                   │        │                       ▲
                   │        │ binding + shared secret│ repair call (rare)
                   │        ▼                       │
                   │   sim (FastAPI, Python 3.12) ───┘   Starsim via templates; UN WPP offline fallback
                   ▼
            Supabase (Postgres + Auth)   sign-in · conversations · scenarios · runs · step events · usage
                   ▲
            Resend (SMTP for sign-in codes)
Live data: UN WPP · WHO GHO · World Bank Data360 (HTTP, from web)
```

| Unit | Does | Depends on |
|---|---|---|
| web app | sign-in, consent, chat route, turn loop, tool registry, persistence, cards, researcher page, crons | Supabase, Anthropic, sim |
| sim service | validates `SimParams`, renders a template, runs Starsim in a subprocess, repairs on failure, returns stats + series; offline demographics; health | the `epichat` package, Anthropic (repair only) |
| Python package | unchanged home of schema, templates, data loaders, disease DB, CLI, Streamlit app, evals | — |
| Supabase | auth, all tables, cap functions | — |

## 6. Repository layout and deployment

One repository (`epichat`), two services, one Vercel project.

```
epichat/            Python package (unchanged)
templates/          Starsim Jinja2 templates (gain a JSON output mode)
sim/                FastAPI service: main.py, requirements.txt, tests/
web/                Next.js 16 app: app/ components/ lib/ content/ data/ supabase/migrations/ tests/
vercel.json         services: web (public via catch-all rewrite), sim (private; binding into web); crons
app.py, cli.py      Streamlit stays until the parity checklist passes; the CLI stays
```

- **Services.** Vercel Services is in beta on all plans, Hobby included. `vercel.json` sits at the repo root; each service names its `root`. The web service is reached by a top-level rewrite `/(.*)`. The sim service has no public rewrite; the web service receives its URL through a service binding as `SIM_INTERNAL_URL`. A binding grants reachability, not authentication, so every sim request also carries `Authorization: Bearer <SIM_SHARED_SECRET>`.
- **Sub-project 1 deploys the services shape with the web service alone**, so adding sim in sub-project 2 changes `vercel.json` and nothing in the dashboard. If a one-service services config is refused, sub-project 1 falls back to the project Root Directory setting (`web/`) and sub-project 2 converts.
- **Importing the package from `sim/`.** Locally `sim/main.py` inserts the repository root into `sys.path`. On Vercel the service builds from `sim/`; if the parent folders are not available at build time, the sim service's `buildCommand` copies `epichat/` and `templates/` into `sim/` first. Verified on the first deploy of sub-project 2.
- **Fallback if Services misbehaves:** deploy `sim/` as its own Vercel project and set `SIM_INTERNAL_URL` by hand. The code is identical.
- **Runtimes.** Web: Node.js (default; no `runtime` export). Sim: Python 3.12 on Fluid Compute. Starsim + scipy + pandas + numba + matplotlib (~220 MB) plus the 40 MB data folder fit under the 500 MB Python limit. `maxDuration` 300 on both routes that need it (`/api/chat`, `/simulate`).
- **Plan.** Vercel Hobby for the pilot (non-commercial research use). Hobby allowances: 4 active-CPU hours, 360 GB-hours provisioned memory, 1M invocations a month, hard caps, no overage billing. Supabase Free, Resend Free.
- **Supabase project.** A new free project for EpiChat (not CampusOtter's). Migrations in `web/supabase/migrations/`, numbered, applied in order in the SQL editor as CampusOtter's are, each safe to run twice. A daily cron hits `/api/health` so the free database never pauses.
- **Local development.** `vercel dev` runs both services; or `npm run dev` in `web/` and `uvicorn main:app --port 8000` in `sim/` with `SIM_INTERNAL_URL=http://localhost:8000`. The local Python stack is 3.10; the sim requirements must also install under 3.12 (verified in sub-project 2).

## 7. Data model

The server is the only writer. Row-level security is enabled on every table with no policies, so the browser's publishable key can read nothing; the server uses the secret key. Grants follow CampusOtter's `0001_init.sql` (revoke from `anon`/`authenticated`, grant to `service_role`). No `vector` extension is needed.

| Table | Columns (abridged) | Notes |
|---|---|---|
| `profiles` | `user_id` pk, `email`, `consent_version`, `consented_at`, `declined_at`, `created_at` | both timestamps null = consent not yet asked; a `consent_version` older than the current text re-prompts |
| `conversations` | `id` uuid pk, `user_id`, `title`, `active_scenario_id`, `created_at`, `updated_at`, `deleted_at` | title = first user message, shortened; soft delete by the user |
| `messages` | `id`, `conversation_id` fk cascade, `seq`, `role` (user/assistant), `content` jsonb, `created_at`; unique (conversation, seq) | the exact Anthropic `MessageParam` list, append-only, never edited. Current models bind thinking blocks to the producing conversation, so this is also what keeps caching and replay correct |
| `turns` | `id` uuid, `conversation_id`, `seq`, `user_text`, `started_at`, `finished_at`, `stop` (end_turn/max_tokens/refusal/tool_limit/empty/paused/error), `refusal_category`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `stage_after` | one per user message and its reply; what the caps count |
| `turn_events` | `id`, `turn_id` fk cascade, `seq`, `kind` (text/tool_use/tool_result/web_search/web_fetch/stage/suggestions/notice), `payload` jsonb | the display stream in order; replaying it rebuilds the conversation, cards included. `tool_result` payloads omit the run series (see `runs`) |
| `scenarios` | `id` uuid, `conversation_id`, `seq`, `params` jsonb (`SimParams`), `disease`, `country_iso3`, `total_population`, `data_sources` jsonb, `web_sources` jsonb, `stage`, `created_at`, `updated_at` | replaces the in-memory `AgentState`. `start_new_scenario` creates a new row and points `conversations.active_scenario_id` at it |
| `runs` | `id` uuid, `scenario_id`, `conversation_id`, `user_id`, `turn_id`, `params`, `effective_params`, `pop_scale`, `stats`, `stats_agents`, `series` jsonb, `warnings`, `data_sources`, `repairs` jsonb, `duration_ms`, `error` jsonb, `created_at` | series strided to ≤ 2,000 points; `GET /api/runs/[id]` serves it to the card on replay |
| `step_events` | `id`, `user_id`, `conversation_id`, `turn_id`, `at`, `kind`, `stage`, `tool`, `meta` jsonb | research analytics; never free text (`meta` holds canonical disease, ISO3, model type, counts, durations, status words). Recorded for everyone regardless of consent. Kinds: conversation_started, turn, stage_reached, tool_called, tool_failed, run_completed, run_failed, refusal, suggestion_used, new_scenario, consent_given, consent_declined, web_search, web_fetch, export |
| `usage_daily` | `user_id`, `day`, `turns`, `input_tokens`, `output_tokens`, `cost_usd` | copied from CampusOtter with `reserve_turn` and `record_usage`, which make the caps race-free |

**Per-turn state.** A chat request loads the conversation's `messages` and its active `scenario`, runs the turn, and writes the new messages, turn, events, scenario, and step events in one transaction at the end. A turn that fails midway writes nothing, so history can never hold a `tool_use` without its `tool_result`. A `runs` row is written as soon as the simulation finishes, even if the turn later fails: a run is a fact.

**Purge.** A nightly maintenance route (cron, protected by `CRON_SECRET`) deletes conversations of users with `declined_at` set whose `updated_at` is older than `PURGE_DECLINED_AFTER_DAYS` (default 30). Their `step_events` remain (no text). The consent text states exactly this.

## 8. Simulation service (`sim/`)

Deterministic FastAPI over the existing generator, templates, executor, and data loaders. It calls a language model in one place only: parameter repair after a failed run.

```
POST /simulate            Authorization: Bearer <SIM_SHARED_SECRET>
  { "params": <SimParams JSON>, "pop_scale": 2419.6, "seed": 42, "context_text": "..." }
  200 { "ok": true,
        "effective_params": {...},         after resolve_demographics and any repair
        "stats": {...}, "stats_agents": {...},
        "series": { "day": [...], "n_susceptible": [...], "n_infected": [...], "n_recovered": [...],
                    "new_infections": [...], "cum_infections": [...], "new_deaths": [...], "cum_deaths": [...],
                    "n_exposed"?: [...], "n_asymptomatic"?: [...] },
        "pop_scale": 2419.6,
        "repairs": [ { "attempt": 1, "error": "<stderr tail>",
                       "changes": [ { "field": "dur_exp", "from": null, "to": 5.0 } ],
                       "usage": { "input_tokens": 1200, "output_tokens": 300, "cost_usd": 0.0108 } } ],
        "duration_ms": 2310, "starsim_version": "3.3.2" }
  401 bad or missing secret
  422 { "ok": false, "error": { "kind": "invalid_params", "detail": [...] } }
  500 { "ok": false, "error": { "kind": "execution_failed", "detail": "<stderr tail>", "repairs": [...] } }
  504 { "ok": false, "error": { "kind": "timeout", "seconds": 120 } }

GET  /demographics/{iso3}  Authorization: Bearer ...   offline UN WPP CSV fallback: { birth_rate, death_rate, source }
GET  /health                                           { ok, starsim_version }
```

- **Validation.** The body's `params` is validated by the same pydantic `SimParams`. Templates interpolate validated numbers and enums only; no path or free text from the request reaches a template.
- **Series output mode.** The six templates gain `output_mode: "json" | "plot"`. A shared Jinja include emits the series for whichever compartments exist. The plot mode stays for the CLI and the Streamlit app.
- **Scaling.** `stats` and `series` are scaled to the real population when `pop_scale > 1`; `stats_agents` keeps raw agent counts. One place does the arithmetic.
- **Effective parameters.** `resolve_demographics` (birth and death rates from the CSV loaders; `n_contacts` from the contact matrix with beta rescaled to hold R0) runs at generation time as today. Its result is returned so the run card shows what actually ran.
- **Repair.** On a Starsim failure the service calls `fix_params` (`epichat/parser.py`) with `context_text`, the current params, and the error, up to `SIM_MAX_REPAIRS` times (default 2, matching today's three attempts). Every attempt is logged in `repairs` with the field-level diff and the call's usage. `fix_params` moves its model to the `SIM_REPAIR_MODEL` setting (default `claude-opus-5-5`; today it hard-codes an older Sonnet). The web app adds the repair usage to the user's `usage_daily` and the agent tells the user what changed.
- **Execution** stays a subprocess with a timeout (`SIM_TIMEOUT_SECONDS`, default 120) so a crash or runaway run cannot take the function down. The Starsim import costs ~1.5 s per run.
- **Tests.** FastAPI test client: missing secret → 401; invalid params → 422 with detail; one real small run (1,000 agents, 30 days) returns consistent stats and series lengths; a forced failure exercises the repair path with `fix_params` mocked; `/demographics/KEN` returns the CSV values.

## 9. Agent core (`web/`)

### 9.1 Chat route

`POST /api/chat` (Node, `maxDuration = 300`) streams server-sent events. Body: `{ conversationId?: string, text: string }`. The server:

1. Authenticates (Supabase session), checks `email_confirmed_at` and the domain allowlist, and requires a consent decision (either one) in `profiles`.
2. Reserves a turn via `reserve_turn` (daily turns per user, monthly budget). Unlimited test addresses bypass the daily cap only.
3. Creates the conversation if `conversationId` is absent (title from the text) and loads messages plus the active scenario.
4. Runs the turn (9.2), emitting events as they happen.
5. Writes messages, the turn, turn events, scenario, and step events in one transaction; records usage (including any sim repair usage) in `finally`.

### 9.2 Turn loop

CampusOtter's `runTurn` extended:

- `client.messages.stream` with `tools = [six client tools, web_search_20260209 (max_uses 5), web_fetch_20260209 (max_uses 3, citations, max_content_tokens 20000)]`, system prompt and tools as the cached prefix, `output_config.effort` from settings, adaptive thinking left on (the model requires it), `max_tokens` from settings (default 16,000).
- Client tools carry `eager_input_streaming: true` and `strict: true` where the schema allows; every input is validated with zod before running.
- `stop_reason === "pause_turn"` (server-tool loop limit): push the paused assistant message and re-send, up to `MAX_PAUSE_CONTINUATIONS` (default 5). Beyond that, drop the turn and show the paused message as the Python agent does.
- `MAX_TOOL_ROUNDS` default 8 (confirm → fetch three sources → summarize is routine).
- Server-side refusal fallback enabled (`fallbacks: "default"` with its beta header) so a safety-classifier false positive on a high-fatality pathogen is rerouted by category. The golden set's `refused` check already counts both refusal paths; it is re-validated in sub-project 5. Setting `REFUSAL_FALLBACK=0` turns it off.
- Refusal, `max_tokens`, empty, and tool-limit outcomes map to the same discard and notice messages CampusOtter uses.

### 9.3 Tool registry

`web/lib/tools/<name>.ts`, each exporting a zod input schema, a `run(input, deps): Promise<ToolOutcome>`, and a payload type. `ToolOutcome = { content: string; isError?: boolean; payload?: CardPayload }`. `content` is what the model reads (JSON text of the payload minus large arrays); `payload` is what the card renders and what `turn_events` stores. `ToolDeps` carries the scenario (mutable), the sim client, the data adapters, the step-event sink, and the event emitter.

| Tool | Behavior (ported unchanged from `epichat/agent.py` on main) | TypeScript home |
|---|---|---|
| `lookup_disease(disease_name)` | alias detection → canonical name; for r0, incubation_days, infectious_days, fatality_rate, average_contacts_daily, immunity_duration, asymptomatic_fraction return the uncertainty-aware summary (`status` ok / under_review / estimates_only / no_source, typical, min, max, n_estimates, estimate_range, estimate_extremes, notes, review_note, sources); unknown → list of known diseases | `lib/disease/` reading `web/data/disease_parameters.json`, a committed copy of `epichat/data/disease_parameters.json` produced by `npm run sync-data`; a test fails if the two differ |
| `configure_simulation(...)` | merge only passed fields into the current params (default beta 22.8125 when none); vaccine / treatment / seasonality upserts; validate; if `r0` given, calibrate beta (random network: `r0 / (network_beta · asymp_factor · dur_inf/365 · n_contacts)`; age-structured: divide by the spectral radius of the POLYMOD matrix weighted by the age shares), clamped to [0.001, 1000]; set disease; return applied, approx_r0, config, literature warnings. New: `start_new_scenario: boolean` begins a new scenario row | `lib/sim/params.ts` (zod `SimParams` with the age-sum and required-field validators, `approxR0`, `calibrateBeta`, `recalibrateBeta`), `lib/disease/checkParams.ts` |
| `fetch_demographics(iso3)` | UN WPP live API (indicators 55, 59, 71, 49; location id from the adapter's ISO3 table); fallback `GET /demographics/{iso3}` on sim; auto-apply age shares (switch to `age_structured`, recalibrate beta to hold R0), birth/death rates, `total_population`; record sources; return applied, approx_r0, warnings, citations | `lib/data/unWpp.ts` |
| `fetch_health_system(iso3)` | World Bank Data360 (beds, physicians, nurses, UHC); if a treatment intervention exists set its capacity = beds per 1,000 × n_agents / 1,000 (min 1) | `lib/data/wbData360.ts` |
| `fetch_vaccination_coverage(iso3, disease)` | WHO GHO codes per disease (measles, rubella, pertussis, polio, hepatitis A, tuberculosis, meningococcal); if no vaccine intervention exists add one at min(1, coverage/100) from day 0 | `lib/data/whoGho.ts` |
| `run_simulation()` | requires params; `pop_scale = total_population / n_agents`; POST `/simulate`; store the run; return stats, attack_rate_pct, pop_scale, effective_params, warnings, repairs, data_sources (no series) | `lib/tools/runSimulation.ts`, `lib/sim/client.ts` |

Web server tools: `server_tool_use` blocks for `web_search`/`web_fetch` become `web_search`/`web_fetch` events (query; page title and URL). Fetched pages are appended to `scenario.web_sources` as the Python agent appends them to `data_sources`. Search hits are not sources. Server-tool errors arrive as data (an object with `error_code`) and become an error notice, never an exception.

**Parity fixtures.** A Python script (`scripts/export_parity_fixtures.py`) writes `web/tests/fixtures/parity.json`: a few hundred `SimParams` inputs with the Python `approx_r0`, `_calibrate_beta`, `recalibrate_beta`, and `check_params` outputs, plus the three adapters' row-mapping on recorded responses. The TypeScript tests assert equality within 1e-6. The fixture is regenerated when the Python side changes; CI fails if it is stale.

### 9.4 Scenario state

Loaded per turn, mutated by tools in memory, saved at the end. `context_text` is derived from the conversation's user turns when `detect_disease` needs it. `start_new_scenario` (or a first configuration) creates a scenario row; earlier scenarios stay for the compare feature in sub-project 5.

### 9.5 System prompt

The `pilot-readiness` prompt (`_SYSTEM` in `epichat/agent.py` on main) ported verbatim, then three additions:

1. End every reply with a fenced `next` block holding one to three short replies the user might send next, concrete to the moment ("Yes, fetch the data", "Run it", "Set R0 to 12", "Compare with 90% coverage"), each a complete message, never a placeholder. The app turns it into buttons and never shows it.
2. The interface renders disease parameters, configuration, fetched data, and results as cards from tool results. Do not retype those numbers in a table; interpret them: what the peak means, what the interventions did, what the limitations are.
3. When `run_simulation` reports repairs, tell the user which parameters were changed to make the run succeed and why, before interpreting the results.

### 9.6 Model and settings

Everything is an environment variable with a default, loaded once per process like CampusOtter's `loadSettings`.

| Setting | Default | Notes |
|---|---|---|
| `CHAT_MODEL` | `claude-opus-5-5` | cost profiles per model in `lib/models.ts` |
| `CHAT_EFFORT` | `medium` | Opus 5.5's own default; re-tuned by the golden set |
| `MAX_OUTPUT_TOKENS` | 16000 | |
| `MAX_TOOL_ROUNDS` / `MAX_PAUSE_CONTINUATIONS` | 8 / 5 | |
| `MONTHLY_BUDGET_USD` | 50 | hard stop via `reserve_turn` |
| `DAILY_TURNS_PER_USER` | 40 | |
| `MAX_MESSAGE_CHARS` | 6000 | |
| `ALLOWED_EMAIL_DOMAINS` | `emory.edu` | comma-separated |
| `RESEARCHER_EMAILS`, `UNLIMITED_EMAILS` | empty | gate the admin page; bypass the daily cap |
| `REFUSAL_FALLBACK` | 1 | |
| `PURGE_DECLINED_AFTER_DAYS` | 30 | |
| `SIM_INTERNAL_URL`, `SIM_SHARED_SECRET` | binding / secret | |
| `UN_API_KEY`, `ANTHROPIC_API_KEY`, Supabase keys, `CONTACT_EMAIL`, `WEBSITE_URL`, `CRON_SECRET`, `EVAL_BEARER_TOKEN` | | `EVAL_BEARER_TOKEN` enables the eval user only when set |
| sim: `SIM_SHARED_SECRET`, `ANTHROPIC_API_KEY`, `SIM_REPAIR_MODEL`, `SIM_MAX_REPAIRS`, `SIM_TIMEOUT_SECONDS` | — / — / `claude-opus-5-5` / 2 / 120 | |

### 9.7 Stream events (server → browser)

```
{ type: "text", delta }
{ type: "tool_use", id, name, input }
{ type: "tool_result", id, name, ok, payload }          payload: CardPayload (run payload includes the series live)
{ type: "web_search", query } | { type: "web_fetch", url, title }
{ type: "stage", stage }
{ type: "suggestions", items }
{ type: "done", turnId, conversationId, notice }
{ type: "discard", message } | { type: "error", code, message }
```

The browser folds these into a block list for the live turn, exactly the shape `turn_events` is stored in, so live and replayed conversations render through one component.

## 10. Workflow tracking and structured output

### 10.1 Stages

Five steps: **Understand · Configure · Ground in data · Run · Interpret.** Derived after every tool result and at turn end, never declared by the model:

```
running run_simulation             → run
active scenario has a finished run → interpret
scenario.data_sources non-empty    → ground
scenario.params present            → configure
otherwise                          → understand
```

A new scenario resets the strip. The first time a scenario reaches each stage a `stage_reached` step event is written; `turns.stage_after` records the stage at the end of each turn. The two confirmation gates in the workflow are observable without any model declaration: a fetch means the configuration was confirmed, a run means the parameters were.

### 10.2 Suggestions

The model's `next` block (section 9.5) is parsed server-side with CampusOtter's `parseNext`/`withoutNext` logic minus the stage line, stripped from the displayed text, sent as a `suggestions` event, and stored. Pressing one sends it as the user's message and writes a `suggestion_used` step event.

### 10.3 Cards

A turn renders as blocks in event order: prose, tool line, card, prose. Each card binds to one payload type (`CardPayload` discriminated union in `lib/cards/types.ts`):

| Card | Payload kind | Shows |
|---|---|---|
| Disease | `disease` | parameter rows: typical, range, status badge, estimate count; sources as footnotes; collapsed by default after the turn |
| Configuration | `config` | key settings in a grid (disease, model type, location, agents, duration, R0, periods, interventions); fields changed in this call highlighted; literature warnings as a strip |
| Data | `data` | source, location, fetched values with units, what was applied to the configuration, citation links; compact error state for a failed fetch |
| Web | `web_search` / `web_fetch` events | one line each |
| Run | `run` | live state while running (agents, elapsed); then stat tiles (peak with day, attack rate, deaths), an interactive time-series chart with compartment and incidence views, effective parameters, the repair log if any, data sources used |
| Tool error | `tool_error` | the message, in place |

The chart is drawn in the browser (Recharts), following the dataviz skill for form and color; no image is stored. On replay the run card fetches its series from `GET /api/runs/[id]`.

### 10.4 Scenario panel

A persistent panel beside the chat on desktop, collapsed into the header on mobile: the current configuration summary, the stage strip, and the data sources applied. Cards in the stream show the moment of change; the panel shows the present. The step strip and suggestion chips sit above the composer as in CampusOtter.

### 10.5 Researcher view

`/admin`, gated by `RESEARCHER_EMAILS`: a funnel of conversations by furthest stage reached, runs per day, refusals and tool errors, median turns to first run, suggestion usage; for consenting users a conversation list with replay through the same block renderer. `web/supabase/reports.sql` holds the saved queries.

## 11. Security and privacy

- Supabase RLS on with no policies; secret key server-only; browser roles revoked.
- Server checks on every chat request: session, confirmed email, allowed domain, consent decision present, caps.
- Sim service: private (no public rewrite) and bearer secret; validated params only; subprocess with timeout.
- `step_events` never holds free text. Research queries filter on `profiles.consented_at`; decliners purged after 30 days.
- `messages` append-only; model switches mid-conversation are allowed (thinking blocks from another model are dropped silently by the API).
- Request limits: message length, body size; tool inputs validated by zod; unknown tools refused.
- Secrets in Vercel environment variables only; `.env.local` and `sim/.env` gitignored; the Anthropic workspace spend limit set a little above `MONTHLY_BUDGET_USD` as the backstop.

## 12. Error handling

| Failure | Behavior |
|---|---|
| Tool throws or returns an error | `tool_result` with `is_error`; the model adapts; a tool-error card shows the message; `tool_failed` step event |
| Sim 422 / 500 / 504 | tool error "SIMULATION ERROR: …" with the repair log when present; the model proposes a fix with the user |
| API refusal | turn dropped; CampusOtter's refusal message; `refusal` step event with category; fallback rerouting when enabled |
| `pause_turn` exhausted | turn dropped; paused message shown |
| `max_tokens` with tool calls | turn dropped (a cut-off tool input can parse as valid) |
| Anthropic / network error | "temporarily unavailable, conversation intact"; nothing written for the turn |
| Client disconnects | the model call is aborted via `AbortSignal`; usage already incurred is still recorded |
| Caps reached | error event before any model call, with CampusOtter's cap messages |
| Supabase unavailable | error event; no turn |

## 13. Testing and evals

- **Web (vitest):** each tool against fake deps (no network); parity fixtures for the math and warnings; `runTurn` against a fake Anthropic client (refusal, pause_turn, tool limit, max_tokens, stream retry); `parseNext`; event folding; stage derivation; database tests on pglite running the migrations (caps, consent, purge, grants); route tests for the gates.
- **Sim (pytest):** section 8.
- **Package:** the existing suite unchanged; `scripts/export_parity_fixtures.py` tested for determinism.
- **CI:** `.github/workflows/tests.yml` gains `web` (npm ci, typecheck, lint, test, fixture freshness) and `sim` (pytest under 3.12) jobs.
- **Evals:** the golden set keeps its YAML cases and judge; the harness drives the deployed `/api/chat` as a dedicated eval user authenticated by `EVAL_BEARER_TOKEN`, and the deterministic checks read tool and stage events from the stream. Runs are ordinary usage records.
- **Browser check** on a Vercel preview at the end of every sub-project before merge.

## 14. Rollout and parity checklist

Preview deployments per branch; production at the Vercel URL first; a domain later. Streamlit (`app.py`) retires when all of these hold on the web app:

- [ ] A full dengue-in-Brazil flow in English and one in Portuguese answered in Portuguese
- [ ] Web search and URL reading shown as events and cited under results
- [ ] Data sources with citations on every run card
- [ ] PDF and Word export of a report
- [ ] Golden set green (critical cases 3/3) against the deployed app on `claude-opus-5-5`
- [ ] Caps enforced; consent recorded; researcher funnel populated

## 15. Sub-projects

Each gets its own plan (and, for 2–5, a short spec) before implementation. Verification points are the facts to confirm on a live deploy before the next sub-project starts.

### 15.1 Foundation (specified here)

Deliverables:
- `web/` scaffold: Next.js 16.3 App Router, TypeScript, Tailwind 4, vitest, eslint; `proxy.ts` refreshing the Supabase session on page routes; brand assets from `docs/brand/`; mobile-first layout.
- `web/supabase/migrations/0001_init.sql`: every table in section 7, `reserve_turn`, `record_usage`, indexes, RLS, grants. Safe to run twice.
- Sign-in: emailed 8-digit code (Supabase Auth, Resend SMTP, templates carrying the code and no link), domain allowlist checked in the form and on the server; long-lived sessions. `web/docs/DEPLOY.md` adapted from CampusOtter's.
- Consent: `web/content/consent.md` with a `version` in front matter; `/consent` screen shown until a decision exists or when the version changes; decision written to `profiles` and a `consent_given`/`consent_declined` step event.
- `lib/config.ts` settings loader; `lib/usage.ts` (reserve/record) and `lib/stepEvents.ts`; `lib/supabase/{server,client,admin,session}.ts`; `lib/auth.ts`.
- Routes: `/` (redirects to `/chat` or `/sign-in`), `/sign-in`, `/consent`, `/chat` (shell with header, history list from the database, empty state, composer disabled with "coming in the next step"), `/admin` (gated placeholder), `/api/health` (DB ping, cron), `/api/maintenance` (purge, cron, `CRON_SECRET`).
- `vercel.json`: services with `web` only, crons for health and maintenance.
- CI `web` job.

Verification points: sign in with a code on a preview deploy; consent recorded and re-prompted on a version bump; `reserve_turn` behaves under parallel calls (pglite test); health cron returns ok; services-with-one-service accepted (else the Root Directory fallback).

### 15.2 Simulation service

`sim/` per section 8; JSON output mode in the six templates with the plot mode untouched; `fix_params` model setting; tests; two-service `vercel.json` with the binding and shared secret; first two-service deploy.

Verification points: Starsim and numba install under Python 3.12; the package is importable from `sim/` on Vercel (or the copy step works); cold-start and run times for 10k and 100k agents recorded; `/simulate` reachable only via the binding.

### 15.3 Agent core

Tools, registry, parity fixtures, `runTurn`, prompt, `/api/chat`, persistence, caps wiring, a plain chat UI (markdown, tool lines, no cards), conversation list and resume.

Verification points: a full English scenario end to end on a preview; a Portuguese one; a refusal case; a `pause_turn` case with web search; usage rows and step events populated.

### 15.4 Workflow and cards

Stage derivation and strip, suggestions, the six card types and the chart, the scenario panel, the researcher funnel and replay, `reports.sql`.

Verification points: live and replayed conversations render identically; stage funnel matches a hand-counted sample; mobile layout.

### 15.5 Pilot hardening

Golden set against the API; PDF and Word export through a sim endpoint reusing `epichat/exporter.py`; scenario compare; Streamlit retirement; domain.

## 16. Risks and open items

| Risk | Mitigation |
|---|---|
| Vercel Services beta behaves differently on Hobby | one-service shape in SP1 exposes it early; Root Directory and separate-project fallbacks |
| Parent folders not available when building `sim/` | copy step in `buildCommand`; verified in SP2 |
| Starsim/numba wheels for Python 3.12 | install check at the start of SP2; container image is the fallback |
| Python cold start (Starsim + scipy) adds seconds to the first run | live run card shows progress; measured in SP2; Pro "Performance" instance if needed |
| Opus 5.5 behaves differently from Opus 5 on the golden set | re-run in SP5; effort and prompt tuned there; model is a setting |
| Refusal fallback changes guardrail behavior | `REFUSAL_FALLBACK` setting; the `refused` check counts both paths |
| Repair call silently changes parameters | repair log in the response, card, step event, and a prompt rule to disclose it |
| Series size for 20-year simulations | strided to ≤ 2,000 points; 4.5 MB body cap is far away |
