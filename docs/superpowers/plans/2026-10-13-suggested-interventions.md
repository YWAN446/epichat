# Suggested Interventions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a run, the service proposes interventions to try (a `what_if` diagnostic whose levers carry intervention entries and ready-made replies), `well_mixed` stops blaming the random network, and the conversation shows the proposals as buttons under the latest run.

**Architecture:** A diagnostic's `Lever` gains two optional fields, `interventions` (entries for `configure_simulation`'s `interventions` field) and `label` (a complete reply of at most 80 characters). `what_if` builds up to four such levers from named constants, anchored at the day the run's cumulative infections reached 1% of the agents. Because suggestions are levers they travel in `runs.diagnostics` and through the events that exist. The web app matches a taken lever by its entries, shows the latest run's `what_if` labels as "Try next" buttons, and the prompt's "Diagnostics and options" section becomes "After a run".

**Tech Stack:** Python 3.12 (pydantic v2, numpy), FastAPI service unchanged, Next.js + TypeScript + vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-limits-suggestions-parameters-design.md`, sections 7 and 12 (phase B of section 14).

## Global Constraints

- No database migration, no new npm or Python dependency, `npm --prefix web ci` only.
- Starsim stays 3.7.2; `tests/test_sim_parity.py`'s baseline is never re-captured.
- Stored diagnostics without the new fields read as before; a lever without entries and without a label serializes exactly as it did.
- A label is a complete reply of at most 80 characters (`LABEL_MAX`).
- Every effect size is a named constant at the top of `epichat/sim/diagnostics.py`, and every such lever says it is illustrative.
- `what_if` has at most four levers (`WHAT_IF_MAX_LEVERS`); the conversation shows at most three buttons; the limit of three suggested replies stays.
- The buttons are absent on the public share page and on earlier runs.
- The registry version does not change (no parameter is added).

## Review Focus

- A `what_if` entry must be accepted by `configure_simulation` as it is: a school closure on a network without layers, or an end day past the run, must never be proposed in a form the validator refuses.
- A run seeded at 1% reaches the anchor on day 0: every entry then starts on day 0, which must be a valid and sensible proposal, not a crash or a negative day.
- A stored run from before this phase (levers without `interventions` or `label`) must still match, render and compare.
- A lever with entries must not be recorded as chosen when the user changed the interventions to something else (a different scale, another layer).
- The buttons must not appear while a reply is streaming, on a failed run, or on a run whose diagnostics carry no `what_if`.

---

### Task 1: Levers carry entries and a label; the indicator list is shared

**Files:**
- Modify: `epichat/sim/diagnostics.py` (`Lever`, `as_dicts`)
- Create: `epichat/params/indicators.py`
- Modify: `scripts/export_web_data.py`, `web/package.json` only if `sync-data` lists files (it does not: the script writes them all)
- Create (generated): `web/data/vaccine_indicators.json`
- Modify: `web/lib/tools/fetchVaccinationCoverage.ts`
- Test: `tests/test_sim_diagnostics.py`, `tests/test_web_exports.py`, `tests/test_indicators.py` (new), `web/tests/tools/fetchTools.test.ts`

**Interfaces:**
- Produces: `Lever(patch, current, direction, rationale, basis, interventions: list[dict] = [], label: str | None = None)`; `as_dicts` omits `interventions` when empty and `label` when None. `epichat.params.indicators.VACCINE_INDICATORS: dict[str, list[str]]` and `has_vaccine_indicator(disease: str | None) -> bool` (canonical name through `detect_disease`). `web/data/vaccine_indicators.json` is `{"indicators": {disease: [codes]}}`; `GHO_CODES` in `fetchVaccinationCoverage.ts` is read from it.

- [ ] **Step 1: Write the failing tests**

`tests/test_sim_diagnostics.py`, appended:

```python
def test_a_lever_may_carry_entries_and_a_label_and_serializes_as_before_without_them():
    plain = dx.Lever({"disease.beta": 9.0}, {"disease.beta": 22.8}, "decrease", "why", "rule")
    assert plain.interventions == [] and plain.label is None
    carrying = dx.Lever({}, {}, "change", "why", "rule", interventions=[{"type": "behavior_response", "scale": 0.5}], label="Let people become careful and rerun")
    out = dx.as_dicts([dx.Diagnostic("x", "info", "t", {}, [plain, carrying])])[0]["levers"]
    assert out[0] == {"patch": {"disease.beta": 9.0}, "current": {"disease.beta": 22.8}, "direction": "decrease", "rationale": "why", "basis": "rule"}
    assert out[1]["interventions"] == [{"type": "behavior_response", "scale": 0.5}] and out[1]["label"] == "Let people become careful and rerun"
    json.dumps(out)
```

`tests/test_indicators.py`, new:

```python
"""Follow-up spec 7.2: the diseases with a routine-immunization indicator live in one place."""
import ast
import json
from pathlib import Path

from epichat.params.indicators import VACCINE_INDICATORS, has_vaccine_indicator

ROOT = Path(__file__).resolve().parent.parent


def test_the_frozen_agent_and_the_web_read_the_same_list():
    tree = ast.parse((ROOT / "epichat" / "agent.py").read_text(encoding="utf-8"))
    frozen = next(ast.literal_eval(node.value) for node in ast.walk(tree)
                  if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "_GHO_CODES" for t in node.targets))
    assert frozen == VACCINE_INDICATORS
    exported = json.loads((ROOT / "web" / "data" / "vaccine_indicators.json").read_text(encoding="utf-8"))
    assert exported == {"indicators": VACCINE_INDICATORS}


def test_a_disease_is_matched_by_its_canonical_name():
    assert has_vaccine_indicator("measles") and has_vaccine_indicator("Measles")
    assert not has_vaccine_indicator("covid19") and not has_vaccine_indicator(None) and not has_vaccine_indicator("")
