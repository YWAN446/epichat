# EpiChat Simulation Service — Design (sub-project 2)

Date: 2026-10-08. Parent: `docs/superpowers/specs/2026-10-07-web-agent-architecture-design.md`, sections 5, 6, 8, 15.2, 16. This document refines section 8 for implementation and records the decisions made on 2026-10-08. Where the two disagree, this one wins for the service; the parent still owns everything else.

## 1. Purpose

A private HTTP service that turns validated simulation parameters into Starsim results for the web app. It is deterministic Python over the existing generator, templates, and data loaders. It calls a language model in one place only: repairing parameters after a failed run. Sub-project 3 (the TypeScript agent) is its only client.

Success, from the parent's verification points, plus one measured on 2026-10-08:

| Point | Status |
|---|---|
| Starsim installs and runs under Python 3.12 | Verified locally: Starsim 3.3.2 with numba 0.68, numpy 2.5, pandas 3.0 runs all six templates on 3.12.1 |
| The package is importable from `sim/` on Vercel | Verified on the first deploy (section 7) |
| Cold-start and run times for 10k and 100k agents recorded | Local baseline in section 9; Vercel figures recorded in `web/docs/DEPLOY.md` on the first deploy |
| `/simulate` reachable only through the binding | Verified on the first deploy: the public address has no route to the service; the web health route reaches it through the binding |

## 2. Decisions made on 2026-10-08

- **Platform: Vercel Hobby, watch and upgrade.** Measured per-run CPU (section 9) puts a 20-participant pilot inside Hobby's 4 CPU-hours a month at 10k agents and near it at 100k. The runbook names the gauge and the trigger for moving to Pro ($20 a month, which removes the pause risk). Render and Cloud Run were costed and set aside; the service stays portable (plain FastAPI, a Dockerfile, one URL and one secret on the web side) so that choice is reversible.
- **Package reaches the bundle by copying at build time.** The service root stays `sim/`; its build command copies `epichat/` and `templates/` in. Locally, `main.py` puts the repository root on the import path instead. Fallback if the parent folders are not visible to the build: service root `.` with the entrypoint pointing into `sim/`.
- **Seed lives in `params.rand_seed`.** No separate `seed` field in the request.
- **Cost is priced by the web app.** Repair usage carries the model name and token counts; the web app owns the one price table (sub-project 3).
- **A timed-out attempt is final.** It is never repaired, so the worst case stays under the 300-second function limit.
- **Cap on agent-years.** `n_agents × sim_dur_years` above `SIM_MAX_AGENT_YEARS` (default 500,000) is refused before anything runs.
- **Four surgical package changes** (section 5.6): JSON output mode in the templates, a usage-returning repair function, an overridable demographics cache directory, and a lazy package `__init__`. Everything else in `epichat/` is untouched; the CLI and the Streamlit app keep their behavior.

## 3. Contract

All routes except `/health` require `Authorization: Bearer <SIM_SHARED_SECRET>`, compared in constant time. A missing or wrong bearer is 401 `{ "ok": false, "error": { "kind": "unauthorized" } }`. If the service has no secret configured, every protected route is 500 `{ "ok": false, "error": { "kind": "misconfigured" } }`: fail closed.

### POST /simulate

Request:

```json
{
  "params": { "...SimParams JSON; rand_seed inside..." },
  "pop_scale": 2419.6,
  "context_text": "what the user asked for, used only by the repair prompt"
}
```

`pop_scale` defaults to 1 and must be ≥ 1. `context_text` defaults to an empty string and is capped at 6,000 characters.

Success, 200:

```json
{
  "ok": true,
  "effective_params": { "...SimParams after resolve_demographics and any repair..." },
  "population": 24196000,
  "stats": { "peak_infections": 0, "peak_day": 0, "total_infected": 0, "total_deaths": 0,
             "n_agents": 10000, "sim_days": 366 },
  "stats_agents": { "...same keys, raw agent counts..." },
  "series": { "day": [], "n_susceptible": [], "n_infected": [], "n_recovered": [],
              "new_infections": [], "cum_infections": [], "new_deaths": [], "cum_deaths": [],
              "n_exposed": [], "n_asymptomatic": [] },
  "pop_scale": 2419.6,
  "repairs": [
    { "attempt": 1, "error": "last 2,000 characters of stderr",
      "changes": [ { "field": "dur_exp", "from": null, "to": 5.0 } ],
      "usage": { "model": "claude-opus-5-5", "input_tokens": 1200, "output_tokens": 300 } }
  ],
  "attempts": 2,
  "duration_ms": 2310,
  "cold_start": false,
  "starsim_version": "3.3.2"
}
```

