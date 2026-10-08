# Simulation Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private FastAPI service in `sim/` that runs Starsim for the web app, deployed as the second Vercel service, with the four package changes that make it possible and a daily proof that the binding works.

**Architecture:** Four small modules under `sim/` (settings, series math, subprocess runner, attempt loop) behind one `main.py`, importing the unchanged `epichat` generator and data loaders. The templates gain a JSON output mode through one shared include. The web health route learns to call the service through the binding. Vercel builds the service from `sim/` after copying the package in.

**Tech Stack:** Python 3.12, FastAPI, Starsim 3.3.2 (pinned), pydantic 2, Jinja2, pytest with FastAPI's `TestClient`; Next.js 16 route handler with vitest on the web side; Vercel Services with a service binding.

**Spec:** `docs/superpowers/specs/2026-10-08-sim-service-design.md` (parent: `docs/superpowers/specs/2026-10-07-web-agent-architecture-design.md`, section 8).

## Global Constraints

- Python 3.12 for the service (`sim/.python-version` = `3.12`); the root suite still runs on 3.10. Locally: `py -3.12` and `py -3.10`.
- `starsim==3.3.2` pinned in `sim/requirements.txt`; the root `requirements.txt` is unchanged.
- Settings and defaults exactly as spec section 4: `SIM_SHARED_SECRET` (required), `SIM_TIMEOUT_SECONDS` 120, `SIM_MAX_REPAIRS` 2, `SIM_REPAIR_MODEL` `claude-opus-5-5`, `SIM_MAX_AGENT_YEARS` 500000, `SIM_SERIES_MAX_POINTS` 2000, `EPICHAT_CACHE_DIR` `<tempdir>/epichat-cache`.
- Every error body is `{ "ok": false, "error": { "kind": ... } }` with the kinds `unauthorized`, `misconfigured`, `invalid_params`, `too_large`, `execution_failed`, `timeout`, `not_found`.
- A timed-out attempt is never repaired. `context_text` is capped at 6,000 characters. `pop_scale` ≥ 1.
- Stats are computed from the full daily series before thinning; thinning keeps the last day; `day` carries real day indices.
- The CLI and the Streamlit app keep byte-identical plot-mode output (modulo the trailing newline).
- Only the four package changes in spec section 5.6 touch `epichat/`; `fix_params` keeps its signature.
- The sim service has no public rewrite. The web app only ever knows `SIM_INTERNAL_URL` and `SIM_SHARED_SECRET`.
- Commit messages end with the attribution lines the session provides.

## Review Focus

