# Age Distribution in Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire UN WPP age distribution percentages into the simulation — initializing agent ages to match the real population and weighting the POLYMOD contact matrix for correct R0 calculation.

**Architecture:** Three-layer change: (1) `SimParams` grows three optional age-percent fields and a population-weighted `approx_r0()`; (2) `parse_query()` post-processes resolved fields to set those fields deterministically when `age_distribution_pct` is present; (3) each template's run block is refactored into a linear `init → optional-vaccine → optional-age-init → run` sequence.

**Tech Stack:** Python 3.12, Pydantic v2, Jinja2, Starsim 3.x, pytest

---

## File Map

| File | What changes |
|------|-------------|
| `epichat/schema.py` | Add `age_pct_under18`, `age_pct_18_64`, `age_pct_over65` fields; population-weighted branch in `approx_r0()` |
| `epichat/parser.py` | Add `_apply_age_distribution()`; call it at end of `parse_query()` |
| `epichat/epichat.py` | Three age-dist lines in the demographics block of `format_cli` |
| `templates/sir.py.j2` | Refactor run block; add age-init block |
| `templates/seir.py.j2` | Same |
| `templates/sirs.py.j2` | Same |
| `templates/seirs.py.j2` | Same |
| `templates/seiar.py.j2` | Same |
| `tests/test_schema.py` | New file — tests for age_pct fields and weighted `approx_r0()` |
| `tests/test_parser_unit.py` | Add tests for `_apply_age_distribution()` and updated `parse_query()` |
| `tests/test_epichat_unit.py` | Add test for age-dist lines in `format_cli` |

---

## Task 1: `SimParams` — age_pct fields and weighted `approx_r0()`

**Files:**
- Modify: `epichat/schema.py`
- Create: `tests/test_schema.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_schema.py`:

```python
import pytest
from epichat.schema import SimParams


def test_age_pct_fields_default_to_none():
    p = SimParams(beta=10.0)
    assert p.age_pct_under18 is None
    assert p.age_pct_18_64 is None
    assert p.age_pct_over65 is None


def test_age_pct_fields_accept_valid_values():
    p = SimParams(beta=10.0, age_pct_under18=40.0, age_pct_18_64=57.0, age_pct_over65=3.0)
    assert p.age_pct_under18 == 40.0
    assert p.age_pct_18_64 == 57.0
    assert p.age_pct_over65 == 3.0


def test_approx_r0_age_structured_without_age_pcts_unchanged():
    """Existing behaviour: no age_pct fields → POLYMOD matrix with no column weighting."""
    p = SimParams(beta=100.0, network_type="age_structured", network_beta=1.0, dur_inf=10.0)
    r0 = p.approx_r0()
    assert r0 > 0


def test_approx_r0_age_structured_with_age_pcts_differs_from_uniform():
    """When all age_pcts are set, R0 should reflect population-weighted NGM."""
    uniform = SimParams(beta=100.0, network_type="age_structured", network_beta=1.0, dur_inf=10.0)
    # Kenya-like: very young population, almost no elderly
    weighted = SimParams(
        beta=100.0, network_type="age_structured", network_beta=1.0, dur_inf=10.0,
        age_pct_under18=42.0, age_pct_18_64=55.0, age_pct_over65=3.0,
    )
    assert abs(uniform.approx_r0() - weighted.approx_r0()) > 0.5


def test_approx_r0_age_structured_partial_age_pcts_uses_uniform():
    """If only some age_pct fields are set, fall back to uniform weighting (not a crash)."""
    p = SimParams(beta=100.0, network_type="age_structured", age_pct_under18=40.0)
    # Should not raise; uniform branch activates
    r0 = p.approx_r0()
    assert r0 > 0
```

- [ ] **Step 2: Run tests to confirm they fail**

```
cd C:/Users/Yuke/stat/other-projects/EpiChat/epichat
python -m pytest tests/test_schema.py -v
```

Expected: `ImportError` or `AttributeError` — `age_pct_under18` doesn't exist yet.

- [ ] **Step 3: Add the three fields to `SimParams`**

In `epichat/schema.py`, add after the `death_rate` line:

```python
    age_pct_under18: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    age_pct_18_64:   Optional[float] = Field(default=None, ge=0.0, le=100.0)
    age_pct_over65:  Optional[float] = Field(default=None, ge=0.0, le=100.0)
```

- [ ] **Step 4: Update `approx_r0()` with population-weighted branch**

Replace the existing `if self.network_type == "age_structured":` block in `approx_r0()`:

```python
    def approx_r0(self) -> float:
        asymp_factor = 1.0
        if self.disease_type == "seiar":
            asymp_factor = 1 - self.p_asymp * (1 - self.rel_trans_asymp)

        if self.network_type == "age_structured":
            import numpy as np
            C = np.array([[7.0, 2.5, 0.5],
                          [2.5, 9.0, 1.5],
                          [0.5, 1.5, 3.5]])
            if all(x is not None for x in [self.age_pct_under18, self.age_pct_18_64, self.age_pct_over65]):
                pop = np.array([self.age_pct_under18, self.age_pct_18_64, self.age_pct_over65]) / 100.0
                ngm = self.beta * self.network_beta * asymp_factor * (self.dur_inf / 365.0) * (C * pop[np.newaxis, :])
            else:
                ngm = self.beta * self.network_beta * asymp_factor * (self.dur_inf / 365.0) * C
            return float(np.linalg.eigvals(ngm).real.max())
        return self.beta * self.network_beta * asymp_factor * (self.dur_inf / 365.0) * self.n_contacts
```

- [ ] **Step 5: Run tests — expect all pass**

```
python -m pytest tests/test_schema.py -v
```

Expected: 5 passed.

- [ ] **Step 6: Run full suite to check for regressions**

```
python -m pytest tests/ -v
```

Expected: all previously-passing tests still pass.

- [ ] **Step 7: Commit**

```
git -C "C:/Users/Yuke/stat/other-projects/EpiChat/epichat" add epichat/schema.py tests/test_schema.py
git -C "C:/Users/Yuke/stat/other-projects/EpiChat/epichat" commit -m "feat: add age_pct fields to SimParams; population-weighted approx_r0()"
```

---

## Task 2: Parser — `_apply_age_distribution()` and updated `parse_query()`

**Files:**
- Modify: `epichat/parser.py`
- Modify: `tests/test_parser_unit.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_parser_unit.py`:

```python
from epichat.parser import _apply_age_distribution


def test_apply_age_distribution_no_op_when_absent():
    params = SimParams(beta=22.8125)
    resolved = [ResolvedField(field="birth_rate", value=28.5, citation="x")]
    result = _apply_age_distribution(params, resolved)
    assert result is params  # exact same object — untouched


def test_apply_age_distribution_sets_fields_and_network_type():
    params = SimParams(beta=22.8125)
    resolved = [
        ResolvedField(
            field="age_distribution_pct",
            value={"0-17": 42.1, "18-64": 54.8, "65+": 3.1},
            citation="UN WPP 2024, Kenya (KEN), 2023",
        )
    ]
    result = _apply_age_distribution(params, resolved)
    assert result.network_type == "age_structured"
    assert abs(result.age_pct_under18 - 42.1) < 0.01
    assert abs(result.age_pct_18_64   - 54.8) < 0.01
    assert abs(result.age_pct_over65  -  3.1) < 0.01


def test_apply_age_distribution_returns_new_simparams_object():
    params = SimParams(beta=22.8125, network_type="random")
    resolved = [
        ResolvedField(
            field="age_distribution_pct",
            value={"0-17": 20.0, "18-64": 70.0, "65+": 10.0},
            citation="x",
        )
    ]
    result = _apply_age_distribution(params, resolved)
    assert result is not params
    assert params.network_type == "random"   # original unchanged


def test_parse_query_applies_age_distribution_end_to_end():
    """parse_query() sets network_type=age_structured when resolver returns age data."""
    mock_resolver = MagicMock()
    mock_resolver.resolve.return_value = [
        ResolvedField(field="birth_rate", value=28.5, citation="x"),
        ResolvedField(
            field="age_distribution_pct",
            value={"0-17": 42.0, "18-64": 55.0, "65+": 3.0},
            citation="y",
        ),
    ]

    lm1_msg = MagicMock()
    lm1_msg.content = [MagicMock(text=_INTENT_WITH_QUERIES)]
    lm2_msg = MagicMock()
    lm2_msg.content = [MagicMock(text=_REFINED_JSON)]
    client = MagicMock()
    client.messages.create.side_effect = [lm1_msg, lm2_msg]

    with patch("epichat.parser._resolver", mock_resolver), \
         patch("epichat.parser.anthropic.Anthropic", return_value=client):
        result = parse_query("simulate measles in Kenya")

    assert result.network_type == "age_structured"
    assert result.age_pct_under18 == 42.0
```

- [ ] **Step 2: Run tests to confirm they fail**

```
python -m pytest tests/test_parser_unit.py::test_apply_age_distribution_no_op_when_absent -v
```

Expected: `ImportError` — `_apply_age_distribution` doesn't exist yet.

- [ ] **Step 3: Add `_apply_age_distribution()` to `parser.py`**

Add after the `_run_resolver` function in `epichat/parser.py`:

```python
def _apply_age_distribution(params: SimParams, resolved: list[ResolvedField]) -> SimParams:
    age_field = next((rf for rf in resolved if rf.field == "age_distribution_pct"), None)
    if age_field is None:
        return params
    pct = age_field.value
    return params.model_copy(update={
        "network_type": "age_structured",
        "age_pct_under18": pct.get("0-17"),
        "age_pct_18_64":   pct.get("18-64"),
        "age_pct_over65":  pct.get("65+"),
    })
```

- [ ] **Step 4: Update `parse_query()` to call it**

Replace the final two lines of `parse_query()` in `epichat/parser.py`:

```python
def parse_query(user_input: str) -> SimParams:
    """
    Translate a natural language epidemiological query into validated SimParams.

    Three-step process:
      1. LLM-1 extracts intent (preliminary params + optional data queries).
      2. If data queries exist, the resolver fetches real-world values.
      3. LLM-2 refines preliminary params using resolved data (skipped when no queries).
      4. Age distribution post-processing: if age_distribution_pct was resolved,
         network_type is set to age_structured and age_pct_* fields are populated.

    Raises:
        ValueError: if the LLM requests clarification or returns invalid JSON/schema.
    """
    global _last_resolved
    _last_resolved = []
    intent = _llm_call_1(user_input)
    resolved = _run_resolver(intent.data_queries)
    _last_resolved = resolved
    params = _llm_call_2(user_input, intent.preliminary_params, resolved)
    return _apply_age_distribution(params, resolved)
```

- [ ] **Step 5: Run new parser tests**

```
python -m pytest tests/test_parser_unit.py -v
```

Expected: all pass.

- [ ] **Step 6: Run full suite**

```
python -m pytest tests/ -v
```

Expected: all pass.

- [ ] **Step 7: Commit**

```
git -C "C:/Users/Yuke/stat/other-projects/EpiChat/epichat" add epichat/parser.py tests/test_parser_unit.py
git -C "C:/Users/Yuke/stat/other-projects/EpiChat/epichat" commit -m "feat: deterministic age distribution post-processing in parse_query()"
```

---

## Task 3: CLI — age distribution lines in `format_cli`

**Files:**
- Modify: `epichat/epichat.py`
- Modify: `tests/test_epichat_unit.py`

- [ ] **Step 1: Write failing test**

Append to `tests/test_epichat_unit.py`:

```python
def test_format_cli_shows_age_distribution_when_set():
    # age_pct fields are set by _apply_age_distribution, independent of use_demographics
    result = _base_result(
        params=SimParams(
            beta=22.8125,
            age_pct_under18=42.1,
            age_pct_18_64=54.8,
            age_pct_over65=3.1,
        )
    )
    output = result.format_cli()
    assert "Age dist. (0-17)" in output
    assert "42.1%" in output
    assert "Age dist. (18-64)" in output
    assert "54.8%" in output
    assert "Age dist. (65+)" in output
    assert "3.1%" in output


def test_format_cli_omits_age_distribution_when_not_set():
    result = _base_result()
    output = result.format_cli()
    assert "Age dist." not in output
```

- [ ] **Step 2: Run tests to confirm they fail**

```
python -m pytest tests/test_epichat_unit.py::test_format_cli_shows_age_distribution_when_set -v
```

Expected: FAIL — "Age dist. (0-17)" not found.

- [ ] **Step 3: Add the three age-dist lines to `format_cli`**

In `epichat/epichat.py`, inside `format_cli`, find the demographics block and add the age-dist block immediately after it as a separate guard (independent of `use_demographics`):

```python
        if p.use_demographics:
            lines.append(f"  Birth rate:       {p.birth_rate:.2f} per 1,000/yr")
            lines.append(f"  Death rate:       {p.death_rate:.2f} per 1,000/yr")
        if p.age_pct_under18 is not None:
            lines.append(f"  Age dist. (0-17):  {p.age_pct_under18:.1f}%")
            lines.append(f"  Age dist. (18-64): {p.age_pct_18_64:.1f}%")
            lines.append(f"  Age dist. (65+):   {p.age_pct_over65:.1f}%")
```

- [ ] **Step 4: Run tests**

```
python -m pytest tests/test_epichat_unit.py -v
```

Expected: all pass.

- [ ] **Step 5: Run full suite**

```
python -m pytest tests/ -v
```

Expected: all pass.

- [ ] **Step 6: Commit**

```
git -C "C:/Users/Yuke/stat/other-projects/EpiChat/epichat" add epichat/epichat.py tests/test_epichat_unit.py
git -C "C:/Users/Yuke/stat/other-projects/EpiChat/epichat" commit -m "feat: show age distribution percentages in CLI output"
```

---

## Task 4: Templates — refactor run block and add age-init block