- `effective_params` is what actually ran: the request's params after `resolve_demographics` (birth and death rates, `n_contacts`, beta rescaled to hold R0) and after the last successful repair.
- `population` is `round(n_agents × pop_scale)`.
- `stats` and the count series are multiplied by `pop_scale` and rounded to integers. `peak_day`, `n_agents`, and `sim_days` are not scaled. `stats_agents` keeps the raw counts. Stats are computed from the full daily series before thinning.
- `series.day` holds the day index of each kept point. The series is thinned to at most 2,000 points with a constant stride and the last day always kept. `n_exposed` is present for SEIR, SEIRS, and SEIAR; `n_asymptomatic` for SEIAR; the rest always.
- `repairs` is empty when the first attempt succeeded. `changes` is the field-level diff between the params before and after the repair; a changed `interventions` list appears as one change with the whole list on each side.
- `attempts` counts runs started (1 to `SIM_MAX_REPAIRS + 1`).

Failures:

| Status | Body | When |
|---|---|---|
| 422 | `{ "ok": false, "error": { "kind": "invalid_params", "detail": [ ...pydantic errors... ] } }` | the body or `params` fails validation |
| 422 | `{ "ok": false, "error": { "kind": "too_large", "detail": "n_agents × sim_dur_years = 2,000,000 exceeds the cap of 500,000 agent-years; reduce n_agents or sim_dur_years", "agent_years": 2000000, "cap": 500000 } }` | the cap is exceeded |
| 500 | `{ "ok": false, "error": { "kind": "execution_failed", "detail": "<stderr tail>", "repairs": [...], "attempts": 3 } }` | every attempt failed, or a repair call itself failed (that repair's record then has `"repair_error"` instead of `changes` and `usage`) |
| 504 | `{ "ok": false, "error": { "kind": "timeout", "seconds": 120, "repairs": [...], "attempts": 1 } }` | an attempt exceeded `SIM_TIMEOUT_SECONDS`; no repair follows |

### GET /demographics/{iso3}

Returns `{ "ok": true, "iso3": "KEN", "birth_rate": 27.1, "death_rate": 7.4, "source": "UN WPP 2024 (local CSV)" }` from the package's `get_demographics_for_sim`, which reads the bundled UN WPP and WHO CSVs and falls back to the World Bank API for gaps. An unknown code is 404 `{ "ok": false, "error": { "kind": "not_found" } }`. The cache this loader writes goes to `EPICHAT_CACHE_DIR`.

### GET /health

No bearer. `{ "ok": true, "starsim_version": "3.3.2", "python_version": "3.12.x", "cold_start": true }`. `cold_start` is true until this instance has served its first `/simulate`.

### Web side: `/api/health` gains a `sim` field

When called with the cron bearer and `SIM_INTERNAL_URL` is set, the web route calls `${SIM_INTERNAL_URL}/health` with a 5-second timeout and adds `"sim": { "ok": true, "starsim_version": "3.3.2", "cold_start": true }`, or `"sim": { "ok": false, "error": "<message>" }` if the call fails. Without `SIM_INTERNAL_URL` the field is `null`. The database check is unchanged and its result is unaffected by the sim's. This is the daily proof that the binding works.

For measurement only, the same bearer may add `?run=<n_agents>` (10 to 200,000). The route then also posts a one-year SIR with that many agents, `beta` 0.05, seed 1, to `/simulate` with the shared secret, and adds `"sim_run": { "n_agents", "duration_ms", "cold_start", "attempts", "status" }`. The cron never sends the parameter. Anyone else gets the usual 401.

## 4. Settings

All read from the environment at startup; every one has a default except the secret.

| Variable | Default | Meaning |
|---|---|---|
| `SIM_SHARED_SECRET` | none | Bearer the web app sends. Required. |
| `SIM_TIMEOUT_SECONDS` | 120 | Per-attempt subprocess timeout. |
| `SIM_MAX_REPAIRS` | 2 | Repair calls per request; attempts = repairs + 1. |
| `SIM_REPAIR_MODEL` | `claude-opus-5-5` | Model for the repair call. |
| `SIM_MAX_AGENT_YEARS` | 500000 | Cap on `n_agents × sim_dur_years`. |
| `SIM_SERIES_MAX_POINTS` | 2000 | Thinning target. |
| `EPICHAT_CACHE_DIR` | `<tempdir>/epichat-cache` | Where the package's data loaders may write. |
| `ANTHROPIC_API_KEY` | none | Needed only when a repair happens. |

## 5. Internals

```
sim/
  main.py          FastAPI app, auth, settings, cold-start flag, import-path setup
  service.py       the attempt loop (resolve → generate → run → repair → diff)
  runner.py        subprocess execution of a rendered script, JSON result file
  series.py        pure functions: scale, thin, stats
  requirements.txt starsim==3.3.2 and the rest, pinned
  Dockerfile       the exit route; not used on Vercel
  tests/
```

### 5.1 `main.py`

- Import path: if `sim/epichat` exists (the Vercel copy), `sim/` is the package root; otherwise the repository root (local). Set before any `epichat` import.
- Reads the settings table into a frozen dataclass once.
- `Depends(require_bearer)` on the protected routes, using `hmac.compare_digest`.
- Parses the body with a pydantic request model whose `params` field is the package's `SimParams`; FastAPI's own 422 is reshaped into the `invalid_params` body.
- Applies the agent-years cap, then calls `service.simulate(...)` and maps its outcome to a response and status.
- Holds the module-level `cold_start` flag, set false after the first `/simulate` completes.

### 5.2 `service.py`

```python
@dataclass
class Outcome:
    ok: bool
    status: int                      # 200, 500, 504
    effective_params: SimParams | None
    stats: dict | None               # raw agent counts
    series: dict | None              # full daily series
    repairs: list[dict]
    attempts: int
    error: str | None
    timed_out: bool

def simulate(params: SimParams, context_text: str, settings: Settings,
             run: Runner = run_script, repair: Repairer = repair_params) -> Outcome
```

Loop: `resolve_demographics(params)`; up to `max_repairs + 1` times: render with `CodeGenerator().generate(params, output_path, output_mode="json")`, `run(code, output_path, timeout)`; on success compute `stats` with `series.stats_from` on the full series and return; on timeout return 504 with the repairs so far; on failure, if repairs remain, call `repair(context_text, params, error, model)`, record the diff and usage, and continue with the repaired params; if the repair raises, record `repair_error` and return 500. `Runner` and `Repairer` are callables so the loop is tested with fakes. Scaling and thinning happen in `main.py` after the loop, through `series.py`.

### 5.3 `runner.py`

```python
@dataclass
class RunResult:
    ok: bool
    stats: dict
    series: dict
    error: str | None      # stderr tail, 2,000 characters
    timed_out: bool
    duration_ms: int

def run_script(code: str, output_path: Path, timeout: float) -> RunResult
```

Writes `code` to a temp file; runs `[sys.executable, path]` with `capture_output=True`, the timeout, and an environment that adds `PYTHONPATH` = the parent's `sys.path` joined, `NUMBA_CACHE_DIR` and `MPLCONFIGDIR` under the temp directory, and `EPICHAT_CACHE_DIR`; reads `output_path` as JSON on a zero exit; deletes both files. A non-zero exit or a missing result file is a failure with the stderr tail as the error. `TimeoutExpired` kills the child and returns `timed_out=True`.

### 5.4 `series.py`

- `stride_for(n_points, max_points) -> int`: `ceil(n / max_points)`, at least 1.
- `thin(series, max_points) -> dict`: keeps every stride-th index plus the last, writes `day` from the kept indices.
- `scale(values, factor) -> list[int]`: multiply and round; factor 1 returns the input rounded.
- `stats_from(series, n_agents) -> dict`: the six stats from the full series (`sim_days = len(day)`), so the template's own stats line is not relied upon.
- `scaled_outcome(stats, series, pop_scale)`: applies `scale` to the count keys and leaves `day` alone.

### 5.5 Repair diff

`diff_params(before: SimParams, after: SimParams) -> list[dict]`: compares `model_dump()` top-level keys; each differing key yields `{ "field", "from", "to" }`. Lives in `service.py`.

### 5.6 Package changes

1. **Templates.** Each of the six used templates (`sir`, `seir`, `sis`, `sirs`, `seirs`, `seiar`) ends with `{% include "_output.py.j2" %}` in place of its plotting block and stats print, and its top-level `import matplotlib` moves inside the include's plot branch. The include:
   - plot mode: today's figure code and the stats `print`, verbatim;
   - json mode: builds `series` from whichever of `n_susceptible, n_exposed, n_infected, n_asymptomatic, n_recovered, new_infections, cum_infections` exist in the disease results and `new_deaths, cum_deaths` in the sim results, as plain lists, plus `day = list(range(len(timevec)))`; writes `{ "stats": {...}, "series": {...} }` to `output_path`; prints the stats line as plot mode does.
   The SEIR template's `seir_res` name becomes `dr` so the include reads one name. `sir_vaccine.py.j2` is unused and untouched. `CodeGenerator.generate` gains `output_mode: Literal["plot", "json"] = "plot"` and passes it to the context; the existing positional callers are unchanged.
2. **`parser.py`.** New `repair_params(user_input, params, error_message, model) -> RepairResult` with `RepairResult(params: SimParams, model: str, input_tokens: int, output_tokens: int)`. `fix_params` keeps its signature and calls it with `_MODEL`, so the orchestrator and its tests are unchanged.
3. **`data_loaders/demographics.py`.** `CACHE_DIR = Path(os.environ.get("EPICHAT_CACHE_DIR", DATA_PATH / "cache"))`, read at import. The cache write in `get_country_demographics` is wrapped so an `OSError` is logged at debug level and ignored. Reading an absent cache is already handled.
4. **`epichat/__init__.py`.** Module-level `__getattr__` that imports `EpiChat` and `EpiChatResult` on first access. `from epichat import EpiChat` still works; `from epichat.generator import CodeGenerator` no longer imports the orchestrator, adapters, narrator, or the Anthropic SDK.

## 6. Deployment

### 6.1 `vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "services": {
    "web": {
      "root": "web",
      "bindings": [
        { "type": "service", "service": "sim", "format": "url", "env": "SIM_INTERNAL_URL" }
      ]
    },
    "sim": {
      "root": "sim",
      "entrypoint": "main:app",
      "buildCommand": "rm -rf epichat templates && cp -r ../epichat ../templates . && rm -rf epichat/__pycache__",
      "functions": {
        "main.py": {
          "maxDuration": 300,
          "excludeFiles": "{tests/**,epichat/data/demographics/cache/**,**/__pycache__/**}"
        }
      }
    }
  },
  "rewrites": [{ "source": "/(.*)", "destination": { "service": "web" } }],
  "crons": [{ "path": "/api/health", "schedule": "0 9 * * *" }]
}
```

No rewrite names `sim`, so it has no public route. `sim/epichat/` and `sim/templates/` are gitignored. Python version: `sim/.python-version` says `3.12`.

### 6.2 Environment

`SIM_SHARED_SECRET` (a long random string) is added to the Vercel project for Production and Preview; both services read the project's variables. `ANTHROPIC_API_KEY` is already there. `SIM_INTERNAL_URL` is set by the binding and never by hand. Locally, `web/.env.local` gets `SIM_INTERNAL_URL=http://localhost:8000` and the same secret; `sim/.env` is not used: the service reads the process environment, and the local recipe exports the two variables.

