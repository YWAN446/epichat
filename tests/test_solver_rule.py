"""The rule that recommends how a scenario runs, as agents or as a compartmental model, and says why
(docs/superpowers/specs/2026-11-20-run-mode-choice-design.md)."""
import pydantic
import pytest

from epichat.params import r0
from epichat.params.schema_v2 import SimParamsV2
from epichat.params.solver import escape_root, recommend_solver


def params(r0_target=None, interventions=None, **paths):
    """The default scenario with dotted paths set (disease__model -> disease.model), at an R0 if given."""
    d = SimParamsV2().model_dump()
    for key, value in paths.items():
        *parents, leaf = key.split("__")
        node = d
        for part in parents:
            node = node[part]
        node[leaf] = value
    if interventions is not None:
        d["interventions"] = interventions
    p = SimParamsV2.model_validate(d)
    return r0.with_r0(p, r0_target) if r0_target is not None else p


def codes(p):
    return [r["code"] for r in recommend_solver(p)["reasons"]]


@pytest.mark.parametrize("code, p", [
    ("hybrid_network", lambda: params(network__network_type="hybrid")),
    ("lasting_contacts", lambda: params(network__contact_duration_days=7.0)),
    ("poisson_contacts", lambda: params(network__contacts_dist="poisson")),
    ("treatment_delay", lambda: params(interventions=[{"type": "treatment", "coverage": 0.3, "delay_days": 2}])),
])
def test_the_four_required_cases_require_agents_with_one_reason_each(code, p):
    a = recommend_solver(p())
    assert a["required"] is True and a["recommended"] == "abm" and [r["code"] for r in a["reasons"]] == [code]


def test_waning_fires_when_the_run_outlasts_immunity():
    sirs = dict(disease__model="sirs", disease__dur_immune={"mean_days": 180.0})
    assert "waning" in codes(params(run__sim_dur_years=3.0, **sirs))
    assert "waning" not in codes(params(disease__model="sirs", disease__dur_immune={"mean_days": 730.0}, run__sim_dur_years=1.0))
    assert "waning" not in codes(params(r0_target=0.9, run__sim_dur_years=3.0, **sirs))


def test_births_fire_once_births_can_restore_susceptibles():
    births = dict(demographics__use_demographics=True, demographics__birth_rate=30.0)
    assert "births" in codes(params(r0_target=15.0, run__sim_dur_years=10.0, **births))
    assert "births" not in codes(params(r0_target=15.0, run__sim_dur_years=5.0, **births))   # the next wave comes at about 5.7 years
    assert "births" not in codes(params(r0_target=2.5, run__sim_dur_years=2.0, **births))


def test_a_temporary_measure_fires_when_it_holds_r_below_one():
    def reduction(scale, end_day=30):
        return [{"type": "transmission_reduction", "scale": scale, "start_day": 0, "end_day": end_day}]
    assert "temporary_measure" in codes(params(interventions=reduction(0.7)))
    assert "temporary_measure" not in codes(params(interventions=reduction(0.3)))
    assert "temporary_measure" not in codes(params(interventions=reduction(0.7, end_day=None)))


def test_early_dieout_counts_fraction_seeds_and_needs_r0_above_one():
    a = recommend_solver(params(r0_target=1.2, disease__seed={"mode": "count", "value": 2}))
    text = next(r["text"] for r in a["reasons"] if r["code"] == "early_dieout")
    assert "2 initial infections" in text and "in 100" in text
    fraction = recommend_solver(params(r0_target=1.2, disease__seed={"mode": "fraction", "value": 0.0002}))
    assert any(r["code"] == "early_dieout" and "2 initial infections" in r["text"] for r in fraction["reasons"])
    assert "early_dieout" not in codes(params())
    assert "early_dieout" not in codes(params(r0_target=0.9, disease__seed={"mode": "count", "value": 2}))


def test_replicates_recommend_agents():
    assert codes(params(run__n_replicates=3)) == ["replicates"]


def test_nothing_depends_on_chance_in_the_default_scenario():
    a = recommend_solver(params())
    assert a["required"] is False and a["recommended"] == "abm" and codes(params()) == ["same_answer"]


def test_escape_root():
    assert escape_root(2.5) == pytest.approx(0.1074, abs=1e-4)
    assert escape_root(0.8) == 1.0


def test_run_solver_defaults_to_unset_and_takes_abm_or_ode():
    assert SimParamsV2().run.solver is None
    for value in ("abm", "ode"):
        assert params(run__solver=value).run.solver == value
    with pytest.raises(pydantic.ValidationError):
        params(run__solver="auto")


def test_waning_waits_until_a_compartmental_model_can_come_back():
    # its next wave comes after 2 to 2.5 immunity periods (constant, gamma or lognormal immunity)
    sirs = dict(disease__model="sirs", disease__dur_immune={"mean_days": 180.0})
    assert "waning" not in codes(params(run__sim_dur_years=360 / 365, **sirs))
    assert "waning" in codes(params(run__sim_dur_years=540 / 365, **sirs))


def test_a_temporary_measure_needs_an_epidemic_to_hold_back():
    reduction = [{"type": "transmission_reduction", "scale": 0.3, "start_day": 0, "end_day": 30}]
    assert "temporary_measure" not in codes(params(r0_target=0.9, interventions=reduction))


def test_prior_immunity_counts_for_early_dieout_and_temporary_measures():
    # measles at 92% immune is R 1.2 at the start: a fair share of outbreaks die out early
    assert "early_dieout" in codes(params(r0_target=15.0, disease__initial_immune_frac=0.92))
    half = params(disease__initial_immune_frac=0.5, interventions=[{"type": "transmission_reduction", "scale": 0.3, "start_day": 0, "end_day": 30}])
    assert "temporary_measure" in codes(half)


def test_a_fraction_seed_is_drawn_per_agent():
    # 5 seeds expected, drawn per agent, die out together more often than 5 fixed ones: exp(-5 (1 - s)) against s ** 5
    assert "early_dieout" in codes(params(r0_target=1.5))
    assert "early_dieout" not in codes(params(r0_target=1.5, disease__seed={"mode": "count", "value": 5}))