**Files:**
- Modify: `templates/sir.py.j2`
- Modify: `templates/seir.py.j2`
- Modify: `templates/sirs.py.j2`
- Modify: `templates/seirs.py.j2`
- Modify: `templates/seiar.py.j2`

No unit tests — template rendering is verified by running the CLI. `sir_vaccine.py.j2` is unchanged.

The age-init block assigns agent ages from `sim.people.age`. In Starsim 3.x this is a `FloatArr`; `[:]` slice assignment should work. If it raises `AttributeError`, try `sim.people.age.values[:] = _ages[:_n]` instead.

### 4a — `templates/sir.py.j2`

- [ ] **Step 1: Replace the run block**

Find the block starting with `{% if vaccine and vaccine.start_day <= 0 %}` (pre-existing vaccination branch) through the closing `{% endif %}` and replace the entire section with:

```jinja
sim = ss.Sim(pars, connectors=connectors_list or None, verbose=0)
sim.init()

{% if vaccine and vaccine.start_day <= 0 %}
_d = list(sim.diseases.values())[0]
_sus = _d.susceptible.uids
_n_vax = int({{ vaccine.coverage }} * len(_sus))
{% if rand_seed is not none %}
_rng = np.random.default_rng({{ rand_seed }})
{% else %}
_rng = np.random.default_rng()
{% endif %}
_vax_uids = _rng.choice(_sus, size=_n_vax, replace=False) if _n_vax > 0 else np.array([], dtype=int)
_d.susceptible[_vax_uids] = False
_d.recovered[_vax_uids]   = True
{% endif %}

{% if age_pct_under18 is not none and network_type == 'age_structured' %}
_n = len(sim.people)
_n_c = round({{ age_pct_under18 }} / 100 * _n)
_n_e = round({{ age_pct_over65  }} / 100 * _n)
_n_a = _n - _n_c - _n_e
{% if rand_seed is not none %}
_rng_age = np.random.default_rng({{ rand_seed }} + 1)
{% else %}
_rng_age = np.random.default_rng()
{% endif %}
_ages = np.concatenate([
    _rng_age.uniform(0, 18, _n_c),
    _rng_age.uniform(18, 65, max(0, _n_a)),
    _rng_age.uniform(65, 95, max(0, _n_e)),
])
_rng_age.shuffle(_ages)
sim.people.age[:] = _ages[:_n]
{% endif %}

sim.run()
```

### 4b — `templates/seir.py.j2`

- [ ] **Step 2: Replace the run block**

Same replacement as 4a. The seir template's old block starts at the `{% if vaccine and vaccine.start_day <= 0 %}` line after the `pars = dict(...)` block.

### 4c — `templates/sirs.py.j2`

- [ ] **Step 3: Replace the run block**

Same replacement as 4a.

### 4d — `templates/seirs.py.j2`

- [ ] **Step 4: Replace the run block**

Same replacement as 4a.

### 4e — `templates/seiar.py.j2`

- [ ] **Step 5: Replace the run block**

Same replacement as 4a.

### 4f — Smoke test

- [ ] **Step 6: Run a non-geographic query to verify existing path still works**

```
cd C:/Users/Yuke/stat/other-projects/EpiChat/epichat
python cli.py "Run a default SIR model"
```

Expected: simulation runs, no error, plot saved.

- [ ] **Step 7: Run full test suite**

```
python -m pytest tests/ -v
```

Expected: all pass.

- [ ] **Step 8: Commit**

```
git -C "C:/Users/Yuke/stat/other-projects/EpiChat/epichat" add templates/sir.py.j2 templates/seir.py.j2 templates/sirs.py.j2 templates/seirs.py.j2 templates/seiar.py.j2
git -C "C:/Users/Yuke/stat/other-projects/EpiChat/epichat" commit -m "feat: refactor template run blocks; add age-distribution agent initialization"
```

---

## Task 5: End-to-end validation

- [ ] **Step 1: Run a geographic query that exercises the full pipeline**

```
cd C:/Users/Yuke/stat/other-projects/EpiChat/epichat
python cli.py "Simulate measles in Kenya over 2 years"
```

Expected output includes:
- `DATA SOURCES` block with `age_distribution_pct` citation
- `MODEL DETAILS` showing `Network: age_structured`
- `Age dist. (0-17)`, `Age dist. (18-64)`, `Age dist. (65+)` lines
- A plot saved to `results/`

- [ ] **Step 2: Verify the plot shows all SEIR compartments**

Open the most recent PNG in `results/`. It should be a 2-panel figure: left panel showing S/E/I/R curves, right panel showing cumulative infections and deaths.

- [ ] **Step 3: Run a non-geographic query to confirm no regression**

```
python cli.py "Run a basic SIR model"
```

Expected: no `Age dist.` lines, `Network: random`, simulation completes normally.