### 6.3 Ignore files

`.vercelignore` drops the lines `/epichat`, `/templates`, `*.py`, `*.txt` and keeps the rest (tests, results, docs, evals, the Streamlit folders, env files). `.gitignore` adds `sim/epichat/`, `sim/templates/`, and `sim/.venv/`.

### 6.4 CI

A third job, `sim`, on `ubuntu-latest` with Python 3.12: install `sim/requirements.txt` and pytest, run `pytest sim/tests -q` with `SIM_SHARED_SECRET=test` and `ANTHROPIC_API_KEY=test-key-never-used`. The template tests live under the main `tests/` folder and run in the existing 3.10 job.

### 6.5 Local development

Two processes: `uvicorn main:app --port 8000` in `sim/` (with the two variables exported) and `npm run dev` in `web/`. `vercel dev` from the root runs both with the binding injected. The runbook gets this recipe.

### 6.6 Dockerfile

`python:3.12-slim`, copies `epichat/`, `templates/`, and `sim/`, installs `sim/requirements.txt`, runs `uvicorn main:app --host 0.0.0.0 --port 8000`. Built in CI only as a syntax check is not worth a job; the runbook explains it is the migration path and how to run it.

## 7. First-deploy verification (goes into the runbook)

1. `npx vercel deploy` from the root builds both services. If the sim build cannot see `../epichat`, switch to the fallback in section 2 and record it.
2. Public probe: `GET https://epichat-ai.vercel.app/simulate` and `/health` are handled by the web app (404 from Next.js), never by the sim.
3. `GET /api/health` with the cron bearer returns `sim.ok: true` and the Starsim version.
4. Timing: `GET /api/health?run=10000` with the cron bearer, twice (the first is the cold start), then `?run=100000` once. These exercise the binding, the shared secret, the subprocess, and the JSON path on Vercel.
5. Record in the runbook: cold start, 10k and 100k durations, and the Active CPU reading before and after.
6. Hobby watch rule: the Usage page's Active CPU for the month is checked weekly during the study; if it passes 2 hours before mid-month, or a participant reports a paused app, upgrade to Pro.

