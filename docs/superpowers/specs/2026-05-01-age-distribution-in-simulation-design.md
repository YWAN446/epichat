# Design: Age Distribution in Simulation

**Date:** 2026-05-01  
**Status:** Approved

## Summary

`age_distribution_pct` is already fetched from UN WPP (indicator 71) and shown in the DATA SOURCES block, but the actual percentages never reach the simulation. This design wires them into two mechanistically correct uses: initializing agent ages to match the real-world distribution, and weighting the POLYMOD contact matrix for R0 calculation.

## Approach

Deterministic post-processing in `parse_query()` — not LLM prompt engineering. When `age_distribution_pct` is present in the resolved fields, code directly overrides the returned `SimParams` to set `network_type = "age_structured"` and populate the three age percent fields. The LLM is not involved in this mapping.

## Section 1 — Data model (`SimParams`)

Three new optional float fields added to `SimParams`:

```python
age_pct_under18: Optional[float] = Field(default=None, ge=0.0, le=100.0)
age_pct_18_64:   Optional[float] = Field(default=None, ge=0.0, le=100.0)
age_pct_over65:  Optional[float] = Field(default=None, ge=0.0, le=100.0)
```

All default to `None`. Set only when `age_distribution_pct` is resolved. Flow into templates automatically via the existing `to_template_dict()` → `model_dump()` path.

`approx_r0()` gains a population-weighted NGM branch: when all three fields are set and `network_type == "age_structured"`, weight each column j of the POLYMOD matrix by `pop[j]` before computing the spectral radius:

```python
pop = np.array([age_pct_under18, age_pct_18_64, age_pct_over65]) / 100.0
ngm = beta * network_beta * asymp_factor * (dur_inf / 365.0) * (C * pop[np.newaxis, :])
R0 = spectral_radius(ngm)
```

`asymp_factor` is already computed earlier in `approx_r0()` for SEIAR models (= 1.0 for all others).

## Section 2 — Parser post-processing (`parser.py`)

New private function `_apply_age_distribution(params, resolved)`:
- Searches `resolved` for a `ResolvedField` with `field == "age_distribution_pct"`
- If absent: returns `params` unchanged (no-op for all non-geographic queries)
- If present: returns a new `SimParams` with:
  - `network_type = "age_structured"`
  - `age_pct_under18 = value["0-17"]`
  - `age_pct_18_64 = value["18-64"]`
  - `age_pct_over65 = value["65+"]`

`parse_query()` calls this after `_llm_call_2`:

```python
params = _llm_call_2(user_input, intent.preliminary_params, resolved)
params = _apply_age_distribution(params, resolved)
return params
```

## Section 3 — Template population initialization

All 5 main templates (`sir`, `seir`, `sirs`, `seirs`, `seiar`) are refactored from branching `{% if vaccine %} / {% else %}` run blocks into a single linear sequence:

```
sim = ss.Sim(pars, ...)
sim.init()
[optional: pre-existing vaccine block]
[optional: age initialization block]
sim.run()
```

The age initialization block fires when `age_pct_under18 is not none` and `network_type == 'age_structured'`:

```python
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
```

Uses a separate `_rng_age` generator (seed + 1) to avoid colliding with the vaccine RNG (`_rng`). `sir_vaccine.py.j2` is unchanged — it has no age-structured branch.

## Section 4 — CLI output

Three lines added to the MODEL DETAILS demographics block in `format_cli`, shown only when age fields are set:

```
  Age dist. (0-17):  41.2%
  Age dist. (18-64): 55.6%
  Age dist. (65+):   3.2%
```

## Files Changed

| File | Change |
|------|--------|
| `epichat/schema.py` | Add 3 age_pct fields; update `approx_r0()` |
| `epichat/parser.py` | Add `_apply_age_distribution()`; call it in `parse_query()` |
| `epichat/epichat.py` | Add age dist lines to `format_cli` |
| `templates/sir.py.j2` | Refactor run block; add age init block |
| `templates/seir.py.j2` | Same |
| `templates/sirs.py.j2` | Same |
| `templates/seirs.py.j2` | Same |
| `templates/seiar.py.j2` | Same |

## Out of Scope

- Location-specific contact matrices (would require additional data beyond UN WPP)
- Age-specific susceptibility or mortality rates
- `sir_vaccine.py.j2` (vaccine-specific template with no age-structured branch)