1. Two `/simulate` requests on one instance at the same time must not share a result file: the service must hand the runner a unique path per attempt. Pinned in Task 7 (`test_each_attempt_gets_its_own_output_path`).
2. A template that fails to render (a schema field the template does not know, a `StrictUndefined` miss) must come back as a 500 `execution_failed` with the message, not an unhandled exception. Pinned in Task 7 (`test_render_failure_is_execution_failed`).
3. A child process that writes non-UTF-8 bytes to stderr (Windows code pages, Starsim's box-drawing warnings) must not crash the runner; the error tail must still be returned. Pinned in Task 6 (`test_non_utf8_stderr_is_reported`).
4. A one-point series, or one shorter than the cap, must pass through thinning unchanged and never duplicate the last index. Pinned in Task 5 (`test_thin_short_series_is_identity`, `test_thin_one_point`).
5. When the measurement probe reaches the service but the service answers 422 or 500, the web health route must still return 200 with the status recorded, so a bad probe never looks like a dead app. Pinned in Task 9 (`reports a failed probe run without failing the route`).

---

## File structure

| Path | Responsibility |
|---|---|
| `epichat/__init__.py` | Lazy exports of `EpiChat`, `EpiChatResult` (Task 1) |
| `epichat/data_loaders/demographics.py` | `cache_dir()` from the environment; best-effort cache write (Task 2) |
| `epichat/parser.py` | `RepairResult`, `repair_params`; `fix_params` as wrapper (Task 3) |
| `templates/_output.py.j2` | Shared output include: plot branch (verbatim today's figure code) and json branch (Task 4) |
| `templates/{sir,seir,sis,sirs,seirs,seiar}.py.j2` | Conditional matplotlib import; tail replaced by the include (Task 4) |
| `epichat/generator.py` | `output_mode` parameter (Task 4) |
| `tests/template_cases.py`, `scripts/capture_template_fixtures.py`, `tests/fixtures/templates_plot/*.py`, `tests/test_templates_output.py` | Characterization fixtures and tests (Task 4) |
| `sim/requirements.txt`, `sim/.python-version`, `sim/tests/conftest.py` | Service environment (Task 5) |
| `sim/settings.py` | `Settings` dataclass and `load_settings(env)` (Task 5) |
| `sim/series.py` | `stride_for`, `thin`, `scale_counts`, `stats_from`, `scaled_outcome` (Task 5) |
| `sim/runner.py` | `RunResult`, `run_script` (Task 6) |
| `sim/service.py` | `Outcome`, `diff_params`, `simulate` (Task 7) |
| `sim/main.py` | FastAPI app, auth, routes, cold-start flag, import path (Task 8) |
| `sim/tests/test_real_run.py` | Real Starsim runs through the app (Task 8) |
| `web/lib/sim/health.ts`, `web/app/api/health/route.ts`, `web/tests/lib/simHealth.test.ts`, `web/tests/api/health.test.ts` | Binding proof and measurement probe (Task 9) |
| `vercel.json`, `.vercelignore`, `.gitignore`, `.github/workflows/tests.yml`, `sim/Dockerfile`, `web/.env.example`, `web/docs/DEPLOY.md` | Deployment (Task 10) |
| Owner's Task 11 | Secret in Vercel, first two-service deploy, verification list, timings into the runbook |

Spec refinements this plan makes (each is small; executors ledger nothing for them): settings live in `sim/settings.py` rather than inside `main.py`; `cache_dir()` is evaluated per call rather than at import so tests can redirect it; the SEIR template's `seir_res` is not renamed because the include derives its own handle from `sim.results`.

---

### Task 1: Lazy package import

**Files:**
- Modify: `epichat/__init__.py`
- Test: `tests/test_package_import.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `from epichat import EpiChat, EpiChatResult` still works; importing `epichat.generator` no longer imports `epichat.epichat` or `anthropic`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_package_import.py
"""Importing a leaf module of the package must not drag in the orchestrator.

The simulation service imports epichat.generator and epichat.schema only; if
the package __init__ eagerly imported EpiChat, the service bundle would need
every orchestrator dependency and pay its import time on every cold start.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _run(code: str) -> str:
    result = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, cwd=ROOT, check=True
    )
    return result.stdout.strip()


def test_importing_generator_leaves_orchestrator_out():
    out = _run(
        "import sys; import epichat.generator; "
        "print('epichat.epichat' in sys.modules, 'anthropic' in sys.modules)"
    )
    assert out == "False False"


def test_eager_names_still_resolve():
    out = _run("from epichat import EpiChat, EpiChatResult; print(EpiChat.__name__, EpiChatResult.__name__)")
    assert out == "EpiChat EpiChatResult"


def test_unknown_attribute_raises_attribute_error():
    out = _run(
        "import epichat\n"
        "try:\n    epichat.nope\nexcept AttributeError as e:\n    print('AttributeError', 'nope' in str(e))"
    )
    assert out == "AttributeError True"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `py -3.10 -m pytest tests/test_package_import.py -v`
Expected: `test_importing_generator_leaves_orchestrator_out` FAILS with `assert 'True True' == 'False False'`; the other two pass.

- [ ] **Step 3: Make the package import lazy**

Replace the whole of `epichat/__init__.py` with:

```python
"""EpiChat package.

The orchestrator (EpiChat, EpiChatResult) is exported lazily so that leaf
modules such as epichat.generator and epichat.schema can be imported without
loading the Anthropic SDK, the data adapters, and the narrator.
"""
from __future__ import annotations

__all__ = ["EpiChat", "EpiChatResult"]


def __getattr__(name: str):
    if name in __all__:
        from . import epichat as _orchestrator
        return getattr(_orchestrator, name)
    raise AttributeError(f"module 'epichat' has no attribute '{name}'")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `py -3.10 -m pytest tests/test_package_import.py -v`
Expected: 3 passed.

- [ ] **Step 5: Run the whole root suite**

Run: `py -3.10 -m pytest tests -q`
Expected: everything that passed before still passes (409 passed, 41 skipped on 2026-10-08, plus the 3 new).

- [ ] **Step 6: Commit**

```bash
git add epichat/__init__.py tests/test_package_import.py
git commit -m "refactor: export the orchestrator lazily from the package"
```

---

### Task 2: Overridable demographics cache

**Files:**
- Modify: `epichat/data_loaders/demographics.py` (lines 14-15 and the cache block around lines 296-299 and 350-354, plus `clear_cache` around line 372)
- Test: `tests/test_demographics_cache.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `cache_dir() -> Path` reading `EPICHAT_CACHE_DIR` on every call; `get_country_demographics` succeeds when the cache directory cannot be written.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_demographics_cache.py
"""The demographics loader must write its cache where the environment says
and must not fail when it cannot write at all (Vercel's filesystem is
read-only outside the temp directory)."""
import json
import os
import stat
from pathlib import Path

import pytest

from epichat.data_loaders import demographics


def _stub_sources(monkeypatch):
    monkeypatch.setattr(demographics, "_fetch_unwpp", lambda iso3, year: {
        "birth_rate": 20.5, "death_rate": 6.1, "life_expectancy": 70.0,
        "fertility_rate": 2.9, "infant_mortality": 30.0, "source": "stub WPP",
    })
    monkeypatch.setattr(demographics, "_fetch_who_mortality", lambda iso3, year=None: None)
    monkeypatch.setattr(demographics, "_fetch_data360", lambda *a, **k: None)


def test_cache_dir_comes_from_the_environment(monkeypatch, tmp_path):
    monkeypatch.setenv("EPICHAT_CACHE_DIR", str(tmp_path / "cache"))
    assert demographics.cache_dir() == tmp_path / "cache"


def test_cache_dir_defaults_next_to_the_data(monkeypatch):
    monkeypatch.delenv("EPICHAT_CACHE_DIR", raising=False)
    assert demographics.cache_dir() == demographics.DATA_PATH / "cache"


def test_lookup_writes_the_cache_where_told(monkeypatch, tmp_path):
    _stub_sources(monkeypatch)
    monkeypatch.setenv("EPICHAT_CACHE_DIR", str(tmp_path / "cache"))
    result = demographics.get_country_demographics("ZZZ", 2022)
    assert result["birth_rate"] == 20.5
    written = json.loads((tmp_path / "cache" / "ZZZ_2022.json").read_text())
    assert written["death_rate"] == 6.1


def test_lookup_survives_an_unwritable_cache(monkeypatch, tmp_path):
    _stub_sources(monkeypatch)
    blocker = tmp_path / "blocker"
    blocker.write_text("not a directory")
    monkeypatch.setenv("EPICHAT_CACHE_DIR", str(blocker / "cache"))  # mkdir will fail: parent is a file
    result = demographics.get_country_demographics("ZZY", 2022)
    assert result["birth_rate"] == 20.5
    assert not (blocker / "cache").exists()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `py -3.10 -m pytest tests/test_demographics_cache.py -v`
Expected: the two `cache_dir` tests FAIL with `AttributeError: module ... has no attribute 'cache_dir'`; `test_lookup_writes_the_cache_where_told` FAILS (the file lands under the package, not `tmp_path`); `test_lookup_survives_an_unwritable_cache` FAILS with `NotADirectoryError` or `FileExistsError`.

- [ ] **Step 3: Implement the override and the best-effort write**

In `epichat/data_loaders/demographics.py`, replace lines 14-15

```python
DATA_PATH = Path(__file__).parent.parent / 'data' / 'demographics'
CACHE_DIR  = DATA_PATH / 'cache'
```

with

```python
import os

DATA_PATH = Path(__file__).parent.parent / 'data' / 'demographics'


def cache_dir() -> Path:
    """Where lookups are cached. EPICHAT_CACHE_DIR overrides the default so a
    read-only deployment can point it at a temp directory."""
    override = os.environ.get("EPICHAT_CACHE_DIR")
    return Path(override) if override else DATA_PATH / 'cache'
```

In `get_country_demographics`, change the cache read

```python
    cache_file = CACHE_DIR / f'{iso3}_{year}.json'
```

to

```python
    cache_file = cache_dir() / f'{iso3}_{year}.json'
```

and the cache write

```python
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with open(cache_file, 'w') as f:
        json.dump(result, f, indent=2)
```

to

```python
    try:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        with open(cache_file, 'w') as f:
            json.dump(result, f, indent=2)
    except OSError as e:
        logger.debug("Demographics cache not written (%s): %s", cache_file, e)
```

In `clear_cache`, replace both `CACHE_DIR.glob(...)` with `cache_dir().glob(...)`. Search the file for any other `CACHE_DIR` and replace it the same way; none should remain.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `py -3.10 -m pytest tests/test_demographics_cache.py -v`
Expected: 4 passed.

- [ ] **Step 5: Run the whole root suite**

Run: `py -3.10 -m pytest tests -q`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add epichat/data_loaders/demographics.py tests/test_demographics_cache.py
git commit -m "feat(data): overridable demographics cache dir, best-effort cache write"
```

---

### Task 3: Repair with usage

**Files:**
- Modify: `epichat/parser.py` (the `fix_params` function at line 428 and the imports)
- Test: `tests/test_parser_unit.py` (append)

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```python
  @dataclass
  class RepairResult:
      params: SimParams
      model: str
      input_tokens: int
      output_tokens: int

  def repair_params(user_input: str, params: SimParams, error_message: str, model: str) -> RepairResult
  def fix_params(user_input: str, params: SimParams, error_message: str) -> SimParams   # unchanged
  ```

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_parser_unit.py`:

```python
# ── repair_params ─────────────────────────────────────────────────────────────
from epichat.parser import RepairResult, fix_params, repair_params


def _mock_llm_with_usage(response_text: str, input_tokens: int, output_tokens: int):
    client = _mock_llm(response_text)
    msg = client.messages.create.return_value
    msg.usage = MagicMock(input_tokens=input_tokens, output_tokens=output_tokens)
    return client


_REPAIRED = json.dumps({"disease_type": "seir", "beta": 0.05, "dur_exp": 5.0, "n_agents": 1000})


def test_repair_params_returns_params_model_and_usage():
    client = _mock_llm_with_usage(_REPAIRED, 1200, 300)
    before = SimParams(disease_type="sir", beta=0.05, n_agents=1000)
    with patch("epichat.parser.anthropic.Anthropic", return_value=client):
        result = repair_params("measles", before, "KeyError: dur_exp", "claude-opus-5-5")
    assert isinstance(result, RepairResult)
    assert result.params.disease_type == "seir" and result.params.dur_exp == 5.0
    assert result.model == "claude-opus-5-5"
    assert (result.input_tokens, result.output_tokens) == (1200, 300)
    assert client.messages.create.call_args.kwargs["model"] == "claude-opus-5-5"


def test_repair_params_tolerates_missing_usage():
    client = _mock_llm(_REPAIRED)
    client.messages.create.return_value.usage = None
    before = SimParams(disease_type="sir", beta=0.05, n_agents=1000)
    with patch("epichat.parser.anthropic.Anthropic", return_value=client):
        result = repair_params("measles", before, "err", "claude-opus-5-5")
    assert (result.input_tokens, result.output_tokens) == (0, 0)


def test_fix_params_still_returns_sim_params_with_the_parser_model():
    client = _mock_llm_with_usage(_REPAIRED, 1, 1)
    before = SimParams(disease_type="sir", beta=0.05, n_agents=1000)
    with patch("epichat.parser.anthropic.Anthropic", return_value=client):
        repaired = fix_params("measles", before, "err")
    assert isinstance(repaired, SimParams)
    assert repaired.dur_exp == 5.0
    from epichat.parser import _MODEL
    assert client.messages.create.call_args.kwargs["model"] == _MODEL
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `py -3.10 -m pytest tests/test_parser_unit.py -k "repair_params or fix_params_still" -v`
Expected: ImportError on `RepairResult` / `repair_params` (collection error).

- [ ] **Step 3: Implement `repair_params` and make `fix_params` a wrapper**

In `epichat/parser.py`, replace the whole `fix_params` function (from `def fix_params(` to its `return SimParams(**data)`) with:

```python
@dataclass
class RepairResult:
    """A repaired parameter set and what the call cost. The web app prices
    the tokens; this module only reports them."""
    params: SimParams
    model: str
    input_tokens: int
    output_tokens: int


def _token_count(usage, name: str) -> int:
    value = getattr(usage, name, None) if usage is not None else None
    return value if isinstance(value, int) else 0


def repair_params(user_input: str, params: SimParams, error_message: str, model: str) -> RepairResult:
    """
    Ask the LLM to fix parameters given a Starsim execution error, with the
    model chosen by the caller. Used by the simulation service's repair loop.
    """
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    recovery_prompt = (
        f"Original query: {user_input}\n\n"
        f"Parameters used:\n{json.dumps(params.model_dump(), indent=2)}\n\n"
        f"Starsim produced this error:\n{error_message}\n\n"
        "Please return a corrected JSON parameter object that will fix the error. "
        "Return ONLY the JSON object."
    )

    message = client.messages.create(
        model=model,
        max_tokens=1024,
        system="You are an epidemiological parameter assistant. Return only valid JSON matching the SimParams schema.",
        messages=[{"role": "user", "content": recovery_prompt}],
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    data = json.loads(raw)
    data = {k: v for k, v in data.items() if v is not None or k in ("dur_exp", "dur_immune", "rand_seed", "capacity")}
    usage = getattr(message, "usage", None)
    return RepairResult(
        params=SimParams(**data),
        model=model,
        input_tokens=_token_count(usage, "input_tokens"),
        output_tokens=_token_count(usage, "output_tokens"),
    )


def fix_params(user_input: str, params: SimParams, error_message: str) -> SimParams:
    """
    Ask the LLM to fix parameters given a Starsim execution error.
    Used by the error recovery loop in the orchestrator.
    """
    return repair_params(user_input, params, error_message, _MODEL).params
```

`dataclass` is already imported at the top of `parser.py`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `py -3.10 -m pytest tests/test_parser_unit.py -v`
Expected: all pass, including the three new ones.

- [ ] **Step 5: Run the whole root suite**

Run: `py -3.10 -m pytest tests -q`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add epichat/parser.py tests/test_parser_unit.py
git commit -m "feat(parser): repair_params returns the model and token usage"
```

---

### Task 4: JSON output mode in the templates

**Files:**
- Create: `tests/template_cases.py`, `scripts/capture_template_fixtures.py`, `tests/fixtures/templates_plot/{sir,seir,sis,sirs,seirs,seiar}.py`, `templates/_output.py.j2`
- Modify: `templates/sir.py.j2`, `templates/seir.py.j2`, `templates/sis.py.j2`, `templates/sirs.py.j2`, `templates/seirs.py.j2`, `templates/seiar.py.j2`, `epichat/generator.py:78-86`
- Test: `tests/test_templates_output.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `CodeGenerator.generate(params, output_path, pop_scale=1.0, output_mode="plot")`; in `"json"` mode the rendered script writes `{"stats": {...}, "series": {...}}` to `output_path` and never imports matplotlib. Series keys: `day` plus whichever of `n_susceptible, n_exposed, n_infected, n_asymptomatic, n_recovered, new_infections, cum_infections, new_deaths, cum_deaths` exist. Stats keys: `peak_infections, peak_day, total_infected, total_deaths, n_agents, sim_days`.

- [ ] **Step 1: Write the shared cases module**

```python
# tests/template_cases.py
"""Parameter sets that exercise every branch of the six templates. Shared by
the fixture-capture script and the template tests so both render the same
thing."""
from epichat.schema import SimParams

OUTPUT_PATH = "results/sim_fixture.png"


def _common(vaccine_start: int) -> dict:
    return dict(
        beta=0.05, n_agents=2000, sim_dur_years=0.5, rand_seed=7, n_contacts=6,
        interventions=[
            {"type": "vaccine", "coverage": 0.3, "start_day": vaccine_start},
            {"type": "treatment", "coverage": 0.5, "capacity": 20, "start_day": 3},
            {"type": "seasonality", "scale": 0.2, "shift": 0.1},
        ],
    )


def cases() -> dict[str, SimParams]:
    return {
        "sir": SimParams(disease_type="sir", **_common(0)),
        "seir": SimParams(disease_type="seir", dur_exp=4.0, **_common(10)),
        "sis": SimParams(disease_type="sis", **_common(10)),
        "sirs": SimParams(disease_type="sirs", dur_immune=90.0, **_common(0)),
        "seirs": SimParams(disease_type="seirs", dur_exp=4.0, dur_immune=90.0, **_common(10)),
        "seiar": SimParams(
            disease_type="seiar", dur_exp=4.0, p_asymp=0.4, rel_trans_asymp=0.5,
            network_type="age_structured", age_pct_under18=30.0, age_pct_18_64=60.0, age_pct_over65=10.0,
            use_demographics=True, birth_rate=25.0, death_rate=8.0, **_common(10),
        ),
    }
```

- [ ] **Step 2: Write and run the fixture-capture script (before any template change)**

```python
# scripts/capture_template_fixtures.py
"""Capture plot-mode renders of every template as characterization fixtures.

Run this ONCE before changing the templates, and again only when a template
change is meant to become the new baseline for the CLI and the Streamlit app:

    py -3.10 scripts/capture_template_fixtures.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from epichat.generator import CodeGenerator  # noqa: E402
from template_cases import OUTPUT_PATH, cases  # noqa: E402

out_dir = ROOT / "tests" / "fixtures" / "templates_plot"
out_dir.mkdir(parents=True, exist_ok=True)
generator = CodeGenerator()
for name, params in cases().items():
    rendered = generator.generate(params, OUTPUT_PATH)
    (out_dir / f"{name}.py").write_text(rendered, encoding="utf-8", newline="\n")
    print(f"wrote {name}: {len(rendered.splitlines())} lines")
```

Run: `py -3.10 scripts/capture_template_fixtures.py`
Expected: six `wrote <name>: N lines` lines; `tests/fixtures/templates_plot/` holds six `.py` files, each containing `import matplotlib.pyplot as plt` and ending with the `print(json.dumps({` block.

- [ ] **Step 3: Write the tests (characterization plus the failing json-mode ones)**

```python
# tests/test_templates_output.py
"""Plot mode must keep rendering exactly what the CLI and Streamlit app have
always run (fixtures captured before the JSON mode was added); json mode must
write a result file and never touch matplotlib."""
import re
from pathlib import Path

import pytest

from epichat.generator import CodeGenerator
from template_cases import OUTPUT_PATH, cases

FIXTURES = Path(__file__).parent / "fixtures" / "templates_plot"
CASES = cases()


@pytest.mark.parametrize("name", sorted(CASES))
def test_plot_mode_is_unchanged(name):
    rendered = CodeGenerator().generate(CASES[name], OUTPUT_PATH)
    expected = (FIXTURES / f"{name}.py").read_text(encoding="utf-8")
    assert rendered.rstrip("\n") == expected.rstrip("\n")


@pytest.mark.parametrize("name", sorted(CASES))
def test_plot_mode_is_the_default_and_explicit_plot_matches(name):
    generator = CodeGenerator()
    assert generator.generate(CASES[name], OUTPUT_PATH) == generator.generate(
        CASES[name], OUTPUT_PATH, output_mode="plot"
    )


@pytest.mark.parametrize("name", sorted(CASES))
def test_json_mode_never_imports_matplotlib(name):
    rendered = CodeGenerator().generate(CASES[name], "/tmp/out.json", output_mode="json")
    assert "matplotlib" not in rendered
    assert "plt." not in rendered


@pytest.mark.parametrize("name", sorted(CASES))
def test_json_mode_writes_stats_and_series_to_the_output_path(name):
    rendered = CodeGenerator().generate(CASES[name], "/tmp/out.json", output_mode="json")
    assert "json.dump({'stats': _stats, 'series': _series}, _f)" in rendered
    assert "open(r'/tmp/out.json', 'w', encoding='utf-8')" in rendered
    for key in ("n_susceptible", "n_infected", "n_recovered", "new_infections", "cum_infections",
                "new_deaths", "cum_deaths", "n_exposed", "n_asymptomatic"):
        assert f"'{key}'" in rendered
    assert "'day': list(range(len(_rs['timevec'])))" in rendered
    # the stats line the executor reads from stdout is still printed in json mode
    assert re.search(r"^print\(json\.dumps\(\{", rendered, re.MULTILINE)


def test_unknown_output_mode_is_rejected():
    with pytest.raises(ValueError, match="output_mode"):
        CodeGenerator().generate(CASES["sir"], OUTPUT_PATH, output_mode="pdf")


@pytest.mark.parametrize("name", sorted(CASES))
def test_both_modes_compile(name):
    for mode in ("plot", "json"):
        compile(CodeGenerator().generate(CASES[name], "/tmp/out", output_mode=mode), f"{name}-{mode}", "exec")
```

- [ ] **Step 4: Run the tests to verify the right ones fail**

Run: `py -3.10 -m pytest tests/test_templates_output.py -v`
Expected: the six `test_plot_mode_is_unchanged` PASS (characterization of today's output); every test that passes `output_mode=` FAILS with `TypeError: generate() got an unexpected keyword argument 'output_mode'`.

- [ ] **Step 5: Write the shared include**

Create `templates/_output.py.j2`. The plot branch is today's figure code from `templates/sir.py.j2` lines 156-231 verbatim (the block from `import matplotlib.pyplot as plt` through `plt.close(fig)`; all six templates carry the identical block); the stats print after `{% endif %}` is today's lines 233-240 verbatim. Whitespace control (`-%}`) keeps plot-mode output byte-identical.

```jinja
{% if output_mode == 'plot' -%}
import matplotlib.pyplot as plt

_dis_key = list(sim.diseases.keys())[0]
_dr = sim.results[_dis_key]
_rs = sim.results
_days = np.arange(len(_rs['timevec']))

fig, axes = plt.subplots(3, 3, figsize=(15, 10))
_ax = axes.flatten()

# (0,0) All compartments overview
for _k, _c, _l in [
    ('n_susceptible',  'steelblue',  'Susceptible'),
    ('n_exposed',      'gold',       'Exposed'),
    ('n_infected',     'firebrick',  'Infectious'),
    ('n_asymptomatic', 'darkorange', 'Asymptomatic'),
    ('n_recovered',    'seagreen',   'Recovered'),
]:
    if _k in _dr:
        _ax[0].plot(_days, _dr[_k].values, color=_c, label=_l)
_ax[0].set_title('All compartments')
_ax[0].set_xlabel('Day')
_ax[0].legend(fontsize=7)

# (0,1) Susceptible
_ax[1].set_title('Susceptible')
_ax[1].set_xlabel('Day')
if 'n_susceptible' in _dr:
    _ax[1].plot(_days, _dr['n_susceptible'].values, color='steelblue')

# (0,2) Infectious
_ax[2].set_title('Infectious')
_ax[2].set_xlabel('Day')
if 'n_infected' in _dr:
    _ax[2].plot(_days, _dr['n_infected'].values, color='firebrick')

# (1,0) Recovered
_ax[3].set_title('Recovered')
_ax[3].set_xlabel('Day')
if 'n_recovered' in _dr:
    _ax[3].plot(_days, _dr['n_recovered'].values, color='seagreen')

# (1,1) Prevalence
_ax[4].set_title('Prevalence (%)')
_ax[4].set_xlabel('Day')
if 'prevalence' in _dr:
    _ax[4].plot(_days, _dr['prevalence'].values * 100, color='firebrick')

# (1,2) New infections per day
_ax[5].set_title('New infections / day')
_ax[5].set_xlabel('Day')
if 'new_infections' in _dr:
    _ax[5].plot(_days, _dr['new_infections'].values, color='steelblue')

# (2,0) Cumulative infections
_ax[6].set_title('Cumulative infections')
_ax[6].set_xlabel('Day')
if 'cum_infections' in _dr:
    _ax[6].plot(_days, _dr['cum_infections'].values, color='steelblue')

# (2,1) New deaths per day
_ax[7].set_title('New deaths / day')
_ax[7].set_xlabel('Day')
if 'new_deaths' in _rs:
    _ax[7].plot(_days, _rs['new_deaths'].values, color='darkred')

# (2,2) Cumulative deaths
_ax[8].set_title('Cumulative deaths')
_ax[8].set_xlabel('Day')
if 'cum_deaths' in _rs:
    _ax[8].plot(_days, _rs['cum_deaths'].values, color='darkred')

fig.suptitle(_dis_key.upper() + ' Simulation', fontsize=13, y=1.01)
fig.tight_layout()
fig.savefig(r'{{ output_path }}', dpi=150, bbox_inches='tight')
plt.close(fig)
{% else -%}
_dr = res[list(sim.diseases.keys())[0]]
_rs = res
_series = {'day': list(range(len(_rs['timevec'])))}
for _k in ('n_susceptible', 'n_exposed', 'n_infected', 'n_asymptomatic', 'n_recovered',
           'new_infections', 'cum_infections'):
    if _k in _dr:
        _series[_k] = [float(_v) for _v in _dr[_k].values]
for _k in ('new_deaths', 'cum_deaths'):
    if _k in _rs:
        _series[_k] = [float(_v) for _v in _rs[_k].values]
_stats = {
    'peak_infections': int(n_infected.max()),
    'peak_day':        int(n_infected.argmax()),
    'total_infected':  int(cum_infections[-1]),
    'total_deaths':    int(cum_deaths[-1]),
    'n_agents':        {{ n_agents }},
    'sim_days':        len(res['timevec']),
}
with open(r'{{ output_path }}', 'w', encoding='utf-8') as _f:
    json.dump({'stats': _stats, 'series': _series}, _f)
{% endif %}
print(json.dumps({
    'peak_infections': int(n_infected.max()),
    'peak_day':        int(n_infected.argmax()),
    'total_infected':  int(cum_infections[-1]),
    'total_deaths':    int(cum_deaths[-1]),
    'n_agents':        {{ n_agents }},
    'sim_days':        len(res['timevec']),
}))
```

Before saving, diff the plot branch against `templates/sir.py.j2` lines 156-231 (`sed -n '156,231p' templates/sir.py.j2 > /tmp/a; sed -n '2,77p' templates/_output.py.j2 > /tmp/b; diff /tmp/a /tmp/b`). Expected: no output.

- [ ] **Step 6: Edit the six templates**

For each of `sir`, `seir`, `sis`, `sirs`, `seirs`, `seiar` in `templates/`:

(a) Replace lines 2-3

```
import matplotlib
matplotlib.use('Agg')
```

with

```
{% if output_mode == 'plot' -%}
import matplotlib
matplotlib.use('Agg')
{% endif -%}
```

(b) Delete everything from the line `import matplotlib.pyplot as plt` to the end of the file and put in its place one line:

```
{% include "_output.py.j2" %}
```

The line numbers of the pyplot import are: sir 156, seir 177, sis 150, sirs 175, seirs 190, seiar 198 (before edit (a) adds two lines; after it, add 2). Use the text, not the numbers.

Check: `grep -c "matplotlib" templates/sir.py.j2` prints `3` (the if-line, the import, the `use` line) and `grep -n "{% include" templates/*.j2` lists exactly six files.

- [ ] **Step 7: Add `output_mode` to the generator**

In `epichat/generator.py`, replace the `generate` method:

```python
    def generate(self, params: SimParams, output_path: str, pop_scale: float = 1.0,
                 output_mode: str = "plot") -> str:
        """Render the appropriate Jinja2 template and return executable Python code.

        output_mode "plot" (default) writes a PNG to output_path and prints the
        stats line, as the CLI and the Streamlit app expect. output_mode "json"
        writes {"stats", "series"} as JSON to output_path instead and never
        imports matplotlib; the simulation service uses it.
        """
        if output_mode not in ("plot", "json"):
            raise ValueError(f"output_mode must be 'plot' or 'json', got {output_mode!r}")
        params = resolve_demographics(params)          # auto-fill country demographics
        template_name = self._select_template(params)
        template = self._env.get_template(template_name)
        context = params.to_template_dict()
        context["output_path"] = output_path.replace("\\", "/")
        context["pop_scale"] = pop_scale
        context["output_mode"] = output_mode
        return template.render(**context)
```

- [ ] **Step 8: Run the template tests**

Run: `py -3.10 -m pytest tests/test_templates_output.py -v`
Expected: all pass. If a `test_plot_mode_is_unchanged` case fails, the diff is whitespace from the Jinja tags: compare `rendered` and the fixture line by line and fix the `-%}` placement in the template or the include; do not regenerate the fixtures.

- [ ] **Step 9: Run a real json-mode script under 3.10 to prove the branch executes**

Run:

```bash
py -3.10 -c "
import json, subprocess, sys, tempfile
sys.path.insert(0, 'tests')
from epichat.generator import CodeGenerator
from template_cases import cases
out = tempfile.mktemp(suffix='.json')
code = CodeGenerator().generate(cases()['seiar'], out, output_mode='json')
r = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True)
assert r.returncode == 0, r.stderr[-2000:]
d = json.load(open(out)); print(sorted(d['series']), d['stats'])"
```

Expected: a key list containing `cum_deaths, cum_infections, day, n_asymptomatic, n_exposed, n_infected, n_recovered, n_susceptible, new_deaths, new_infections` and a stats dict whose `sim_days` is 183 or 184 (half a year of daily steps plus day 0; Starsim rounds the step count).

- [ ] **Step 10: Run the whole root suite and commit**

Run: `py -3.10 -m pytest tests -q`
Expected: all green.

```bash
git add templates/_output.py.j2 templates/sir.py.j2 templates/seir.py.j2 templates/sis.py.j2 templates/sirs.py.j2 templates/seirs.py.j2 templates/seiar.py.j2 epichat/generator.py tests/template_cases.py tests/test_templates_output.py tests/fixtures/templates_plot scripts/capture_template_fixtures.py
git commit -m "feat(templates): json output mode through a shared include; plot mode unchanged"
```

---

### Task 5: Service skeleton, settings, and series math

**Files:**
- Create: `sim/requirements.txt`, `sim/.python-version`, `sim/tests/conftest.py`, `sim/settings.py`, `sim/series.py`
- Test: `sim/tests/test_settings.py`, `sim/tests/test_series.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```python
  # sim/settings.py
  @dataclass(frozen=True)
  class Settings:
      shared_secret: str          # "" when unset
      timeout_seconds: float      # 120
      max_repairs: int            # 2
      repair_model: str           # "claude-opus-5-5"
      max_agent_years: float      # 500000
      series_max_points: int      # 2000
      cache_dir: str              # <tempdir>/epichat-cache
  def load_settings(env: Mapping[str, str] = os.environ) -> Settings

  # sim/series.py
  COUNT_STATS = ("peak_infections", "total_infected", "total_deaths")
  def stride_for(n_points: int, max_points: int) -> int
  def thin(series: dict[str, list], max_points: int) -> dict[str, list]
  def scale_counts(values: list[float], factor: float) -> list[int]
  def stats_from(series: dict[str, list], n_agents: int) -> dict
  def scaled_outcome(stats: dict, series: dict[str, list], pop_scale: float) -> tuple[dict, dict]
  ```

- [ ] **Step 1: Create the environment files and a 3.12 virtualenv**

`sim/requirements.txt`:

```
starsim==3.3.2
fastapi>=0.115
uvicorn>=0.30
httpx>=0.27
jinja2>=3.1.0
pydantic>=2.0.0
anthropic>=0.76.0
python-dotenv>=1.0.0
pandas>=2.0
numpy>=1.26
requests>=2.31
```

`sim/.python-version`:

```
3.12
```

`sim/tests/conftest.py`:

```python
"""Make the flat sim modules and the repository's epichat package importable,
and give every test a secret and a dummy model key."""
import os
import sys
from pathlib import Path

SIM = Path(__file__).resolve().parent.parent
ROOT = SIM.parent
for path in (str(SIM), str(ROOT)):
    if path not in sys.path:
        sys.path.insert(0, path)

os.environ.setdefault("SIM_SHARED_SECRET", "test")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-never-used")
```

Run:

```bash
py -3.12 -m venv sim/.venv
sim/.venv/Scripts/python.exe -m pip install --disable-pip-version-check -q -r sim/requirements.txt pytest
sim/.venv/Scripts/python.exe -c "import starsim, fastapi, anthropic, sys; print(starsim.__version__, sys.version.split()[0])"
```

Expected: `3.3.2 3.12.x`. (The venv path is short enough to avoid the Windows long-path failure seen in the scratch directory.) Add `sim/.venv/` to `.gitignore` now (Task 10 adds the other lines):

```bash
printf 'sim/.venv/\n' >> .gitignore
```

- [ ] **Step 2: Write the failing settings tests**

```python
# sim/tests/test_settings.py
import tempfile
from pathlib import Path

from settings import Settings, load_settings


def test_defaults_match_the_spec():
    s = load_settings({"SIM_SHARED_SECRET": "abc"})
    assert s == Settings(
        shared_secret="abc", timeout_seconds=120.0, max_repairs=2, repair_model="claude-opus-5-5",
        max_agent_years=500000.0, series_max_points=2000,
        cache_dir=str(Path(tempfile.gettempdir()) / "epichat-cache"),
    )


def test_every_setting_reads_from_the_environment():
    s = load_settings({
        "SIM_SHARED_SECRET": "x", "SIM_TIMEOUT_SECONDS": "7.5", "SIM_MAX_REPAIRS": "0",
        "SIM_REPAIR_MODEL": "claude-sonnet-5-5", "SIM_MAX_AGENT_YEARS": "1000",
        "SIM_SERIES_MAX_POINTS": "50", "EPICHAT_CACHE_DIR": "/tmp/c",
    })
    assert (s.timeout_seconds, s.max_repairs, s.repair_model) == (7.5, 0, "claude-sonnet-5-5")
    assert (s.max_agent_years, s.series_max_points, s.cache_dir) == (1000.0, 50, "/tmp/c")


def test_missing_secret_is_empty_string():
    assert load_settings({}).shared_secret == ""
```

- [ ] **Step 3: Run them to verify they fail**

Run: `sim/.venv/Scripts/python.exe -m pytest sim/tests/test_settings.py -v`
Expected: `ModuleNotFoundError: No module named 'settings'`.

- [ ] **Step 4: Implement settings**

```python
# sim/settings.py
"""Service settings, read from the environment. Every value has a default
except the shared secret, whose absence makes the protected routes fail
closed (see main.py)."""
from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


@dataclass(frozen=True)
class Settings:
    shared_secret: str
    timeout_seconds: float
    max_repairs: int
    repair_model: str
    max_agent_years: float
    series_max_points: int
    cache_dir: str


def load_settings(env: Mapping[str, str] = os.environ) -> Settings:
    return Settings(
        shared_secret=env.get("SIM_SHARED_SECRET", ""),
        timeout_seconds=float(env.get("SIM_TIMEOUT_SECONDS", "120")),
        max_repairs=int(env.get("SIM_MAX_REPAIRS", "2")),
        repair_model=env.get("SIM_REPAIR_MODEL", "claude-opus-5-5"),
        max_agent_years=float(env.get("SIM_MAX_AGENT_YEARS", "500000")),
        series_max_points=int(env.get("SIM_SERIES_MAX_POINTS", "2000")),
        cache_dir=env.get("EPICHAT_CACHE_DIR", str(Path(tempfile.gettempdir()) / "epichat-cache")),
    )
```

- [ ] **Step 5: Run the settings tests**

Run: `sim/.venv/Scripts/python.exe -m pytest sim/tests/test_settings.py -v`
Expected: 3 passed.

- [ ] **Step 6: Write the failing series tests**

```python
# sim/tests/test_series.py
import pytest

from series import scale_counts, scaled_outcome, stats_from, stride_for, thin


def _series(n: int) -> dict:
    return {
        "day": list(range(n)),
        "n_infected": [float(i % 7) for i in range(n)],
        "cum_infections": [float(i * 2) for i in range(n)],
        "cum_deaths": [float(i // 10) for i in range(n)],
    }


def test_stride_for_is_ceil_and_at_least_one():
    assert stride_for(10, 2000) == 1
    assert stride_for(2000, 2000) == 1
    assert stride_for(2001, 2000) == 2
    assert stride_for(7301, 2000) == 4
    assert stride_for(0, 2000) == 1


def test_thin_short_series_is_identity():
    s = _series(31)
    assert thin(s, 2000) == s


def test_thin_one_point():
    s = _series(1)
    assert thin(s, 2000) == s


def test_thin_keeps_stride_points_and_the_last_day_without_duplicates():
    s = _series(7301)
    out = thin(s, 2000)
    assert len(out["day"]) <= 2000 + 1
    assert out["day"][0] == 0 and out["day"][-1] == 7300
    assert out["day"][1] == 4
    assert len(set(out["day"])) == len(out["day"])
    for key in s:
        assert len(out[key]) == len(out["day"])
    assert out["cum_infections"][-1] == s["cum_infections"][-1]


def test_thin_last_index_appears_exactly_once_whether_or_not_it_is_on_the_stride():
    off = thin(_series(4000), 2000)    # stride 2; last index 3999 is not on the stride -> appended
    assert off["day"][-1] == 3999 and off["day"][-2] == 3998
    on = thin(_series(3999), 2000)     # stride 2; last index 3998 is on the stride -> not appended twice
    assert on["day"][-1] == 3998 and on["day"][-2] == 3996
    assert len(on["day"]) == 2000


def test_scale_counts_rounds_and_identity_at_one():
    assert scale_counts([1.0, 2.4, 2.5, 3.6], 1.0) == [1, 2, 2, 4]
    assert scale_counts([1.0, 2.0], 2419.6) == [2420, 4839]


def test_stats_from_uses_the_full_series():
    s = _series(31)
    stats = stats_from(s, n_agents=500)
    assert stats == {
        "peak_infections": 6, "peak_day": 6, "total_infected": 60, "total_deaths": 3,
        "n_agents": 500, "sim_days": 31,
    }


def test_stats_from_without_deaths_series():
    s = _series(5)
    del s["cum_deaths"]
    assert stats_from(s, 10)["total_deaths"] == 0


def test_scaled_outcome_scales_counts_only():
    s = _series(3)
    stats = stats_from(s, 10)
    scaled_stats, scaled_series = scaled_outcome(stats, s, 100.0)
    assert scaled_stats["peak_infections"] == stats["peak_infections"] * 100
    assert scaled_stats["peak_day"] == stats["peak_day"]
    assert scaled_stats["n_agents"] == 10 and scaled_stats["sim_days"] == 3
    assert scaled_series["day"] == [0, 1, 2]
    assert scaled_series["cum_infections"] == [0, 200, 400]
    assert scaled_outcome(stats, s, 1.0)[0] == stats
```

- [ ] **Step 7: Run them to verify they fail**

Run: `sim/.venv/Scripts/python.exe -m pytest sim/tests/test_series.py -v`
Expected: `ModuleNotFoundError: No module named 'series'`.

- [ ] **Step 8: Implement the series math**

```python
# sim/series.py
"""Pure functions over the daily series a template writes: thinning for the
wire, scaling to a real population, and the headline stats. Stats are always
computed from the full series; thinning is the last thing that happens."""
from __future__ import annotations

import math

COUNT_STATS = ("peak_infections", "total_infected", "total_deaths")


def stride_for(n_points: int, max_points: int) -> int:
    if n_points <= 0 or max_points <= 0:
        return 1
    return max(1, math.ceil(n_points / max_points))


def thin(series: dict[str, list], max_points: int) -> dict[str, list]:
    n = len(series["day"])
    stride = stride_for(n, max_points)
    if stride == 1:
        return {key: list(values) for key, values in series.items()}
    keep = list(range(0, n, stride))
    if keep[-1] != n - 1:
        keep.append(n - 1)
    return {key: [values[i] for i in keep] for key, values in series.items()}


def scale_counts(values: list[float], factor: float) -> list[int]:
    return [int(round(v * factor)) for v in values]


def stats_from(series: dict[str, list], n_agents: int) -> dict:
    n_infected = series["n_infected"]
    peak_index = max(range(len(n_infected)), key=n_infected.__getitem__)
    deaths = series.get("cum_deaths")
    return {
        "peak_infections": int(round(n_infected[peak_index])),
        "peak_day": int(series["day"][peak_index]),
        "total_infected": int(round(series["cum_infections"][-1])),
        "total_deaths": int(round(deaths[-1])) if deaths else 0,
        "n_agents": n_agents,
        "sim_days": len(series["day"]),
    }


def scaled_outcome(stats: dict, series: dict[str, list], pop_scale: float) -> tuple[dict, dict]:
    scaled_stats = dict(stats)
    for key in COUNT_STATS:
        scaled_stats[key] = int(round(stats[key] * pop_scale))
    scaled_series = {
        key: (list(values) if key == "day" else scale_counts(values, pop_scale))
        for key, values in series.items()
    }
    return scaled_stats, scaled_series
```

- [ ] **Step 9: Run the series tests**

Run: `sim/.venv/Scripts/python.exe -m pytest sim/tests -v`
Expected: all pass (settings 3, series 9).

- [ ] **Step 10: Commit**

```bash
git add sim/requirements.txt sim/.python-version sim/tests/conftest.py sim/settings.py sim/series.py sim/tests/test_settings.py sim/tests/test_series.py .gitignore
git commit -m "feat(sim): service skeleton with settings and series math"
```

---

### Task 6: Subprocess runner

**Files:**
- Create: `sim/runner.py`
- Test: `sim/tests/test_runner.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```python
  @dataclass
  class RunResult:
      ok: bool
      stats: dict
      series: dict
      error: str | None      # stderr tail, at most 2,000 characters
      timed_out: bool
      duration_ms: int
  def run_script(code: str, output_path: Path, timeout: float) -> RunResult
  ```

- [ ] **Step 1: Write the failing tests**

```python
# sim/tests/test_runner.py
import json
import os
import sys
import tempfile
import time
from pathlib import Path

from runner import RunResult, run_script


def _out() -> Path:
    return Path(tempfile.gettempdir()) / f"epichat-test-{os.getpid()}-{time.time_ns()}.json"


def test_success_reads_the_result_file_and_removes_it():
    out = _out()
    code = (
        "import json, sys\n"
        f"json.dump({{'stats': {{'n_agents': 5}}, 'series': {{'day': [0, 1]}}}}, open(r'{out}', 'w'))\n"
        "print('some chatter on stdout')\n"
    )
    result = run_script(code, out, timeout=30)
    assert result.ok and not result.timed_out and result.error is None
    assert result.stats == {"n_agents": 5} and result.series == {"day": [0, 1]}
    assert result.duration_ms >= 0
    assert not out.exists()


def test_failure_reports_the_stderr_tail():
    result = run_script("import sys\nsys.stderr.write('x' * 3000 + 'END')\nsys.exit(1)\n", _out(), timeout=30)
    assert not result.ok and not result.timed_out
    assert result.error.endswith("END") and len(result.error) <= 2000


def test_missing_result_file_is_a_failure():
    result = run_script("print('did not write the file')\n", _out(), timeout=30)
    assert not result.ok
    assert "result file" in result.error


def test_timeout_kills_the_child():
    started = time.perf_counter()
    result = run_script("import time\ntime.sleep(10)\n", _out(), timeout=1)
    assert result.timed_out and not result.ok
    assert time.perf_counter() - started < 8
    assert "1" in result.error


def test_non_utf8_stderr_is_reported():
    code = "import sys\nsys.stderr.buffer.write(b'caf\\xe9 \\xff boom')\nsys.exit(2)\n"
    result = run_script(code, _out(), timeout=30)
    assert not result.ok
    assert "boom" in result.error


def test_child_sees_parent_import_path_and_cache_dirs():
    out = _out()
    code = (
        "import json, os\n"
        "json.dump({'stats': {}, 'series': {'env': [os.environ.get('PYTHONPATH', ''), "
        "os.environ.get('NUMBA_CACHE_DIR', ''), os.environ.get('MPLCONFIGDIR', '')]}}, "
        f"open(r'{out}', 'w'))\n"
    )
    result = run_script(code, out, timeout=30)
    pythonpath, numba, mpl = result.series["env"]
    assert str(Path(sys.path[0])) in pythonpath
    assert numba.endswith("numba") and mpl.endswith("mpl")
```

- [ ] **Step 2: Run them to verify they fail**

Run: `sim/.venv/Scripts/python.exe -m pytest sim/tests/test_runner.py -v`
Expected: `ModuleNotFoundError: No module named 'runner'`.

- [ ] **Step 3: Implement the runner**

```python
# sim/runner.py
"""Run a rendered simulation script in a child process.

The child gets the parent's import path (so the copied package and the
installed Starsim are found on Vercel), writable numba and matplotlib cache
directories, and a hard timeout. Its result is a JSON file it writes itself;
stdout is ignored and stderr's tail is the error."""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

STDERR_TAIL = 2000


@dataclass
class RunResult:
    ok: bool
    stats: dict
    series: dict
    error: str | None
    timed_out: bool
    duration_ms: int


def child_environment() -> dict[str, str]:
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(p for p in sys.path if p)
    scratch = Path(tempfile.gettempdir()) / "epichat-sim"
    env["NUMBA_CACHE_DIR"] = str(scratch / "numba")
    env["MPLCONFIGDIR"] = str(scratch / "mpl")
    env.setdefault("PYTHONIOENCODING", "utf-8")
    return env


def run_script(code: str, output_path: Path, timeout: float) -> RunResult:
    output_path = Path(output_path)
    started = time.perf_counter()
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
        f.write(code)
        script_path = Path(f.name)

    def elapsed() -> int:
        return int((time.perf_counter() - started) * 1000)

    try:
        completed = subprocess.run(
            [sys.executable, str(script_path)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=timeout, env=child_environment(),
        )
    except subprocess.TimeoutExpired:
        return RunResult(False, {}, {}, f"Simulation timed out after {timeout:g} seconds.", True, elapsed())
    finally:
        script_path.unlink(missing_ok=True)

    try:
        if completed.returncode != 0:
            tail = (completed.stderr or "").strip()[-STDERR_TAIL:] or f"exit code {completed.returncode}"
            return RunResult(False, {}, {}, tail, False, elapsed())
        if not output_path.exists():
            return RunResult(False, {}, {}, "Simulation finished but wrote no result file.", False, elapsed())
        import json
        with open(output_path, encoding="utf-8") as f:
            payload = json.load(f)
        return RunResult(True, payload.get("stats", {}), payload.get("series", {}), None, False, elapsed())
    finally:
        output_path.unlink(missing_ok=True)
```

- [ ] **Step 4: Run the runner tests**

Run: `sim/.venv/Scripts/python.exe -m pytest sim/tests/test_runner.py -v`
Expected: 6 passed. On Windows the timeout test takes about a second.

- [ ] **Step 5: Commit**

```bash
git add sim/runner.py sim/tests/test_runner.py
git commit -m "feat(sim): subprocess runner with timeout, env, and JSON result file"
```

---

### Task 7: The attempt loop

**Files:**
- Create: `sim/service.py`
- Test: `sim/tests/test_service.py`

**Interfaces:**
- Consumes: `Settings` (Task 5), `RunResult`, `run_script` (Task 6), `stats_from` (Task 5), `repair_params`/`RepairResult` (Task 3), `CodeGenerator`, `resolve_demographics`, `SimParams` from the package.
- Produces:
  ```python
  Runner = Callable[[str, Path, float], RunResult]
  Repairer = Callable[[str, SimParams, str, str], RepairResult]

  @dataclass
  class Outcome:
      ok: bool
      status: int                   # 200 | 500 | 504
      effective_params: SimParams
      stats: dict                   # raw agent counts, from stats_from
      series: dict                  # full daily series
      repairs: list[dict]
      attempts: int
      error: str | None
      timed_out: bool

  def diff_params(before: SimParams, after: SimParams) -> list[dict]
  def simulate(params: SimParams, context_text: str, settings: Settings,
               run: Runner = run_script, repair: Repairer = repair_params) -> Outcome
  ```
  Repair record shape: `{"attempt": n, "error": str, "changes": [...], "usage": {"model", "input_tokens", "output_tokens"}}` or `{"attempt": n, "error": str, "repair_error": str}`.

- [ ] **Step 1: Write the failing tests**

```python
# sim/tests/test_service.py
from pathlib import Path

import pytest

from epichat.parser import RepairResult
from epichat.schema import SimParams
from runner import RunResult
from service import Outcome, diff_params, simulate
from settings import load_settings

SETTINGS = load_settings({"SIM_SHARED_SECRET": "t", "SIM_TIMEOUT_SECONDS": "9", "SIM_MAX_REPAIRS": "2"})
GOOD_SERIES = {"day": [0, 1, 2], "n_infected": [1.0, 3.0, 2.0], "cum_infections": [1.0, 4.0, 6.0], "cum_deaths": [0.0, 0.0, 1.0]}


def _params(**over) -> SimParams:
    base = dict(disease_type="sir", beta=0.05, n_agents=100, sim_dur_years=0.01, rand_seed=1)
    base.update(over)
    return SimParams(**base)


def _ok() -> RunResult:
    return RunResult(True, {"n_agents": 100}, GOOD_SERIES, None, False, 10)


def _fail(msg="Traceback: KeyError: 'dur_exp'") -> RunResult:
    return RunResult(False, {}, {}, msg, False, 10)


def _timeout() -> RunResult:
    return RunResult(False, {}, {}, "Simulation timed out after 9 seconds.", True, 9000)


class FakeRunner:
    def __init__(self, results):
        self.results = list(results)
        self.calls: list[tuple[str, Path, float]] = []

    def __call__(self, code, output_path, timeout):
        self.calls.append((code, Path(output_path), timeout))
        return self.results.pop(0)


class FakeRepairer:
    def __init__(self, results):
        self.results = list(results)
        self.calls = []

    def __call__(self, user_input, params, error, model):
        self.calls.append((user_input, params, error, model))
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def _repair_to(params: SimParams) -> RepairResult:
    return RepairResult(params=params, model="claude-opus-5-5", input_tokens=120, output_tokens=30)


def test_diff_params_lists_changed_top_level_fields():
    before = _params()
    after = _params(disease_type="seir", dur_exp=5.0, interventions=[{"type": "vaccine", "coverage": 0.5}])
    changes = diff_params(before, after)
    assert {"field": "disease_type", "from": "sir", "to": "seir"} in changes
    assert {"field": "dur_exp", "from": None, "to": 5.0} in changes
    inter = next(c for c in changes if c["field"] == "interventions")
    assert inter["from"] == [] and inter["to"][0]["type"] == "vaccine"
    assert len(changes) == 3


def test_success_first_try_has_no_repairs_and_computes_stats():
    run = FakeRunner([_ok()])
    out = simulate(_params(), "measles", SETTINGS, run=run, repair=FakeRepairer([]))
    assert out.ok and out.status == 200 and out.attempts == 1 and out.repairs == []
    assert out.stats == {"peak_infections": 3, "peak_day": 1, "total_infected": 6, "total_deaths": 1,
                         "n_agents": 100, "sim_days": 3}
    assert out.series == GOOD_SERIES
    code, path, timeout = run.calls[0]
    assert "json.dump(" in code and "matplotlib" not in code
    assert str(path) in code.replace("\\\\", "\\") or path.as_posix() in code
    assert timeout == 9.0


def test_fail_then_repair_then_succeed_records_one_repair():
    repaired = _params(disease_type="seir", dur_exp=5.0)
    run = FakeRunner([_fail(), _ok()])
    repair = FakeRepairer([_repair_to(repaired)])
    out = simulate(_params(), "measles in Kenya", SETTINGS, run=run, repair=repair)
    assert out.ok and out.attempts == 2
    assert out.effective_params.disease_type == "seir"
    assert len(out.repairs) == 1
    record = out.repairs[0]
    assert record["attempt"] == 1 and "KeyError" in record["error"]
    assert {"field": "dur_exp", "from": None, "to": 5.0} in record["changes"]
    assert record["usage"] == {"model": "claude-opus-5-5", "input_tokens": 120, "output_tokens": 30}
    assert repair.calls[0][0] == "measles in Kenya" and repair.calls[0][3] == "claude-opus-5-5"
    assert "seir" in run.calls[1][0].lower()


def test_every_attempt_fails_returns_500_with_all_repairs():
    run = FakeRunner([_fail("e1"), _fail("e2"), _fail("e3")])
    repair = FakeRepairer([_repair_to(_params(beta=0.06)), _repair_to(_params(beta=0.07))])
    out = simulate(_params(), "x", SETTINGS, run=run, repair=repair)
    assert not out.ok and out.status == 500 and out.attempts == 3
    assert [r["attempt"] for r in out.repairs] == [1, 2]
    assert out.error == "e3" and not out.timed_out


def test_timeout_is_final_and_never_repaired():
    run = FakeRunner([_timeout()])
    repair = FakeRepairer([_repair_to(_params())])
    out = simulate(_params(), "x", SETTINGS, run=run, repair=repair)
    assert not out.ok and out.status == 504 and out.timed_out and out.attempts == 1
    assert repair.calls == [] and out.repairs == []


def test_repairer_failure_ends_the_loop_with_repair_error():
    run = FakeRunner([_fail("boom")])
    repair = FakeRepairer([RuntimeError("model unavailable")])
    out = simulate(_params(), "x", SETTINGS, run=run, repair=repair)
    assert not out.ok and out.status == 500 and out.attempts == 1
    assert out.repairs == [{"attempt": 1, "error": "boom", "repair_error": "RuntimeError: model unavailable"}]
    assert out.error == "boom"


def test_zero_repairs_setting_means_one_attempt():
    settings = load_settings({"SIM_SHARED_SECRET": "t", "SIM_MAX_REPAIRS": "0"})
    run = FakeRunner([_fail("only")])
    repair = FakeRepairer([_repair_to(_params())])
    out = simulate(_params(), "x", settings, run=run, repair=repair)
    assert out.status == 500 and out.attempts == 1 and repair.calls == []


def test_each_attempt_gets_its_own_output_path():
    run = FakeRunner([_fail(), _ok()])
    simulate(_params(), "x", SETTINGS, run=run, repair=FakeRepairer([_repair_to(_params(beta=0.06))]))
    paths = [call[1] for call in run.calls]
    assert paths[0] != paths[1]
    assert all(p.suffix == ".json" and p.name.startswith("epichat-") for p in paths)


def test_render_failure_is_execution_failed(monkeypatch):
    import service

    class BrokenGenerator:
        def generate(self, *a, **k):
            raise RuntimeError("'nope' is undefined")

    monkeypatch.setattr(service, "CodeGenerator", BrokenGenerator)
    out = simulate(_params(), "x", SETTINGS, run=FakeRunner([]), repair=FakeRepairer([]))
    assert not out.ok and out.status == 500 and out.attempts == 1
    assert "template" in out.error and "nope" in out.error


def test_effective_params_are_the_resolved_ones():
    run = FakeRunner([_ok()])
    out = simulate(_params(n_contacts=4), "x", SETTINGS, run=run, repair=FakeRepairer([]))
    assert out.effective_params.n_contacts == 4   # no country: resolve_demographics leaves them alone
    assert isinstance(out, Outcome)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `sim/.venv/Scripts/python.exe -m pytest sim/tests/test_service.py -v`
Expected: `ModuleNotFoundError: No module named 'service'`.

- [ ] **Step 3: Implement the loop**

```python
# sim/service.py
"""The attempt loop: resolve demographics, render, run, and on failure ask the
model to repair the parameters, up to the configured number of times.

Runner and Repairer are injected so the loop is tested without Starsim or the
model. A timed-out attempt is final. Scaling and thinning are not done here;
main.py applies them to the raw outcome."""
from __future__ import annotations

import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from epichat.generator import CodeGenerator, resolve_demographics
from epichat.parser import RepairResult, repair_params
from epichat.schema import SimParams
from runner import RunResult, run_script
from series import stats_from
from settings import Settings

Runner = Callable[[str, Path, float], RunResult]
Repairer = Callable[[str, SimParams, str, str], RepairResult]


@dataclass
class Outcome:
    ok: bool
    status: int
    effective_params: SimParams
    stats: dict = field(default_factory=dict)
    series: dict = field(default_factory=dict)
    repairs: list[dict] = field(default_factory=list)
    attempts: int = 0
    error: str | None = None
    timed_out: bool = False


def diff_params(before: SimParams, after: SimParams) -> list[dict]:
    old, new = before.model_dump(), after.model_dump()
    return [{"field": key, "from": old[key], "to": new[key]} for key in old if old[key] != new[key]]


def _output_path() -> Path:
    return Path(tempfile.gettempdir()) / f"epichat-{uuid.uuid4().hex}.json"


def simulate(params: SimParams, context_text: str, settings: Settings,
             run: Runner = run_script, repair: Repairer = repair_params) -> Outcome:
    params = resolve_demographics(params)
    repairs: list[dict] = []
    attempts = 0
    last_error: str | None = None

    while attempts <= settings.max_repairs:
        attempts += 1
        output_path = _output_path()
        try:
            code = CodeGenerator().generate(params, str(output_path), output_mode="json")
        except Exception as e:  # a template that cannot render is a failed run, not a crash
            return Outcome(False, 500, params, repairs=repairs, attempts=attempts,
                           error=f"template error: {type(e).__name__}: {e}")
        result = run(code, output_path, settings.timeout_seconds)
        if result.ok:
            return Outcome(True, 200, params, stats=stats_from(result.series, params.n_agents),
                           series=result.series, repairs=repairs, attempts=attempts)
        last_error = result.error or "unknown execution error"
        if result.timed_out:
            return Outcome(False, 504, params, repairs=repairs, attempts=attempts,
                           error=last_error, timed_out=True)
        if attempts > settings.max_repairs:
            break
        try:
            repaired = repair(context_text, params, last_error, settings.repair_model)
        except Exception as e:
            repairs.append({"attempt": attempts, "error": last_error,
                            "repair_error": f"{type(e).__name__}: {e}"})
            return Outcome(False, 500, params, repairs=repairs, attempts=attempts, error=last_error)
        repairs.append({
            "attempt": attempts, "error": last_error,
            "changes": diff_params(params, repaired.params),
            "usage": {"model": repaired.model, "input_tokens": repaired.input_tokens,
                      "output_tokens": repaired.output_tokens},
        })
        params = resolve_demographics(repaired.params)

    return Outcome(False, 500, params, repairs=repairs, attempts=attempts, error=last_error)
```

- [ ] **Step 4: Run the service tests**

Run: `sim/.venv/Scripts/python.exe -m pytest sim/tests/test_service.py -v`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add sim/service.py sim/tests/test_service.py
git commit -m "feat(sim): attempt loop with repair records and diffs"
```

---

### Task 8: The FastAPI app

**Files:**
- Create: `sim/main.py`
- Test: `sim/tests/test_api.py`, `sim/tests/test_real_run.py`

**Interfaces:**
- Consumes: `load_settings` (Task 5), `thin`, `scaled_outcome` (Task 5), `simulate`, `Outcome` (Task 7), `get_demographics_for_sim`, `SimParams` from the package, `starsim.__version__`.
- Produces: the HTTP contract of spec section 3; `app` for `uvicorn main:app`.

- [ ] **Step 1: Write the failing API tests**

```python
# sim/tests/test_api.py
import importlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from epichat.schema import SimParams
from runner import RunResult
from service import Outcome

GOOD_SERIES = {"day": list(range(5)), "n_infected": [1.0, 4.0, 3.0, 2.0, 1.0],
               "cum_infections": [1.0, 5.0, 8.0, 10.0, 11.0], "cum_deaths": [0.0, 0.0, 0.0, 1.0, 1.0]}
PARAMS = {"disease_type": "sir", "beta": 0.05, "n_agents": 1000, "sim_dur_years": 0.1, "rand_seed": 1}
AUTH = {"Authorization": "Bearer test"}


@pytest.fixture
def main(monkeypatch):
    monkeypatch.setenv("SIM_SHARED_SECRET", "test")
    import main as module
    importlib.reload(module)
    return module


@pytest.fixture
def client(main):
    return TestClient(main.app)


def _fake_simulate(outcome: Outcome):
    calls = []

    def fake(params, context_text, settings, run=None, repair=None):
        calls.append((params, context_text, settings))
        return outcome

    fake.calls = calls
    return fake


def _success(params: SimParams) -> Outcome:
    from series import stats_from
    return Outcome(True, 200, params, stats=stats_from(GOOD_SERIES, params.n_agents), series=GOOD_SERIES, attempts=1)


def test_health_needs_no_bearer_and_reports_versions(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["starsim_version"] == "3.3.2"
    assert body["python_version"].startswith("3.") and body["cold_start"] is True


def test_simulate_rejects_missing_and_wrong_bearer(client):
    assert client.post("/simulate", json={"params": PARAMS}).status_code == 401
    r = client.post("/simulate", json={"params": PARAMS}, headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401
    assert r.json() == {"ok": False, "error": {"kind": "unauthorized"}}


def test_demographics_rejects_missing_bearer(client):
    assert client.get("/demographics/KEN").status_code == 401


def test_missing_secret_fails_closed(monkeypatch):
    monkeypatch.delenv("SIM_SHARED_SECRET", raising=False)
    import main as module
    importlib.reload(module)
    r = TestClient(module.app).post("/simulate", json={"params": PARAMS}, headers=AUTH)
    assert r.status_code == 500
    assert r.json() == {"ok": False, "error": {"kind": "misconfigured"}}


def test_invalid_params_is_422_with_field_errors(client):
    r = client.post("/simulate", json={"params": {"disease_type": "seir", "beta": 0.05}}, headers=AUTH)
    assert r.status_code == 422
    body = r.json()
    assert body["ok"] is False and body["error"]["kind"] == "invalid_params"
    assert any("dur_exp" in e["msg"] for e in body["error"]["detail"])
    r2 = client.post("/simulate", json={"params": "not an object"}, headers=AUTH)
    assert r2.status_code == 422 and r2.json()["error"]["kind"] == "invalid_params"
    r3 = client.post("/simulate", json={"params": PARAMS, "pop_scale": 0.5}, headers=AUTH)
    assert r3.status_code == 422


def test_too_large_is_422_naming_the_cap(client, monkeypatch, main):
    monkeypatch.setenv("SIM_MAX_AGENT_YEARS", "1000")
    r = client.post("/simulate", json={"params": {**PARAMS, "n_agents": 2000, "sim_dur_years": 1.0}}, headers=AUTH)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["kind"] == "too_large" and err["cap"] == 1000 and err["agent_years"] == 2000
    assert "reduce n_agents or sim_dur_years" in err["detail"]


def test_success_scales_thins_and_flips_cold_start(client, main, monkeypatch):
    params = SimParams(**PARAMS)
    fake = _fake_simulate(_success(params))
    monkeypatch.setattr(main, "simulate", fake)
    monkeypatch.setenv("SIM_SERIES_MAX_POINTS", "3")
    r = client.post("/simulate", json={"params": PARAMS, "pop_scale": 100, "context_text": "hi"}, headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] and body["cold_start"] is True and body["attempts"] == 1
    assert body["population"] == 100000 and body["pop_scale"] == 100
    assert body["stats_agents"]["total_infected"] == 11 and body["stats"]["total_infected"] == 1100
    assert body["stats"]["peak_day"] == 1 and body["stats"]["sim_days"] == 5
    assert body["series"]["day"] == [0, 2, 4] and body["series"]["cum_infections"] == [100, 800, 1100]
    assert body["effective_params"]["n_agents"] == 1000 and body["repairs"] == []
    assert body["starsim_version"] == "3.3.2" and body["duration_ms"] >= 0
    assert fake.calls[0][1] == "hi"
    assert client.get("/health").json()["cold_start"] is False
    r2 = client.post("/simulate", json={"params": PARAMS}, headers=AUTH)
    assert r2.json()["cold_start"] is False


def test_execution_failed_and_timeout_bodies(client, main, monkeypatch):
    params = SimParams(**PARAMS)
    repairs = [{"attempt": 1, "error": "e1", "changes": [], "usage": {"model": "m", "input_tokens": 1, "output_tokens": 1}}]
    monkeypatch.setattr(main, "simulate", _fake_simulate(Outcome(False, 500, params, repairs=repairs, attempts=2, error="e2")))
    r = client.post("/simulate", json={"params": PARAMS}, headers=AUTH)
    assert r.status_code == 500
    assert r.json() == {"ok": False, "error": {"kind": "execution_failed", "detail": "e2", "repairs": repairs, "attempts": 2}}
    monkeypatch.setattr(main, "simulate", _fake_simulate(Outcome(False, 504, params, attempts=1, error="t", timed_out=True)))
    r = client.post("/simulate", json={"params": PARAMS}, headers=AUTH)
    assert r.status_code == 504
    assert r.json() == {"ok": False, "error": {"kind": "timeout", "seconds": 120, "repairs": [], "attempts": 1}}


def test_context_text_is_capped(client):
    r = client.post("/simulate", json={"params": PARAMS, "context_text": "x" * 6001}, headers=AUTH)
    assert r.status_code == 422 and r.json()["error"]["kind"] == "invalid_params"


def test_demographics_from_the_csv_with_cache_redirected(client, monkeypatch, tmp_path):
    monkeypatch.setenv("EPICHAT_CACHE_DIR", str(tmp_path / "cache"))
    r = client.get("/demographics/ken", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] and body["iso3"] == "KEN"
    assert 20 < body["birth_rate"] < 40 and 3 < body["death_rate"] < 15
    assert "WPP" in body["source"]
    assert list((tmp_path / "cache").glob("KEN_*.json"))


def test_demographics_unknown_code_is_404(client, monkeypatch, tmp_path):
    monkeypatch.setenv("EPICHAT_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setattr("epichat.data_loaders.demographics._fetch_data360", lambda *a, **k: None)
    r = client.get("/demographics/XXX", headers=AUTH)
    assert r.status_code == 404
    assert r.json() == {"ok": False, "error": {"kind": "not_found"}}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `sim/.venv/Scripts/python.exe -m pytest sim/tests/test_api.py -v`
Expected: `ModuleNotFoundError: No module named 'main'`.

- [ ] **Step 3: Implement the app**

```python
# sim/main.py
"""EpiChat simulation service.

Private FastAPI app: validates SimParams, runs Starsim through the package's
generator and templates, repairs parameters with the model when a run fails,
and returns stats and series. Reachable from the web app only through the
Vercel service binding plus a shared secret.
"""
from __future__ import annotations

import hmac
import os
import platform
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PACKAGE_ROOT = HERE if (HERE / "epichat").is_dir() else HERE.parent   # Vercel copy vs. local checkout
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
os.environ.setdefault("EPICHAT_CACHE_DIR", str(Path(tempfile.gettempdir()) / "epichat-cache"))

import starsim  # noqa: E402
from fastapi import Depends, FastAPI, HTTPException, Request  # noqa: E402
from fastapi.exceptions import RequestValidationError  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from epichat.data_loaders.demographics import get_demographics_for_sim  # noqa: E402
from epichat.schema import SimParams  # noqa: E402
from series import scaled_outcome, thin  # noqa: E402
from service import simulate  # noqa: E402
from settings import Settings, load_settings  # noqa: E402

app = FastAPI(title="EpiChat simulation service", docs_url=None, redoc_url=None)
_state = {"served": False}


class SimulateRequest(BaseModel):
    params: SimParams
    pop_scale: float = Field(default=1.0, ge=1.0)
    context_text: str = Field(default="", max_length=6000)


def _error(status: int, kind: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"ok": False, "error": {"kind": kind, **extra}})


@app.exception_handler(HTTPException)
async def _http_error(_: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, dict) else {"kind": "error", "detail": exc.detail}
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "error": detail})


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    detail = [{"loc": [str(p) for p in e.get("loc", [])], "msg": e.get("msg", ""), "type": e.get("type", "")}
              for e in exc.errors()]
    return _error(422, "invalid_params", detail=detail)


def require_bearer(request: Request) -> Settings:
    settings = load_settings()
    if not settings.shared_secret:
        raise HTTPException(500, {"kind": "misconfigured"})
    given = request.headers.get("authorization", "")
    expected = f"Bearer {settings.shared_secret}"
    if not hmac.compare_digest(given.encode(), expected.encode()):
        raise HTTPException(401, {"kind": "unauthorized"})
    return settings


@app.get("/health")
def health() -> dict:
    return {"ok": True, "starsim_version": starsim.__version__,
            "python_version": platform.python_version(), "cold_start": not _state["served"]}


@app.post("/simulate")
def simulate_route(body: SimulateRequest, settings: Settings = Depends(require_bearer)):
    agent_years = body.params.n_agents * body.params.sim_dur_years
    if agent_years > settings.max_agent_years:
        return _error(
            422, "too_large",
            detail=(f"n_agents × sim_dur_years = {agent_years:,.0f} exceeds the cap of "
                    f"{settings.max_agent_years:,.0f} agent-years; reduce n_agents or sim_dur_years"),
            agent_years=agent_years, cap=settings.max_agent_years,
        )
    cold_start = not _state["served"]
    started = time.perf_counter()
    outcome = simulate(body.params, body.context_text, settings)
    _state["served"] = True
    duration_ms = int((time.perf_counter() - started) * 1000)

    if not outcome.ok:
        if outcome.timed_out:
            return _error(504, "timeout", seconds=settings.timeout_seconds,
                          repairs=outcome.repairs, attempts=outcome.attempts)
        return _error(500, "execution_failed", detail=outcome.error or "unknown execution error",
                      repairs=outcome.repairs, attempts=outcome.attempts)

    stats, series = scaled_outcome(outcome.stats, outcome.series, body.pop_scale)
    return {
        "ok": True,
        "effective_params": outcome.effective_params.model_dump(),
        "population": int(round(outcome.effective_params.n_agents * body.pop_scale)),
        "stats": stats,
        "stats_agents": outcome.stats,
        "series": thin(series, settings.series_max_points),
        "pop_scale": body.pop_scale,
        "repairs": outcome.repairs,
        "attempts": outcome.attempts,
        "duration_ms": duration_ms,
        "cold_start": cold_start,
        "starsim_version": starsim.__version__,
    }


@app.get("/demographics/{iso3}")
def demographics(iso3: str, settings: Settings = Depends(require_bearer)):
    code = iso3.strip().upper()
    try:
        demo = get_demographics_for_sim(code)
    except ValueError:
        return _error(404, "not_found")
    return {"ok": True, "iso3": code, "birth_rate": demo["birth_rate"],
            "death_rate": demo["death_rate"], "source": demo["source"]}
```

Note on `_validation_error`: pydantic's error objects can carry non-serializable `ctx` values, which is why only `loc`, `msg`, `type` are copied.

- [ ] **Step 4: Run the API tests**

Run: `sim/.venv/Scripts/python.exe -m pytest sim/tests/test_api.py -v`
Expected: 11 passed. If `test_demographics_from_the_csv_with_cache_redirected` fails on the value ranges, print the body and adjust nothing in code: the CSV values for Kenya 2022 are about 27 births and 7 deaths per 1,000; the ranges are deliberately wide.

- [ ] **Step 5: Write the real-run tests**

```python
# sim/tests/test_real_run.py
"""One real Starsim run per model family through the app. Slow (about 3 s
each: the child imports Starsim) but the only proof that the template's json
branch, the runner, and the response assembly agree."""
import importlib

import pytest
from fastapi.testclient import TestClient

AUTH = {"Authorization": "Bearer test"}
THIRTY_DAYS = 30 / 365


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SIM_SHARED_SECRET", "test")
    import main as module
    importlib.reload(module)
    return TestClient(module.app)


def _params(**over) -> dict:
    base = {"disease_type": "sir", "beta": 0.05, "n_agents": 1000, "sim_dur_years": THIRTY_DAYS, "rand_seed": 1}
    base.update(over)
    return base


@pytest.mark.parametrize("params, expected_extra", [
    (_params(), set()),
    (_params(disease_type="seir", dur_exp=3.0), {"n_exposed"}),
    (_params(disease_type="seiar", dur_exp=3.0), {"n_exposed", "n_asymptomatic"}),
])
def test_real_run_returns_consistent_stats_and_series(client, params, expected_extra):
    r = client.post("/simulate", json={"params": params, "pop_scale": 1}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    series = body["series"]
    base_keys = {"day", "n_susceptible", "n_infected", "n_recovered", "new_infections", "cum_infections",
                 "new_deaths", "cum_deaths"}
    assert set(series) == base_keys | expected_extra
    lengths = {len(v) for v in series.values()}
    assert lengths == {31}
    assert series["day"][0] == 0 and series["day"][-1] == 30
    assert body["stats"]["sim_days"] == 31
    assert body["stats_agents"]["total_infected"] == round(series["cum_infections"][-1])
    assert body["stats"] == body["stats_agents"]
    assert body["repairs"] == [] and body["attempts"] == 1
    assert body["effective_params"]["rand_seed"] == 1
    assert body["duration_ms"] > 0


def test_pop_scale_scales_stats_but_not_agent_counts(client):
    r = client.post("/simulate", json={"params": _params(), "pop_scale": 100}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["population"] == 100000
    assert body["stats"]["total_infected"] == body["stats_agents"]["total_infected"] * 100
    assert body["stats"]["peak_day"] == body["stats_agents"]["peak_day"]
    assert body["series"]["cum_infections"][-1] == body["stats"]["total_infected"]


def test_same_seed_is_deterministic(client):
    a = client.post("/simulate", json={"params": _params()}, headers=AUTH).json()
    b = client.post("/simulate", json={"params": _params()}, headers=AUTH).json()
    assert a["stats_agents"] == b["stats_agents"]
```

- [ ] **Step 6: Run the real-run tests**

Run: `sim/.venv/Scripts/python.exe -m pytest sim/tests/test_real_run.py -v`
Expected: 5 passed in roughly 15 to 25 seconds.

- [ ] **Step 7: Run the whole sim suite, then start the service by hand once**

Run: `sim/.venv/Scripts/python.exe -m pytest sim/tests -q`
Expected: all green.

Run (in `sim/`, Git Bash):

```bash
cd sim && SIM_SHARED_SECRET=devsecret ../sim/.venv/Scripts/python.exe -m uvicorn main:app --port 8000 > ../.superpowers/uvicorn.log 2>&1 &
sleep 4; curl -s localhost:8000/health; echo
curl -s -X POST localhost:8000/simulate -H "Authorization: Bearer devsecret" -H "Content-Type: application/json" \
  -d '{"params":{"disease_type":"sir","beta":0.05,"n_agents":10000,"sim_dur_years":1,"rand_seed":1},"pop_scale":1}' | head -c 400; echo
kill %1
```

Expected: health JSON with `cold_start: true`; a 200 body starting `{"ok":true,"effective_params":...`. (If `&` and `kill %1` are refused by the harness, run uvicorn in a background Bash task and stop it with the task tool instead.)

- [ ] **Step 8: Commit**

```bash
git add sim/main.py sim/tests/test_api.py sim/tests/test_real_run.py
git commit -m "feat(sim): FastAPI app with auth, simulate, demographics, and health routes"
```

---

### Task 9: Web health route proves the binding

**Files:**
- Create: `web/lib/sim/health.ts`, `web/tests/lib/simHealth.test.ts`
- Modify: `web/app/api/health/route.ts`, `web/tests/api/health.test.ts`

**Interfaces:**
- Consumes: `loadSettings().simInternalUrl`, `loadSettings().simSharedSecret` (exist in `web/lib/config.ts`).
- Produces:
  ```ts
  export type SimHealth = { ok: true; starsim_version: string; cold_start: boolean } | { ok: false; error: string };
  export type SimProbeRun = { n_agents: number; status: number; duration_ms: number | null; cold_start: boolean | null; attempts: number | null; error?: string };
  export function parseProbeRun(raw: string | null): number | null;           // integer 10..200000 else null
  export async function simHealth(baseUrl: string, fetchImpl?: typeof fetch): Promise<SimHealth>;
  export async function simProbeRun(baseUrl: string, secret: string, nAgents: number, fetchImpl?: typeof fetch): Promise<SimProbeRun>;
  ```
  Health response with the cron bearer: `{ ok: true, participants: number, sim: SimHealth | null, sim_run?: SimProbeRun }`.

- [ ] **Step 1: Write the failing unit tests for the sim client**

```ts
// web/tests/lib/simHealth.test.ts
import { describe, expect, it, vi } from "vitest";

import { parseProbeRun, simHealth, simProbeRun } from "@/lib/sim/health";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function fetchReturning(status: number, body: unknown) {
  return vi.fn<FetchLike>(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

function fetchThrowing(message: string) {
  return vi.fn<FetchLike>(async () => { throw new Error(message); });
}

describe("parseProbeRun", () => {
  it("accepts integers from 10 to 200000 and rejects everything else", () => {
    expect(parseProbeRun("10000")).toBe(10000);
    expect(parseProbeRun("10")).toBe(10);
    expect(parseProbeRun("200000")).toBe(200000);
    for (const bad of [null, "", "9", "200001", "1e4", "12.5", "abc", "-5"]) expect(parseProbeRun(bad)).toBeNull();
  });
});

describe("simHealth", () => {
  it("returns the service's health fields", async () => {
    const fetchImpl = fetchReturning(200, { ok: true, starsim_version: "3.3.2", python_version: "3.12.1", cold_start: true });
    expect(await simHealth("http://sim.internal", fetchImpl as unknown as typeof fetch)).toEqual({
      ok: true, starsim_version: "3.3.2", cold_start: true,
    });
    expect(fetchImpl.mock.calls[0][0]).toBe("http://sim.internal/health");
  });

  it("reports a non-200 or a thrown fetch as not ok", async () => {
    expect(await simHealth("http://sim.internal", fetchReturning(503, {}) as unknown as typeof fetch)).toEqual({ ok: false, error: "HTTP 503" });
    const failing = fetchThrowing("ECONNREFUSED");
    expect(await simHealth("http://sim.internal", failing as unknown as typeof fetch)).toEqual({ ok: false, error: "ECONNREFUSED" });
  });
});

describe("simProbeRun", () => {
  it("posts a one-year SIR with the secret and reports the timing", async () => {
    const fetchImpl = fetchReturning(200, { ok: true, duration_ms: 4200, cold_start: true, attempts: 1 });
    const result = await simProbeRun("http://sim.internal", "s3", 10000, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ n_agents: 10000, status: 200, duration_ms: 4200, cold_start: true, attempts: 1 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://sim.internal/simulate");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer s3");
    expect(JSON.parse(init?.body as string)).toEqual({
      params: { disease_type: "sir", beta: 0.05, n_agents: 10000, sim_dur_years: 1, rand_seed: 1 },
      pop_scale: 1, context_text: "health probe",
    });
  });

  it("keeps a failed run as data", async () => {
    const fetchImpl = fetchReturning(422, { ok: false, error: { kind: "too_large" } });
    expect(await simProbeRun("http://sim.internal", "s3", 10, fetchImpl as unknown as typeof fetch)).toEqual({
      n_agents: 10, status: 422, duration_ms: null, cold_start: null, attempts: null, error: "too_large",
    });
    const failing = fetchThrowing("timeout");
    expect(await simProbeRun("http://sim.internal", "s3", 10, failing as unknown as typeof fetch)).toEqual({
      n_agents: 10, status: 0, duration_ms: null, cold_start: null, attempts: null, error: "timeout",
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix web test -- tests/lib/simHealth.test.ts`
Expected: FAIL, cannot resolve `@/lib/sim/health`.

- [ ] **Step 3: Implement the client**

```ts
// web/lib/sim/health.ts
/**
 * The web app's only knowledge of the simulation service until sub-project 3:
 * its health route, and a fixed probe run used to measure timings through the
 * real binding. Both treat every failure as data; the health route must never
 * fail because the sim did.
 */
export type SimHealth =
  | { ok: true; starsim_version: string; cold_start: boolean }
  | { ok: false; error: string };

export type SimProbeRun = {
  n_agents: number;
  status: number;
  duration_ms: number | null;
  cold_start: boolean | null;
  attempts: number | null;
  error?: string;
};

const HEALTH_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 280_000;

export function parseProbeRun(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 10 && n <= 200_000 ? n : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function simHealth(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<SimHealth> {
  try {
    const response = await fetchImpl(`${baseUrl}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const body = (await response.json()) as { starsim_version: string; cold_start: boolean };
    return { ok: true, starsim_version: body.starsim_version, cold_start: body.cold_start };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function simProbeRun(
  baseUrl: string,
  secret: string,
  nAgents: number,
  fetchImpl: typeof fetch = fetch,
): Promise<SimProbeRun> {
  const empty = { n_agents: nAgents, duration_ms: null, cold_start: null, attempts: null };
  try {
    const response = await fetchImpl(`${baseUrl}/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({
        params: { disease_type: "sir", beta: 0.05, n_agents: nAgents, sim_dur_years: 1, rand_seed: 1 },
        pop_scale: 1,
        context_text: "health probe",
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = (await response.json()) as {
      ok: boolean; duration_ms?: number; cold_start?: boolean; attempts?: number; error?: { kind?: string };
    };
    if (!response.ok || !body.ok) {
      return { ...empty, status: response.status, error: body.error?.kind ?? `HTTP ${response.status}` };
    }
    return {
      n_agents: nAgents, status: response.status,
      duration_ms: body.duration_ms ?? null, cold_start: body.cold_start ?? null, attempts: body.attempts ?? null,
    };
  } catch (error) {
    return { ...empty, status: 0, error: message(error) };
  }
}
```

- [ ] **Step 4: Run the client tests**

Run: `npm --prefix web test -- tests/lib/simHealth.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Write the failing route tests**

Replace `web/tests/api/health.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));
vi.mock("@/lib/sim/health", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sim/health")>();
  return { ...actual, simHealth: vi.fn(), simProbeRun: vi.fn() };
});

import { GET } from "@/app/api/health/route";
import { simHealth, simProbeRun } from "@/lib/sim/health";
import { adminClient } from "@/lib/supabase/admin";
import { fakeAdmin } from "../helpers/fakeAdmin";

function get(headers: Record<string, string> = {}, query = "") {
  return GET(new Request(`http://localhost/api/health${query}`, { headers }));
}

const ENV = ["CRON_SECRET", "SIM_INTERNAL_URL", "SIM_SHARED_SECRET"] as const;

describe("GET /api/health", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.mocked(adminClient).mockReset();
    vi.mocked(simHealth).mockReset();
    vi.mocked(simProbeRun).mockReset();
    for (const key of ENV) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  // One queued outcome is consumed per request; a test may make several.
  function healthyDb(count = 12) {
    const { client, recorded } = fakeAdmin({ profiles: Array.from({ length: 8 }, () => ({ count, error: null })) });
    vi.mocked(adminClient).mockReturnValue(client);
    return recorded;
  }

  it("with the cron secret set, admits only the bearer Vercel sends and then reports the participant count", async () => {
    process.env.CRON_SECRET = "s3cret";
    const recorded = healthyDb();
    expect((await get()).status).toBe(401);
    expect((await get({ authorization: "Bearer wrong" })).status).toBe(401);
    expect(recorded).toEqual([]);
    const response = await get({ authorization: "Bearer s3cret" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, participants: 12, sim: null });
    expect(recorded[0].calls[0]).toEqual(["select", ["user_id", { count: "exact", head: true }]]);
    expect(simHealth).not.toHaveBeenCalled();
  });

  it("without a cron secret, still pings the database but tells nobody the count", async () => {
    healthyDb();
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("returns 500 when the database cannot be reached", async () => {
    const { client } = fakeAdmin({ profiles: [{ count: null, error: { message: "paused" } }] });
    vi.mocked(adminClient).mockReturnValue(client);
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false });
  });

  it("reports the sim's health through the binding when the URL is set", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.SIM_INTERNAL_URL = "http://sim.internal";
    healthyDb(3);
    vi.mocked(simHealth).mockResolvedValue({ ok: true, starsim_version: "3.3.2", cold_start: true });
    const response = await get({ authorization: "Bearer s3cret" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true, participants: 3, sim: { ok: true, starsim_version: "3.3.2", cold_start: true },
    });
    expect(simHealth).toHaveBeenCalledWith("http://sim.internal");
  });

  it("keeps the route healthy when the sim is not", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.SIM_INTERNAL_URL = "http://sim.internal";
    healthyDb();
    vi.mocked(simHealth).mockResolvedValue({ ok: false, error: "ECONNREFUSED" });
    const response = await get({ authorization: "Bearer s3cret" });
    expect(response.status).toBe(200);
    expect((await response.json()).sim).toEqual({ ok: false, error: "ECONNREFUSED" });
  });

  it("runs the measurement probe for the bearer and reports it", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.SIM_INTERNAL_URL = "http://sim.internal";
    process.env.SIM_SHARED_SECRET = "shared";
    healthyDb();
    vi.mocked(simHealth).mockResolvedValue({ ok: true, starsim_version: "3.3.2", cold_start: false });
    vi.mocked(simProbeRun).mockResolvedValue({ n_agents: 10000, status: 200, duration_ms: 4200, cold_start: false, attempts: 1 });
    const response = await get({ authorization: "Bearer s3cret" }, "?run=10000");
    expect(response.status).toBe(200);
    expect((await response.json()).sim_run).toEqual({ n_agents: 10000, status: 200, duration_ms: 4200, cold_start: false, attempts: 1 });
    expect(simProbeRun).toHaveBeenCalledWith("http://sim.internal", "shared", 10000);
  });

  it("reports a failed probe run without failing the route", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.SIM_INTERNAL_URL = "http://sim.internal";
    process.env.SIM_SHARED_SECRET = "shared";
    healthyDb();
    vi.mocked(simHealth).mockResolvedValue({ ok: true, starsim_version: "3.3.2", cold_start: false });
    vi.mocked(simProbeRun).mockResolvedValue({ n_agents: 10, status: 422, duration_ms: null, cold_start: null, attempts: null, error: "too_large" });
    const response = await get({ authorization: "Bearer s3cret" }, "?run=10");
    expect(response.status).toBe(200);
    expect((await response.json()).sim_run.error).toBe("too_large");
  });

  it("ignores the probe without the bearer, without a sim URL, or with an out-of-range value", async () => {
    healthyDb();
    expect(await (await get({}, "?run=10000")).json()).toEqual({ ok: true });
    process.env.CRON_SECRET = "s3cret";
    expect(await (await get({ authorization: "Bearer s3cret" }, "?run=10000")).json()).toEqual({ ok: true, participants: 12, sim: null });
    process.env.SIM_INTERNAL_URL = "http://sim.internal";
    process.env.SIM_SHARED_SECRET = "shared";
    vi.mocked(simHealth).mockResolvedValue({ ok: true, starsim_version: "3.3.2", cold_start: false });
    const body = await (await get({ authorization: "Bearer s3cret" }, "?run=999999")).json();
    expect(body.sim_run).toBeUndefined();
    expect(simProbeRun).not.toHaveBeenCalled();
    expect((await get({}, "?run=10000")).status).toBe(401);
  });
});
```

- [ ] **Step 6: Run them to verify the new ones fail**

Run: `npm --prefix web test -- tests/api/health.test.ts`
Expected: the first three pass except the first, which now expects `sim: null` and FAILS; the sim and probe tests FAIL.

- [ ] **Step 7: Extend the route**

Replace `web/app/api/health/route.ts` with:

```ts
import { loadSettings } from "@/lib/config";
import { parseProbeRun, simHealth, simProbeRun } from "@/lib/sim/health";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Called once a day by Vercel so the free database never sits idle long
 * enough to pause. With CRON_SECRET set, only Vercel's bearer gets in and
 * the enrollment count is reported, along with the simulation service's
 * health through the service binding; without it the route still pings the
 * database but tells nobody anything.
 *
 * `?run=<n_agents>` (bearer only) also runs a one-year SIR on the sim and
 * reports its timing. It exists to measure the service through the real
 * binding; the cron never sends it.
 */
export async function GET(request: Request): Promise<Response> {
  const { cronSecret, simInternalUrl, simSharedSecret } = loadSettings();
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response(null, { status: 401 });
  }
  const { count, error } = await adminClient().from("profiles").select("user_id", { count: "exact", head: true });
  if (error) return Response.json({ ok: false }, { status: 500 });
  if (!cronSecret) return Response.json({ ok: true });

  const sim = simInternalUrl ? await simHealth(simInternalUrl) : null;
  const probe = parseProbeRun(new URL(request.url).searchParams.get("run"));
  const sim_run = probe !== null && simInternalUrl ? await simProbeRun(simInternalUrl, simSharedSecret, probe) : undefined;
  return Response.json({ ok: true, participants: count ?? 0, sim, ...(sim_run ? { sim_run } : {}) });
}
```

- [ ] **Step 8: Run the web suite, typecheck, and lint**

Run: `npm --prefix web test && npm --prefix web run typecheck && npm --prefix web run lint`
Expected: all tests pass (87 before, plus 6 client and 5 more route tests), no type or lint errors.

- [ ] **Step 9: Commit**

```bash
git add web/lib/sim/health.ts web/tests/lib/simHealth.test.ts web/app/api/health/route.ts web/tests/api/health.test.ts
git commit -m "feat(web): health route reports the sim through the binding and can run a timing probe"
```

---

### Task 10: Deployment configuration and runbook

**Files:**
- Modify: `vercel.json`, `.vercelignore`, `.gitignore`, `.github/workflows/tests.yml`, `web/.env.example`, `web/docs/DEPLOY.md`
- Create: `sim/Dockerfile`

**Interfaces:**
- Consumes: `sim/main.py` (`main:app`), `sim/requirements.txt`, the health route's `sim` field.
- Produces: a two-service deployment with the binding `SIM_INTERNAL_URL`; a `sim` CI job; the runbook section the owner follows in Task 11.

- [ ] **Step 1: Replace `vercel.json`**

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
      "buildCommand": "rm -rf epichat templates && cp -r ../epichat ../templates . && find epichat -name __pycache__ -type d -prune -exec rm -rf {} +",
      "functions": {
        "main.py": {
          "maxDuration": 300,
          "excludeFiles": "{tests/**,epichat/data/demographics/cache/**,**/__pycache__/**,.venv/**}"
        }
      }
    }
  },
  "rewrites": [{ "source": "/(.*)", "destination": { "service": "web" } }],
  "crons": [{ "path": "/api/health", "schedule": "0 9 * * *" }]
}
```

Check: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('valid')"` prints `valid`.

- [ ] **Step 2: Replace `.vercelignore`**

```
# Nothing here is needed to build or run the web or sim services.
# epichat/ and templates/ ARE needed: the sim build copies them in.
/.claude
/.superpowers
/.pytest_cache
/.streamlit
/__pycache__
/docs
/evals
/results
/tests
/scripts
/assets
/talks
/EpiChat website
/web/tests
/sim/tests
/sim/.venv
/sim/epichat
/sim/templates
*.pdf
*.mp4
*.log
app.py
cli.py

.env
.env.*
!.env.example
```

- [ ] **Step 3: Extend `.gitignore`**

Append:

```
# sim service: build-time copies and the local virtualenv
sim/epichat/
sim/templates/
```

(`sim/.venv/` was added in Task 5.) Check: `git check-ignore -q sim/epichat/x && git check-ignore -q sim/.venv/x && echo ignored`.

- [ ] **Step 4: Add the CI job**

Append to `.github/workflows/tests.yml` under `jobs:`:

```yaml
  sim:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
          cache-dependency-path: sim/requirements.txt
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r sim/requirements.txt pytest
      - name: Run tests
        run: pytest sim/tests -q
        env:
          SIM_SHARED_SECRET: test
          ANTHROPIC_API_KEY: test-key-never-used
```

Check: `py -3.10 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/tests.yml')); print(sorted(d['jobs']))"` prints `['pytest', 'sim', 'web']` (PyYAML is in `evals/requirements.txt`; if it is missing locally, `py -3.10 -m pip install pyyaml`).

- [ ] **Step 5: Write the Dockerfile**

```dockerfile
# sim/Dockerfile — the exit route. Not used on Vercel; see web/docs/DEPLOY.md
# section 7 for when and how. Build from the repository root:
#   docker build -f sim/Dockerfile -t epichat-sim .
#   docker run -p 8000:8000 -e SIM_SHARED_SECRET=... -e ANTHROPIC_API_KEY=... epichat-sim
FROM python:3.12-slim
WORKDIR /app
COPY sim/requirements.txt sim/requirements.txt
RUN pip install --no-cache-dir -r sim/requirements.txt
COPY epichat epichat
COPY templates templates
COPY sim sim
WORKDIR /app/sim
ENV PORT=8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
```

- [ ] **Step 6: Update `web/.env.example`**

Replace the two sim lines with:

```
# Simulation service (sub-project 2). On Vercel SIM_INTERNAL_URL is set by the
# service binding; locally point it at `uvicorn main:app --port 8000` in sim/.
# SIM_SHARED_SECRET must be the same value in both services (the Vercel
# project's variables reach both).
SIM_INTERNAL_URL=http://localhost:8000
SIM_SHARED_SECRET=
```

- [ ] **Step 7: Add section 7 to `web/docs/DEPLOY.md`** (after section 6, before any trailing text)

```markdown
## 7. Simulation service (`sim/`)

The second Vercel service. Private: no rewrite reaches it; the web app calls
it through the binding (`SIM_INTERNAL_URL`) with `SIM_SHARED_SECRET`.

**Environment.** Add `SIM_SHARED_SECRET` (any long random string) to the
Vercel project for Production and Preview; the same project variables reach
both services. `ANTHROPIC_API_KEY` is already set and is used only when a
run fails and the parameters are repaired. Locally, export both in the
shell that runs the service and put `SIM_INTERNAL_URL=http://localhost:8000`
plus the secret in `web/.env.local`.

**Local run.** Two processes:

    cd sim && ../sim/.venv/Scripts/python.exe -m uvicorn main:app --port 8000
    cd web && npm run dev

`sim/.venv` is a Python 3.12 virtualenv: `py -3.12 -m venv sim/.venv` then
`sim/.venv/Scripts/python.exe -m pip install -r sim/requirements.txt pytest`.
`npx vercel dev` from the root runs both with the binding injected.

**Tests.** `sim/.venv/Scripts/python.exe -m pytest sim/tests -q` (about 30 s;
three real Starsim runs). CI runs them on Python 3.12 as the `sim` job.

**Settings** (all optional except the secret): `SIM_TIMEOUT_SECONDS` 120,
`SIM_MAX_REPAIRS` 2, `SIM_REPAIR_MODEL` claude-opus-5-5,
`SIM_MAX_AGENT_YEARS` 500000, `SIM_SERIES_MAX_POINTS` 2000.

**First two-service deploy, verification.**

1. `npx vercel deploy` from the root. Both services build. If the sim build
   fails because `../epichat` is not visible, change the sim service in
   `vercel.json` to `"root": "."` with `"entrypoint": "sim/main:app"`, drop
   the `buildCommand`, and add `web/**` and the Streamlit folders to its
   `excludeFiles`; record the switch here.
2. Public probe: `curl -s -o /dev/null -w "%{http_code}\n" https://epichat-ai.vercel.app/health`
   and the same for `/simulate` print `404` (the web app answers, never the
   sim).
3. `curl -s -H "Authorization: Bearer $CRON_SECRET" https://epichat-ai.vercel.app/api/health`
   returns `"sim":{"ok":true,"starsim_version":"3.3.2",...}`.
4. Timing through the binding, bearer only:
   `.../api/health?run=10000` twice (the first is the cold start), then
   `.../api/health?run=100000` once. Each answer carries `sim_run.duration_ms`
   and `sim_run.cold_start`.
5. Fill in the table below from step 4 and from the Usage page's Active CPU
   reading before and after.

| Measured on Vercel | Value |
|---|---|
| Cold start, 10k agents, 1 year | (fill in) |
| Warm, 10k agents, 1 year | (fill in) |
| Warm, 100k agents, 1 year | (fill in) |
| Active CPU used by the three runs | (fill in) |

Local baseline (Python 3.12, one core, 2026-10-08): import 2 s; 10k agents
1.5 s CPU; 100k agents 11 s; 100k agents for 5 years 60 s; peak memory 332 MB.

**Hobby watch rule.** The project runs on Vercel Hobby, which includes 4
Active CPU hours a month and pauses the whole project for the rest of the
30-day window when exceeded. During the study check Usage > Active CPU
weekly. If it passes 2 hours before mid-month, or a participant reports the
app paused, upgrade the team to Pro ($20 a month; usage at this scale is a
dollar or two and covered by the plan's credit). Nothing in the code changes.

**Moving the service elsewhere.** `sim/Dockerfile` builds the same service as
a container (`docker build -f sim/Dockerfile -t epichat-sim .`). Run it on
Render, Cloud Run, or a VM, set `SIM_INTERNAL_URL` to its address and
`SIM_SHARED_SECRET` to the same secret on both sides, and remove the `sim`
service and the binding from `vercel.json`. The web app does not change.
```

Also change the sentence in section 1 of the runbook, "Sub-project 2 adds the `sim` service beside it." stays true; and in section 4 step 4 add: "The daily cron response now also reports the sim's health."

- [ ] **Step 8: Local two-process smoke through the real health route**

In one background task: `cd sim && SIM_SHARED_SECRET=devsecret ../sim/.venv/Scripts/python.exe -m uvicorn main:app --port 8000`. In another: `cd web && npm run dev -- -p 3000` with `SIM_INTERNAL_URL=http://localhost:8000` and `SIM_SHARED_SECRET=devsecret` present in `web/.env.local` for the duration (add the two lines, remove them afterwards if you do not want them kept). Then:

```bash
CS=$(grep '^CRON_SECRET=' web/.env.local | cut -d= -f2- | tr -d '\r')
curl -s -H "Authorization: Bearer $CS" "http://localhost:3000/api/health?run=10000"
```

Expected: `{"ok":true,"participants":N,"sim":{"ok":true,"starsim_version":"3.3.2","cold_start":true},"sim_run":{"n_agents":10000,"status":200,"duration_ms":<about 4000>,"cold_start":true,"attempts":1}}`. Stop both tasks.

- [ ] **Step 9: Run every suite once more and commit**

Run: `py -3.10 -m pytest tests -q && sim/.venv/Scripts/python.exe -m pytest sim/tests -q && npm --prefix web test`
Expected: all green.

```bash
git add vercel.json .vercelignore .gitignore .github/workflows/tests.yml sim/Dockerfile web/.env.example web/docs/DEPLOY.md
git commit -m "chore(deploy): two-service Vercel config with the sim binding, CI job, Dockerfile, runbook"
```

---

### Task 11: Owner's first two-service deploy

**Files:** `web/docs/DEPLOY.md` section 7 (fill the table), possibly `vercel.json` (fallback).

Not implementable by an agent alone: it needs the Vercel dashboard for the secret and the owner's judgment on the fallback. Done together in the session after Task 10 is merged:

- [ ] **Step 1:** `printf '%s' "<long random>" | npx vercel env add SIM_SHARED_SECRET production,preview --sensitive --yes` from the repository root. Put the same value in `web/.env.local`.
- [ ] **Step 2:** `npx vercel deploy --yes` from the root; read the build log for both services. On a sim build failure about `../epichat`, apply the fallback in runbook step 1 and redeploy.
- [ ] **Step 3:** Run runbook steps 2 to 4 against the preview address (preview addresses are behind Vercel Authentication, so run them against production after `npx vercel deploy --prod`, or open the preview in a signed-in browser and use the health route from there).
- [ ] **Step 4:** Fill the runbook's table; commit `docs: record the first two-service deploy and its timings`.
- [ ] **Step 5:** `git push origin main` (triggers CI with the new `sim` job and a production deploy); confirm all three CI jobs pass and the cron's next run reports `sim.ok: true`.

---

## Self-review notes

- **Spec coverage.** Section 3 contract: Task 8 (routes, bodies, both 422s, 500, 504, health, demographics) and Task 9 (web `sim` and `sim_run`). Section 4 settings: Task 5. Section 5 internals: Tasks 5 to 8; 5.6 package changes: Tasks 1 to 4. Section 6 deployment: Task 10; 6.2 secret and 6.5 local recipe: Tasks 10 and 11. Section 7 verification: Task 11 and the runbook. Section 8 error handling: Tasks 6 to 8. Section 9 baseline: runbook text in Task 10. Section 10 tests: each named file maps to a task above; the thin-series and non-UTF-8 cases come from Review Focus.
- **Type consistency.** `RunResult(ok, stats, series, error, timed_out, duration_ms)` positional order is the same in Task 6's dataclass, Task 7's fakes, and Task 8's tests. `Outcome` fields match between Task 7 and Task 8. `repair_params(user_input, params, error_message, model)` matches the `Repairer` callable order. `simProbeRun(baseUrl, secret, nAgents)` matches the route's call.
- **Placeholder scan.** The only "(fill in)" cells are in the runbook's timing table, which Task 11 fills with measured values; they are the deliverable of that task, not a gap in this plan.