## 8. Error handling

- Validation failures never reach a subprocess.
- The subprocess cannot take the function down: a crash is a non-zero exit, a hang is a timeout kill, both are reported as data.
- The repair call is the only network call in `/simulate`; its failure (network, refusal, unparseable JSON, invalid params) ends the loop with the error recorded, never an exception to the client.
- The cache write and numba cache are best effort; a read-only filesystem costs speed, not correctness.
- Request bodies above 4.5 MB are rejected by the platform before the app; a 20-year 100k-agent series is about 600 KB after thinning, far below the response cap.

## 9. Measured baseline (local, 2026-10-08)

Windows, Python 3.12.1, Starsim 3.3.2, one core. Vercel's vCPU is expected to be 1.5 to 2 times slower.

| Run | Import | Simulation CPU | Peak RSS |
|---|---|---|---|
| SIR 1k agents, 30 days | 1.8 s | 0.2 s | — |
| SIR 10k agents, 1 year | 2.2 s | 1.2 s | — |
| SEIR 10k agents, 1 year, demographics | 1.9 s | 1.5 s | 249 MB |
| SIR 100k agents, 1 year | 1.8 s | 7.3 s | — |
| SEIR 100k agents, 1 year, demographics | 1.8 s | 11.2 s | 294 MB |
| SEIR 100k agents, 5 years, demographics | — | 60 s | 332 MB |