```

`tests/test_web_exports.py`: add `"vaccine_indicators.json"` to the tuple of names in `test_export_web_data_is_deterministic_and_fresh`.

`web/tests/tools/fetchTools.test.ts`, appended (import `GHO_CODES` from the tool and the JSON from `@/data/vaccine_indicators.json`):

```ts
describe("the routine-immunization indicators (follow-up spec 7.2)", () => {
  it("come from the list the service shares", () => {
    expect(GHO_CODES).toEqual(indicators.indicators);
    expect(Object.keys(GHO_CODES)).toContain("measles");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `python -m pytest tests/test_sim_diagnostics.py tests/test_indicators.py tests/test_web_exports.py -q -p no:cacheprovider -k "carry_entries or indicators or export_web_data"`
Expected: FAIL (`Lever` takes no `interventions`; no module `epichat.params.indicators`; the export has no such file).

- [ ] **Step 3: Implement**

`epichat/params/indicators.py`:

```python
"""Follow-up spec 7.2: the diseases with a routine-immunization coverage indicator (WHO GHO codes), in one place the service and
the web app share. The frozen Python agent keeps its own copy (epichat/agent.py, _GHO_CODES); a test keeps the two equal."""
from __future__ import annotations

VACCINE_INDICATORS: dict[str, list[str]] = {
    "measles": ["WHS8_110", "MCV2"],
    "rubella": ["WHS8_110"],
    "pertussis": ["WHS3_41"],
    "polio": ["WHS3_43"],
    "hepatitis_a": ["WHS3_45"],
    "tuberculosis": ["WHS3_40"],
    "meningococcal": ["MENGA"],
}


def has_vaccine_indicator(disease: str | None) -> bool:
    if not disease:
        return False
    from epichat.disease_db import detect_disease
    return (detect_disease(disease) or disease.lower()) in VACCINE_INDICATORS
```

(Copy the dictionary from `epichat/agent.py` as it stands there; the test fails if it differs.)

`epichat/sim/diagnostics.py`: add the two fields to `Lever` with their defaults, and in `as_dicts` delete `interventions` from a lever's dict when empty and `label` when None.

`scripts/export_web_data.py`: `write_json(web_dir / "data" / "vaccine_indicators.json", {"indicators": VACCINE_INDICATORS})`.

`web/lib/tools/fetchVaccinationCoverage.ts`: `import indicators from "@/data/vaccine_indicators.json"; export const GHO_CODES: Record<string, string[]> = indicators.indicators;`

Run `python scripts/export_web_data.py`, then restore any file whose only change is its line endings.

- [ ] **Step 4: Run the tests and watch them pass**

Run: the command of step 2, then `cd web && npx vitest run tests/tools/fetchTools.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add epichat/params/indicators.py epichat/sim/diagnostics.py scripts/export_web_data.py web/data/vaccine_indicators.json web/lib/tools/fetchVaccinationCoverage.ts tests web/tests
git commit -m "feat(sim): levers carry intervention entries and a label; one list of vaccine indicators"
```

---

### Task 2: The `what_if` diagnostic

**Files:**
- Modify: `epichat/sim/diagnostics.py`
- Test: `tests/test_sim_whatif.py` (new)

**Interfaces:**
- Consumes: `Lever` with `interventions` and `label` (Task 1); `has_vaccine_indicator` (Task 1); `_Run` (`params`, `series`, `stats`, `n`, `total`, `disease`).
- Produces: `anchor_day(run) -> int | None`; `_what_if(run, faded: bool) -> Diagnostic | None` with id `what_if`, severity `info`, title `Interventions to try`, evidence `{"anchor_day": int, "attack_rate": float}`; constants `ANCHOR_SHARE = 0.01`, `WHAT_IF_MIN_ATTACK = 0.05`, `WHAT_IF_MAX_LEVERS = 4`, `LABEL_MAX = 80`, `CAMPAIGN_COVERAGE = 0.7`, `CAMPAIGN_DAYS = 30`, `CAMPAIGN_EFFICACY = 0.9`, `CLOSURE_DAYS = 42`, `DISTANCING_SCALE = 0.3`, `DISTANCING_DAYS = 56`, `MASKS_SCALE = 0.2`, `MASKS_DAYS = 90`, `RESPONSE_SCALE = 0.5`. `diagnose` appends it last.

- [ ] **Step 1: Write the failing tests** (`tests/test_sim_whatif.py`)

```python
"""Follow-up spec 7.2: after a run that had an epidemic, interventions to try, as levers that carry entries and a ready reply."""
import pytest

from epichat.params.schema_v2 import SimParamsV2
from epichat.sim import diagnostics as dx
from epichat.sim.diagnostics import diagnose

N = 10000
DAYS = 366


def params(**over) -> SimParamsV2:
    body = {"disease": {"dur_inf": {"mean_days": 10, "dist": "gamma", "sd_days": 3}, "seed": {"mode": "count", "value": 10}},
            "run": {"n_agents": N, "sim_dur_years": 1.0, "rand_seed": 1}}
    for path, value in over.items():
        node = body
        parts = path.split(".")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = value
    return SimParamsV2.model_validate(body)


def epidemic(total: float = 8600, first: int = 10, anchor: int = 20):
    """New infections: the seeds on day 0, a trickle, then 1% of the agents reached on `anchor`, the rest spread over 100 days."""
    new = [0.0] * DAYS
    new[0] = first
    new[anchor] = 0.01 * N - first
    rest = (total - 0.01 * N) / 100
    for t in range(anchor + 1, anchor + 101):
        new[t] = rest
    infectious = [min(800.0, 20.0 * t) if t < 150 else 0.0 for t in range(DAYS)]
    return infectious, new


def what_if(p: SimParamsV2, total: float = 8600, anchor: int = 20, disease: str | None = None, seeds: int = 10):
    infectious, new = epidemic(total, seeds, anchor)
    series = {"day": list(range(DAYS)), "n_infectious": infectious, "new_infections": new}
    stats = {"total_infected": total, "n_agents": N, "seeds": seeds, "seeds_day0": seeds}
    found = diagnose(p, series, stats, None, seeds, disease)
    return next((d for d in found if d.id == "what_if"), None), found


def entries(d):
    return [lever.interventions[0] for lever in d.levers]


def test_the_candidates_on_the_random_network_are_distancing_masks_and_the_response():
    d, found = what_if(params())
    assert d.severity == "info" and d.title == "Interventions to try" and d.evidence == {"anchor_day": 20, "attack_rate": 0.86}
    assert found[-1].id == "what_if"                                                       # after every other diagnostic
    assert entries(d) == [
        {"type": "contact_reduction", "layer": "all", "scale": 0.3, "start_day": 20, "end_day": 76},
        {"type": "transmission_reduction", "scale": 0.2, "start_day": 20, "end_day": 110},
        {"type": "behavior_response", "scale": 0.5},
    ]
    assert [lever.label for lever in d.levers] == [
        "Cut contacts by 30% from day 20 for eight weeks and rerun",
        "Add masks (20% less transmission) from day 20 for 90 days and rerun",
        "Let people become careful as cases rise and rerun",
    ]
    for lever in d.levers:
        assert lever.patch == {} and lever.current == {} and lever.direction == "change" and lever.basis == "rule"
        assert "illustrative" in lever.rationale and len(lever.label) <= dx.LABEL_MAX


def test_the_hybrid_network_adds_a_school_closure_and_a_disease_with_an_indicator_adds_a_campaign():
    hybrid = params(**{"network.network_type": "hybrid"})
    d, _ = what_if(hybrid, disease="measles")
    assert [e["type"] for e in entries(d)] == ["vaccine", "contact_reduction", "contact_reduction", "transmission_reduction"]   # four at most: the response is left out
    assert entries(d)[0] == {"type": "vaccine", "kind": "campaign", "coverage": 0.7, "efficacy": 0.9, "start_day": 20, "end_day": 50}
    assert entries(d)[1] == {"type": "contact_reduction", "layer": "school", "scale": 1.0, "start_day": 20, "end_day": 62}
    assert entries(d)[2] == {"type": "contact_reduction", "layer": "community", "scale": 0.3, "start_day": 20, "end_day": 76}
    assert d.levers[0].label == "Vaccinate 70% in a campaign from day 20 to day 50 and rerun"
    assert d.levers[1].label == "Close schools from day 20 for six weeks and rerun"
    assert d.levers[2].label == "Cut community contacts by 30% from day 20 for eight weeks and rerun"
    assert len(d.levers) == dx.WHAT_IF_MAX_LEVERS
    no_indicator, _ = what_if(hybrid, disease="covid19")
    assert [e["type"] for e in entries(no_indicator)] == ["contact_reduction", "contact_reduction", "transmission_reduction", "behavior_response"]
    no_children = params(**{"network.network_type": "hybrid", "demographics.age_pct_under18": 0.0, "demographics.age_pct_18_64": 90.0, "demographics.age_pct_over65": 10.0})
    assert [e.get("layer") for e in entries(what_if(no_children)[0])][:1] == ["community"]


def test_nothing_the_scenario_already_has_is_offered():
    has = params(**{"network.network_type": "hybrid", "interventions": [
        {"type": "vaccine", "coverage": 0.5}, {"type": "contact_reduction", "layer": "school", "scale": 1.0, "start_day": 5, "end_day": 30},
        {"type": "transmission_reduction", "scale": 0.1, "start_day": 0, "end_day": 10}, {"type": "behavior_response", "scale": 0.3}]})
    d, _ = what_if(has, disease="measles")
    assert entries(d) == [{"type": "contact_reduction", "layer": "community", "scale": 0.3, "start_day": 20, "end_day": 76}]
    everything = params(**{"interventions": [{"type": "contact_reduction", "layer": "all", "scale": 0.2, "start_day": 0, "end_day": 10},
                                             {"type": "transmission_reduction", "scale": 0.1, "start_day": 0, "end_day": 10}, {"type": "behavior_response", "scale": 0.3}]})
    assert what_if(everything)[0] is None                                                   # nothing left to offer


def test_it_waits_for_an_epidemic():
    assert what_if(params(), total=400)[0] is None                                          # an attack rate under 5%
    faded = diagnose(params(), {"day": list(range(DAYS)), "n_infectious": [10.0, 4.0, 1.0] + [0.0] * (DAYS - 3), "new_infections": [10.0, 5.0] + [0.0] * (DAYS - 2)},
                     {"total_infected": 15, "n_agents": N, "seeds": 10, "seeds_day0": 10}, None, 10, None)
    assert [d.id for d in faded] == ["early_fadeout"]
    assert what_if(params(), total=600)[0] is not None


def test_the_anchor_is_the_day_one_percent_were_infected_and_the_default_seeding_is_day_zero():
    assert what_if(params(), anchor=45)[0].evidence["anchor_day"] == 45
    seeded = what_if(params(**{"disease.seed": {"mode": "fraction", "value": 0.01}}), anchor=0, seeds=100)[0]
    assert seeded.evidence["anchor_day"] == 0 and entries(seeded)[0]["start_day"] == 0 and entries(seeded)[0]["end_day"] == 56
    assert seeded.levers[0].label == "Cut contacts by 30% from day 0 for eight weeks and rerun"
    cumulative = {"day": [0, 1, 2], "n_infectious": [1.0, 2.0, 3.0], "new_infections": [0.0, 0.0, 0.0], "cum_infections": [50.0, 120.0, 300.0]}
    run = dx._Run(params(), cumulative, {"total_infected": 300, "n_agents": N}, None, 50, None)
    assert dx.anchor_day(run) == 1                                                          # the series' own cumulative count when it is there
    assert dx.anchor_day(dx._Run(params(), {"n_infectious": [1.0], "new_infections": [0.0]}, {"total_infected": 0}, None, 1, None)) is None


def test_a_window_never_passes_the_end_of_the_run():
    short = params(**{"run.sim_dur_years": 60 / 365})
    infectious, new = epidemic(8600, 10, 20)
    series = {"day": list(range(61)), "n_infectious": infectious[:61], "new_infections": new[:61]}
    d = next(x for x in diagnose(short, series, {"total_infected": 4000, "n_agents": N, "seeds": 10, "seeds_day0": 10}, None, 10, None) if x.id == "what_if")
    assert entries(d)[0]["end_day"] == 60 and entries(d)[1]["end_day"] == 60


@pytest.mark.parametrize("network,disease", [("random", None), ("hybrid", "measles"), ("age_structured", "pertussis")])
def test_every_entry_is_one_the_schema_accepts(network, disease):
    p = params(**{"network.network_type": network})
    d, _ = what_if(p, disease=disease)
    for lever in d.levers:
        body = p.model_dump()
        body["interventions"] = lever.interventions
        SimParamsV2.model_validate(body)                                                    # the validator the tool applies
```

- [ ] **Step 2: Run them and watch them fail**

Run: `python -m pytest tests/test_sim_whatif.py -q -p no:cacheprovider`
Expected: FAIL (no `what_if`, no `anchor_day`).

- [ ] **Step 3: Implement** in `epichat/sim/diagnostics.py`

Constants (under the existing ones, with the comment "follow-up spec 7.2: every size is illustrative until the database carries it"), then:

```python
def anchor_day(run: _Run) -> int | None:
    """The first day the run's cumulative infections reached ANCHOR_SHARE of the agents: when the outbreak would have been noticed."""
    cumulative = run.series.get("cum_infections")
    if not cumulative:
        cumulative = np.cumsum([float(v) for v in run.series.get("new_infections") or []]).tolist()
    threshold = ANCHOR_SHARE * run.n
    return next((t for t, value in enumerate(cumulative) if value >= threshold), None)


def _campaign_efficacy(disease: str | None) -> tuple[float, Basis]:
    rng = db_range(disease, "vaccine_efficacy")
    typical = rng[2] if rng else None
    if typical is not None:
        value = typical / 100.0 if typical > 1 else typical
        if 0 < value <= 1:
            return round(value, 4), "disease_db"
    return CAMPAIGN_EFFICACY, "rule"


def _what_if(run: _Run, faded: bool) -> Diagnostic | None:
    """Follow-up spec 7.2: interventions to try after a run that had an epidemic, each a lever with one entry and a ready reply.
    The candidates the scenario does not already have (by type, and by layer for a contact reduction), in the table's order, four
    at most. Every window starts on the anchor day and never passes the run's last day."""
    p = run.params
    if faded or run.n <= 0 or run.total / run.n < WHAT_IF_MIN_ATTACK:
        return None
    anchor = anchor_day(run)
    if anchor is None:
        return None
    last = max(run.days - 1, anchor)
    has = {(i.type, i.layer if i.type == "contact_reduction" else None) for i in p.interventions}
    hybrid = p.network.network_type == "hybrid"

    def window(days: int) -> dict:
        return {"start_day": anchor, "end_day": min(anchor + days, last)}

    levers: list[Lever] = []

    def offer(entry: dict, label: str, rationale: str, basis: Basis = "rule") -> None:
        levers.append(Lever({}, {}, "change", rationale, basis, interventions=[entry], label=label))

    if has_vaccine_indicator(run.disease) and not any(kind == "vaccine" for kind, _ in has):
        efficacy, basis = _campaign_efficacy(run.disease)
        w = window(CAMPAIGN_DAYS)
        offer({"type": "vaccine", "kind": "campaign", "coverage": CAMPAIGN_COVERAGE, "efficacy": efficacy, **w},
              f"Vaccinate {CAMPAIGN_COVERAGE:.0%} in a campaign from day {w['start_day']} to day {w['end_day']} and rerun",
              f"A campaign reaching {CAMPAIGN_COVERAGE:.0%} of the susceptible over {CAMPAIGN_DAYS} days from the day 1% had been infected; "
              + ("the efficacy is the database's." if basis == "disease_db" else f"the coverage and the efficacy ({efficacy:g}) are illustrative."), basis)
    if hybrid and age_shares(p)[0] > 0 and ("contact_reduction", "school") not in has:
        offer({"type": "contact_reduction", "layer": "school", "scale": 1.0, **window(CLOSURE_DAYS)},
              f"Close schools from day {anchor} for six weeks and rerun",
              "A full school closure for six weeks from the day 1% had been infected; the length is illustrative.")
    layer = "community" if hybrid else "all"
    if ("contact_reduction", layer) not in has:
        offer({"type": "contact_reduction", "layer": layer, "scale": DISTANCING_SCALE, **window(DISTANCING_DAYS)},
              f"Cut {'community ' if hybrid else ''}contacts by {DISTANCING_SCALE:.0%} from day {anchor} for eight weeks and rerun",
              f"Distancing: {DISTANCING_SCALE:.0%} fewer {'community ' if hybrid else ''}contacts for eight weeks; the size is illustrative.")
    if not any(kind == "transmission_reduction" for kind, _ in has):
        offer({"type": "transmission_reduction", "scale": MASKS_SCALE, **window(MASKS_DAYS)},
              f"Add masks ({MASKS_SCALE:.0%} less transmission) from day {anchor} for {MASKS_DAYS} days and rerun",
              f"Masks: {MASKS_SCALE:.0%} less transmission per contact for {MASKS_DAYS} days; the size is illustrative.")
    if not any(kind == "behavior_response" for kind, _ in has):
        offer({"type": "behavior_response", "scale": RESPONSE_SCALE},
              "Let people become careful as cases rise and rerun",
              f"A behaviour response: transmission falls by up to {RESPONSE_SCALE:.0%} as infections rise and recovers as they fall; illustrative.")
    if not levers:
        return None
    return Diagnostic("what_if", "info", "Interventions to try", {"anchor_day": anchor, "attack_rate": round(run.total / run.n, 3)},
                      levers[:WHAT_IF_MAX_LEVERS])
```

Import `age_shares` from `epichat.params.r0` and `has_vaccine_indicator` from `epichat.params.indicators`. In `diagnose`, append `_what_if(run, fadeout is not None)` after `_r0_gap(run)`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `python -m pytest tests/test_sim_whatif.py tests/test_sim_diagnostics.py -q -p no:cacheprovider`
Expected: PASS. A test of `tests/test_sim_diagnostics.py` that pins an exact list of ids on a run with real series gains `what_if` at its end; update the pin and ledger it.

- [ ] **Step 5: Commit**

```bash
git add epichat/sim/diagnostics.py tests/test_sim_whatif.py tests/test_sim_diagnostics.py
git commit -m "feat(sim): what_if, the interventions to try after a run"
```

---

### Task 3: `well_mixed`, broadened

**Files:**
- Modify: `epichat/sim/diagnostics.py` (`_well_mixed`)
- Test: `tests/test_sim_diagnostics.py`

**Interfaces:**
- Consumes: `Lever` with `interventions` and `label`.
- Produces: `well_mixed` fires on every network when `r_eff >= WELL_MIXED_R_EFF` and the attack rate is above `WELL_MIXED_ATTACK_RATE`; stands down with `disease.rel_sus_cv > 0`, a `behavior_response` entry or a `contact_reduction` entry; title `Nearly everyone was infected: only the depletion of susceptibles limits this epidemic`; levers in order: the variation at `WELL_MIXED_CV = 1.0`, a behaviour response at `RESPONSE_SCALE`, and on the random network only the hybrid network.

- [ ] **Step 1: Write the failing test** (replace `test_well_mixed_fires_on_a_random_network_run_that_infected_nearly_everyone`)

```python
def test_well_mixed_fires_on_every_network_and_offers_the_two_limits_on_spread():
    # follow-up spec 7.6: every network infects nearly everyone at the same R0, so the diagnostic no longer blames the random one
    d = one(run(params(), NORMAL, total=8600, seeds=100), "well_mixed")
    assert d.severity == "info" and d.evidence == {"attack_rate": 0.86, "r_eff": pytest.approx(dx.approx_r0(params()), abs=0.01)}
    assert d.title == "Nearly everyone was infected: only the depletion of susceptibles limits this epidemic"
    variation, response, hybrid = d.levers
    assert variation.patch == {"disease.rel_sus_cv": 1.0} and variation.current == {"disease.rel_sus_cv": 0.0} and variation.basis == "rule"
    assert variation.label == "Add variation between people (CV 1) and rerun" and "illustrative" in variation.rationale
    assert response.patch == {} and response.interventions == [{"type": "behavior_response", "scale": 0.5}]
    assert response.label == "Let people become careful as cases rise and rerun" and "illustrative" in response.rationale
    assert hybrid.patch == {"network.network_type": "hybrid"} and "same measured R0" in hybrid.rationale and hybrid.label == "Switch to the hybrid network and rerun"
    for lever in d.levers:
        assert len(lever.label) <= dx.LABEL_MAX
    for network in ("hybrid", "age_structured"):
        other = one(run(params(**{"network.network_type": network}), NORMAL, total=8600, seeds=100), "well_mixed")
        assert [l.label for l in other.levers] == [variation.label, response.label]            # the hybrid network is offered only on the random one
    assert "well_mixed" not in ids(run(params(), NORMAL, total=6000, seeds=100))                       # attack rate 0.6
    assert "well_mixed" not in ids(run(params(**{"disease.initial_immune_frac": 0.3}), NORMAL, total=8600, seeds=100))   # R_eff 1.6
    assert "well_mixed" not in ids(run(params(**{"disease.rel_sus_cv": 0.5}), NORMAL, total=8600, seeds=100))
    assert "well_mixed" not in ids(run(params(interventions=[{"type": "behavior_response", "scale": 0.2}]), NORMAL, total=8600, seeds=100))
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python -m pytest tests/test_sim_diagnostics.py -q -p no:cacheprovider -k well_mixed`
Expected: FAIL (the title, one lever, silent on the hybrid network).

- [ ] **Step 3: Implement**

```python
def _well_mixed(run: _Run) -> Diagnostic | None:
    """Part 2, 5.8 as broadened by follow-up spec 7.6: at the same R0 every network infects nearly everyone (the follow-up measured
    it), so this fires on all of them and offers the two limits on spread; the hybrid network is offered on the random one only, as
    the structure interventions act on, without promising a lower final size."""
    p = run.params
    if run.r_eff < WELL_MIXED_R_EFF or run.n <= 0:
        return None
    if p.disease.rel_sus_cv > 0 or any(i.type in ("contact_reduction", "behavior_response") for i in p.interventions):
        return None                                                    # a limit on spread, or limited contacts, is already set
    attack = run.total / run.n
    if attack <= WELL_MIXED_ATTACK_RATE:
        return None
    levers = [
        Lever({"disease.rel_sus_cv": WELL_MIXED_CV}, {"disease.rel_sus_cv": p.disease.rel_sus_cv}, "change",
              "Variation between people in susceptibility: the most susceptible are infected first, so the epidemic ends smaller at the "
              "same R0. A coefficient of variation of 1 is illustrative.", "rule", label="Add variation between people (CV 1) and rerun"),
        Lever({}, {}, "change",
              f"A behaviour response: transmission falls by up to {RESPONSE_SCALE:.0%} as infections rise and recovers as they fall, which "
              "flattens the peak and removes the overshoot; illustrative.", "rule",
              interventions=[{"type": "behavior_response", "scale": RESPONSE_SCALE}], label="Let people become careful as cases rise and rerun"),
    ]
    if p.network.network_type == "random":
        levers.append(Lever({"network.network_type": "hybrid"}, {"network.network_type": "random"}, "change",
                            "The hybrid network makes households, schools and workplaces explicit, so interventions can act on them; at the same "
                            "measured R0 its final size is close to the random network's, so the switch alone does not lower it.", "rule",
                            label="Switch to the hybrid network and rerun"))
    return Diagnostic("well_mixed", "info", "Nearly everyone was infected: only the depletion of susceptibles limits this epidemic",
                      {"attack_rate": round(attack, 3), "r_eff": round(run.r_eff, 2)}, levers)
```

Update the other pins of `well_mixed` in `tests/test_sim_diagnostics.py` (the two exact id lists and any assertion on its lever) to the new behaviour, ledgering each.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `python -m pytest tests/test_sim_diagnostics.py tests/test_sim_whatif.py -q -p no:cacheprovider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add epichat/sim/diagnostics.py tests/test_sim_diagnostics.py
git commit -m "feat(sim): well_mixed fires on every network and offers the limits on spread"
```

---

### Task 4: The web app reads, matches and records levers with entries

**Files:**
- Modify: `web/lib/sim/client.ts` (`Lever`), `web/lib/tools/options.ts`, `web/lib/tools/types.ts` (`onOptionChosen`), `web/lib/tools/configureSimulation.ts`, `web/lib/chat/handleChat.ts`, `web/lib/tools/advanced.ts`
- Test: `web/tests/tools/configureSimulation.test.ts`, `web/tests/tools/helpers.ts` if the fake deps need the new argument, `web/tests/chat/*` where `option_chosen` is pinned

**Interfaces:**
- Consumes: the service's lever with optional `interventions` and `label`.
- Produces: `Lever = { patch; current; direction; rationale; basis; interventions?: Record<string, unknown>[]; label?: string | null }`; `MatchedLever = { diagnosticId; patch; interventions?: Record<string, unknown>[] }`; `matchedLevers(previous, changed, params)` matches a lever with entries when the call changed `interventions` and every entry is in the new scenario (same type, same layer for a contact reduction, every field of the lever's entry equal by `near`); a lever with a patch and entries needs both. `onOptionChosen(runId, diagnosticId, patch, interventions?)`; the `option_chosen` step's meta gains `interventions` (JSON) when the lever carried entries. The `advanced` refusal reads `<path> is set through configure_simulation's interventions field, not through advanced`.

- [ ] **Step 1: Write the failing tests** (`web/tests/tools/configureSimulation.test.ts`, appended; `makeDeps({ previousRun })` and `deps.options` as the tests of "records a taken option" use them. In `web/tests/tools/helpers.ts` the fake `onOptionChosen` pushes `{ runId, diagnosticId, patch, ...(interventions ? { interventions } : {}) }`, and the `options` type gains the optional field)

```ts
describe("configure_simulation and a lever that carries entries (follow-up spec 7.5)", () => {
  const closure = { type: "contact_reduction", layer: "school", scale: 1, start_day: 20, end_day: 62 };
  const whatIf = { id: "what_if", severity: "info" as const, title: "Interventions to try", evidence: {}, levers: [
    { patch: {}, current: {}, direction: "change" as const, rationale: "r", basis: "rule" as const, interventions: [closure], label: "Close schools from day 20 for six weeks and rerun" },
    { patch: {}, current: {}, direction: "change" as const, rationale: "r", basis: "rule" as const, interventions: [{ type: "transmission_reduction", scale: 0.2, start_day: 20, end_day: 110 }], label: "Add masks" },
  ] };

  const previous = (diagnostics: unknown[]) => ({
    id: "run-7", effectiveParams: params({}), stats: { peak_infections: 1, peak_day: 1, total_infected: 1, total_deaths: 0, n_agents: 10000, sim_days: 366 },
    statsAgents: { peak_infections: 1, peak_day: 1, total_infected: 1, total_deaths: 0, n_agents: 10000, sim_days: 366 }, popScale: 1, diagnostics,
  }) as unknown as PreviousRun;

  it("records the lever when its entries were applied, and not when something else was", async () => {
    const deps = makeDeps({ previousRun: previous([whatIf]) });
    await run(deps, { disease: "measles", r0: 3, network_type: "hybrid" });
    deps.scenario.hasRun = true;
    await run(deps, { interventions: [closure] });
    expect(deps.options).toEqual([{ runId: "run-7", diagnosticId: "what_if", patch: {}, interventions: [closure] }]);
    deps.options.length = 0;
    await run(deps, { interventions: [{ ...closure, scale: 0.5 }] });                      // a different size is the user's own change
    await run(deps, { interventions: [{ type: "contact_reduction", layer: "community", scale: 1, start_day: 20, end_day: 62 }] });   // another layer
    await run(deps, { interventions: [closure] });                                         // back to the lever's entry: taken again
    expect(deps.options).toEqual([{ runId: "run-7", diagnosticId: "what_if", patch: {}, interventions: [closure] }]);
    deps.options.length = 0;
    await run(deps, { n_agents: 5000 });                                                   // the entry is there, but this call did not touch the interventions
    expect(deps.options).toEqual([]);
  });

  it("still matches a stored lever without the new fields, and never a lever with nothing in it", async () => {
    const stored = { id: "early_fadeout", severity: "warning" as const, title: "t", evidence: {}, levers: [
      { patch: {}, current: {}, direction: "change" as const, rationale: "keep it", basis: "rule" as const },
      { patch: { "run.n_replicates": 5 }, current: { "run.n_replicates": 1 }, direction: "increase" as const, rationale: "r", basis: "rule" as const }] };
    const deps = makeDeps({ previousRun: previous([stored]) });
    await run(deps, { disease: "measles", r0: 3 });
    deps.scenario.hasRun = true;
    await run(deps, { advanced: { "run.n_replicates": 5 } });
    expect(deps.options).toEqual([{ runId: "run-7", diagnosticId: "early_fadeout", patch: { "run.n_replicates": 5 } }]);
  });

  it("refuses an interventions path in advanced by naming the interventions field", async () => {
    const deps = makeDeps();
    await run(deps, { disease: "measles", r0: 3 });
    const out = await run(deps, { advanced: { "interventions[].scale": 0.5 } });
    expect(out.isError).toBe(true);
    expect(out.content).toContain("is set through configure_simulation's interventions field, not through advanced");
  });
});
```

Import `PreviousRun` from `@/lib/db/runs` in the test file if it is not there.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npx vitest run tests/tools/configureSimulation.test.ts`
Expected: FAIL (no match for a lever with an empty patch; the old refusal text).

- [ ] **Step 3: Implement**

`web/lib/tools/options.ts`:

```ts
export type MatchedLever = { diagnosticId: string; patch: Record<string, unknown>; interventions?: Record<string, unknown>[] };

const sameEntry = (lever: Record<string, unknown>, now: Record<string, unknown>) =>
  now.type === lever.type && (lever.type !== "contact_reduction" || (now.layer ?? "all") === (lever.layer ?? "all")) &&
  Object.keys(lever).every((key) => near(now[key], lever[key]));

export function matchedLevers(previous: PreviousRun | null, changed: PathChange[], params: SimParams): MatchedLever[] {
  if (!previous || changed.length === 0) return [];
  const applied = new Map(changed.map((c) => [c.path, c.to]));
  const current = flattenParams(params as unknown as Record<string, unknown>);
  const now = params.interventions as unknown as Record<string, unknown>[];
  const out: MatchedLever[] = [];
  for (const diagnostic of previous.diagnostics) {
    const lever = diagnostic.levers.find((l) => {
      const paths = Object.keys(l.patch);
      const entries = l.interventions ?? [];
      if (paths.length === 0 && entries.length === 0) return false;
      const patched = paths.length === 0 || (paths.some((p) => applied.has(p)) && paths.every((p) => near(applied.has(p) ? applied.get(p) : current[p], l.patch[p])));
      const entered = entries.length === 0 || (applied.has("interventions") && entries.every((entry) => now.some((i) => sameEntry(entry, i))));
      return patched && entered;
    });
    if (lever) out.push({ diagnosticId: diagnostic.id, patch: lever.patch, ...(lever.interventions?.length ? { interventions: lever.interventions } : {}) });
  }
  return out;
}
```

(`flattenParams` leaves the `interventions` array as one leaf, so a call that changed any entry has the path `interventions` in `changed`.)

`configureSimulation.ts`: pass `match.interventions` as the fourth argument. `types.ts`: the fourth, optional parameter. `handleChat.ts`: `meta: { run_id, diagnostic_id, patch: JSON.stringify(patch), ...(interventions ? { interventions: JSON.stringify(interventions) } : {}) }`. `advanced.ts` line 16: the new text. `client.ts`: the two optional fields, with the comment "follow-up spec 7.1".

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run tests/tools tests/chat && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib web/tests
git commit -m "feat(web): a taken lever is matched by its intervention entries; the advanced refusal names the interventions field"
```

---

### Task 5: "Try next" under the latest run

**Files:**
- Create: `web/lib/client/tryNext.ts`
- Modify: `web/lib/enums.ts` (`SUGGESTION_SOURCES`), `web/lib/client/drafts.ts` (`ChipSource`), `web/components/RunSummary.tsx`, `web/components/TurnBlocks.tsx`, `web/components/Turn.tsx`, `web/components/Chat.tsx`
- Test: `web/tests/client/tryNext.test.ts` (new), `web/tests/api/*` or `web/tests/lib/*` where the client-event schema is pinned

**Interfaces:**
- Consumes: `RunPayload.diagnostics` with levers that carry `label`.
- Produces: `SUGGESTION_SOURCES = ["model", "draft", "intro", "option", "reference"]`; `tryNextLabels(payload: RunPayload): string[]` (the `what_if` diagnostic's labels, non-empty, at most 80 characters, at most `TRY_NEXT_MAX = 3`, no duplicates); `latestRunKey(turns: { id: string; blocks: Block[] }[]): string | null` returning `"<turnId>:<blockIndex>"` of the last successful run block of the last turn, or null when the last turn has none. `RunSummary` takes `options?: string[]` and `onPick?: (label: string) => void` and renders the buttons under the chart when both are given and the list is not empty. `Turn` and `TurnBlocks` take `tryNext?: { key: string | null; onPick: (label: string) => void }`.

- [ ] **Step 1: Write the failing tests** (`web/tests/client/tryNext.test.ts`)

```ts
import { describe, expect, it } from "vitest";

import type { Block } from "@/lib/chat/events";
import { TRY_NEXT_MAX, latestRunKey, tryNextLabels } from "@/lib/client/tryNext";
import { SUGGESTION_SOURCES } from "@/lib/enums";
import type { RunPayload } from "@/lib/tools/types";

const lever = (label?: string | null) => ({ patch: {}, current: {}, direction: "change" as const, rationale: "r", basis: "rule" as const, interventions: [{ type: "behavior_response" }], ...(label === undefined ? {} : { label }) });
const payload = (diagnostics: unknown): RunPayload => ({ kind: "run", diagnostics } as unknown as RunPayload);
const run = (ok = true): Block => ({ kind: "tool_result", id: "t", name: "run_simulation", ok, payload: payload([]) } as unknown as Block);
const text: Block = { kind: "text", text: "hello" };

describe("the run card's Try next buttons (follow-up spec 7.4)", () => {
  it("takes at most three labels from what_if", () => {
    const whatIf = { id: "what_if", severity: "info", title: "Interventions to try", evidence: {}, levers: [lever("A and rerun"), lever("B and rerun"), lever(null), lever(""), lever("A and rerun"), lever("C and rerun"), lever("D and rerun")] };
    const other = { id: "well_mixed", severity: "info", title: "t", evidence: {}, levers: [lever("Not this one")] };
    expect(tryNextLabels(payload([other, whatIf]))).toEqual(["A and rerun", "B and rerun", "C and rerun"]);
    expect(TRY_NEXT_MAX).toBe(3);
    expect(tryNextLabels(payload([other]))).toEqual([]);
    expect(tryNextLabels(payload(undefined))).toEqual([]);                                   // a payload stored before diagnostics existed
    expect(tryNextLabels(payload([{ ...whatIf, levers: [lever("x".repeat(81)), lever("Short and rerun")] }]))).toEqual(["Short and rerun"]);
  });

  it("names the last run of the last turn only", () => {
    expect(latestRunKey([{ id: "a", blocks: [run()] }, { id: "b", blocks: [text, run(), text, run(), text] }])).toBe("b:3");
    expect(latestRunKey([{ id: "a", blocks: [run()] }, { id: "b", blocks: [text] }])).toBeNull();     // the conversation has moved on
    expect(latestRunKey([{ id: "a", blocks: [run(false)] }])).toBeNull();                              // a failed run has nothing to offer
    expect(latestRunKey([])).toBeNull();
  });

  it("has a source for the buttons and one for a chosen reference", () => {
    expect(SUGGESTION_SOURCES).toEqual(["model", "draft", "intro", "option", "reference"]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npx vitest run tests/client/tryNext.test.ts`
Expected: FAIL (no module).

- [ ] **Step 3: Implement**

`web/lib/client/tryNext.ts`:

```ts
import type { Block } from "@/lib/chat/events";
import type { RunPayload } from "@/lib/tools/types";

/** Follow-up spec 7.4: the latest run shows up to three of what_if's ready replies as buttons. */
export const TRY_NEXT_MAX = 3;
const LABEL_MAX = 80;

export function tryNextLabels(payload: RunPayload): string[] {
  const whatIf = (payload.diagnostics ?? []).find((d) => d.id === "what_if");
  const labels: string[] = [];
  for (const lever of whatIf?.levers ?? []) {
    const label = typeof lever.label === "string" ? lever.label.trim() : "";
    if (label && label.length <= LABEL_MAX && !labels.includes(label)) labels.push(label);
  }
  return labels.slice(0, TRY_NEXT_MAX);
}

/** "<turn id>:<block index>" of the last successful run of the last turn; null when the last turn ran nothing. */
export function latestRunKey(turns: { id: string; blocks: Block[] }[]): string | null {
  const last = turns.at(-1);
  if (!last) return null;
  for (let index = last.blocks.length - 1; index >= 0; index--) {
    const block = last.blocks[index];
    if (block.kind === "tool_result" && block.ok && block.payload.kind === "run") return `${last.id}:${index}`;
  }
  return null;
}
```

`enums.ts`: the two sources. `drafts.ts`: `export type ChipSource = (typeof SUGGESTION_SOURCES)[number]` if the file can import the enum without a cycle, else add the two literals.

`RunSummary.tsx`: after the chart,

```tsx
{options && options.length > 0 && onPick && (
  <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Try next">
    <span className="text-xs text-ink-faint">Try next</span>
    {options.map((label) => (
      <button key={label} type="button" onClick={() => onPick(label)} className="rounded-full border border-line bg-paper px-3 py-1 text-sm hover:bg-paper-2">
        {label}
      </button>
    ))}
  </div>
)}
```

(use the classes of `Suggestions.tsx`'s buttons so the two look alike). `TurnBlocks`: `tryNext?.key === \`${turnId}:${index}\`` decides whether the run block gets `options={tryNextLabels(block.payload)}` and `onPick`; it needs the turn's id, so `Turn` passes `turnId={turn.id}` and `tryNext`. `Chat.tsx`: `const tryNext = live ? null : { key: latestRunKey(turns), onPick: (label: string) => void send(label, "option") }` and `<Turn … tryNext={tryNext ?? undefined} />` for the stored turns only (the live turn gets none, so nothing shows while a reply is streaming). `SharedConversation.tsx` passes nothing.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run tests/client tests/api tests/lib && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib web/components web/tests
git commit -m "feat(web): Try next buttons under the latest run"
```

---

### Task 6: The prompt's "After a run", the tool description, the documents

**Files:**
- Modify: `web/lib/chat/prompt.ts`, `web/lib/tools/index.ts` (the `run_simulation` and `configure_simulation` descriptions), `README.md`, `docs/superpowers/specs/2026-10-13-limits-suggestions-parameters-design.md` (status, "as shipped" notes)
- Test: `web/tests/chat/prompt.test.ts`, `tests/test_readme.py` if it pins a section

**Interfaces:**
- Consumes: `what_if`, the broadened `well_mixed`, the labels.
- Produces: the prompt section `## After a run` in place of `## Diagnostics and options`, with the order of offers of spec 7.3.

- [ ] **Step 1: Write the failing test** (`web/tests/chat/prompt.test.ts`: replace `"## Diagnostics and options"` by `"## After a run"` in the list of headings if it is there, and add)

```ts
    for (const phrase of ["## After a run", "what_if", "the lever's label", "interventions field", "A warning diagnostic fired", "illustrative"]) expect(SYSTEM_PROMPT).toContain(phrase);
    expect(SYSTEM_PROMPT).not.toContain("## Diagnostics and options");
    expect(SYSTEM_PROMPT).not.toContain("the random network mixes");
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run tests/chat/prompt.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

The section:

```
## After a run

- run_simulation returns diagnostics: what the run's shape suggests about the configuration (an early fade-out, a peak that is only the seeding, a run that ended before the epidemic did, a fatality ratio outside the literature, and so on), each with levers. A lever is a patch of parameter paths with suggested values and the current ones, or intervention entries, or both, with a basis and often a label: a complete reply naming the change. When the user takes a lever, apply all of it with configure_simulation (its fields where they exist, advanced for the other paths, the interventions field for the entries as they are) and run again.
- A warning diagnostic fired: offer its options first, at most three, and always one that keeps the configuration as it is; offer no intervention. A baseline that is broken is fixed before it is compared.
- Otherwise: report the run, then offer up to two levers of the what_if diagnostic (interventions to try, anchored at the day 1% had been infected) by the lever's label, plus "Create a report". Say in one sentence that the effect sizes are illustrative unless the lever's basis is disease_db. A well_mixed diagnostic means nearly everyone was infected and only the depletion of susceptibles limits the epidemic: its levers are the two limits on spread (and, on the random network, the hybrid network as the structure interventions act on).
- After a run with an intervention: report the comparison (compare: the parameters that changed and the difference in peak, peak day, total infections and deaths) before interpreting, then offer another what_if lever or the report.
- Put the options among the suggested replies, each a complete message (a lever's label as it is, or the change in plain words: "Use a gamma infectious period (sd 2.4) and rerun"). The limit of three suggested replies stays. The interface also shows the what_if labels as buttons under the latest run; never tell the user to press them.
```

Keep whatever the old section said that the new one does not replace (read it in full first), and remove the sentence in "Contact networks" that still presents the hybrid network as what `well_mixed` offers ("A well_mixed diagnostic offers the hybrid network as that structure") in favour of "A well_mixed diagnostic offers the limits on spread first, and the hybrid network on the random one".

`index.ts`: `run_simulation`'s description says a lever may carry `interventions` (entries for configure_simulation's interventions field) and a `label`. README: the diagnostics list gains `what_if` and the broadened `well_mixed`; the web section mentions the buttons. Spec: status line gains "phase B shipped", with "as shipped" notes where the implementation differs (the labels' wording, the window clipped to the run, anything ruled).

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run && npm run typecheck && npm run lint`; `python -m pytest tests/test_readme.py tests/test_review_requests.py tests/test_web_exports.py -q -p no:cacheprovider`
Expected: PASS (`tests/db/schema.test.ts` may time out in a full run on this machine and passes alone).

- [ ] **Step 5: Commit**

```bash
git add web README.md docs
git commit -m "feat(web): the prompt's After a run; docs: suggested interventions as shipped"
```

---

## Self-review notes

- Spec 7.1: Task 1. 7.2: Tasks 1 (the shared list) and 2. 7.3: Task 6. 7.4: Task 5. 7.5: Task 4 (`diagnostic_shown` already lists every id). 7.6: Task 3. Section 14's "advanced refusal text": Task 4. Section 12's "After a run" and the "Contact networks" sentence: Task 6.
- The Review Focus lines are pinned by: `test_every_entry_is_one_the_schema_accepts` and `test_a_window_never_passes_the_end_of_the_run` (Task 2); `test_the_anchor_is…day_zero` (Task 2); "still matches a stored lever without the new fields" and `tryNextLabels(payload(undefined))` (Tasks 4 and 5); "records the lever when its entries were applied, and not when something else was" (Task 4); `latestRunKey` on a failed run and the live turn getting no `tryNext` (Task 5).