Hobby's 4 CPU-hours (14,400 CPU-seconds) therefore cover about 1,500 runs at 10k agents or 400 at 100k, assuming a 2× slowdown and ignoring the web app's own CPU, which is small because the chat route mostly waits on the model.

## 10. Testing

`sim/tests` (Python 3.12, FastAPI `TestClient`, `SIM_SHARED_SECRET=test`):

- `test_series.py`: stride and thinning keep the last day and never exceed the cap; scaling rounds; stats match a hand-built series; factor 1 is the identity.
- `test_runner.py`: a script that writes a result file succeeds; a script that exits 1 reports the stderr tail; a script that sleeps 5 s with timeout 1 reports `timed_out`; the child sees `PYTHONPATH` and `NUMBA_CACHE_DIR`.
- `test_service.py` with fake runner and repairer: success first try has no repairs; fail then repair then succeed records one repair with the diff and usage; fail, repair, fail, repair, fail returns 500 with two repairs and three attempts; a timeout returns 504 with no repair; a repairer that raises returns 500 with `repair_error`; `resolve_demographics` output is what gets rendered.
- `test_api.py`: 401 without and with a wrong bearer; 500 `misconfigured` when the secret is unset; 422 `invalid_params` on a bad body; 422 `too_large` at the cap; `/health` shape and `cold_start` flipping after a run; `/demographics/KEN` returns the CSV values with `EPICHAT_CACHE_DIR` pointed at a temp directory and the cache file landing there; `/demographics/XXX` is 404.
- `test_real_run.py`: one real subprocess run per family (`sir`, `seir`, `seiar`) at 1,000 agents for 30 days with a fixed seed: 200, series lengths equal, `day` ends at the last index, `n_exposed` present only where expected, `stats_agents.total_infected == series.cum_infections[-1]`, and `pop_scale=100` scales `stats.total_infected` by 100 and leaves `stats_agents` alone.

`tests/test_templates_output.py` (main suite, 3.10 and 3.12): all six templates render in both modes with a representative params set; json-mode scripts contain no `matplotlib`; plot-mode scripts are byte-identical to today's output for the same params (a fixture captured before the change).

`tests/test_parser_unit.py` gains `repair_params` returning usage from a mocked client, and `fix_params` still returning `SimParams`. New `tests/test_demographics_cache.py`: `EPICHAT_CACHE_DIR` redirects the cache file; a read-only cache directory makes the lookup succeed without a file. New `tests/test_package_import.py`: importing `epichat.generator` leaves `epichat.epichat` and `anthropic` out of `sys.modules`; `from epichat import EpiChat` still works.

`web/tests/api/healthRoute.test.ts` gains: with `SIM_INTERNAL_URL` set and a fetch mock, the bearer response carries `sim`; with the fetch rejecting, `sim.ok` is false and the response is still 200; without the URL, `sim` is null; `?run=10000` with the bearer posts to `/simulate` with the shared secret and reports `sim_run`; `?run=` without the bearer is 401; an out-of-range `run` is ignored.

## 11. Out of scope

The TypeScript sim client, the run card, storing runs, and pricing the repair usage are sub-project 3. Streamlit and CLI behavior changes are none. Removing `sir_vaccine.py.j2` is not done here.
