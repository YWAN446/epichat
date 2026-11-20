"""Every intervention is a Starsim delivery or modifier and moves the outcome the way it should, under either solver."""
import numpy as np
import pytest

from epichat.params.schema_v2 import SimParamsV2
from epichat.sim.builder import build_sim
from epichat.sim.outputs import extract


def run(interventions=(), network: dict | None = None, days: int = 180, **disease) -> dict:
    body = {"disease": {"seed": {"mode": "count", "value": 20}, **disease}, "network": network or {}, "interventions": list(interventions),
            "run": {"n_agents": 5000, "sim_dur_years": days / 365, "rand_seed": 1}}
    p = SimParamsV2.model_validate(body)
    sim = build_sim(p)
    sim.run()
    out = extract(sim, p)
    out["solver"] = sim.solver.name
    return out


@pytest.fixture(scope="module")
def base():
    return run()


def total(out):
    return out["stats"]["total_infected"]


def peak(out):
    return out["stats"]["peak_infections"]


def test_a_routine_vaccine_and_a_campaign_lower_the_attack_rate(base):
    routine = run([{"type": "vaccine", "coverage": 0.9, "start_day": 5}])
    campaign = run([{"type": "vaccine", "kind": "campaign", "coverage": 0.6, "start_day": 5, "end_day": 15}])
    one_day = run([{"type": "vaccine", "kind": "campaign", "coverage": 0.6, "start_day": 5, "end_day": 5}])
    assert total(campaign) < total(routine) < total(base) and total(one_day) < total(base)


def test_a_day_zero_entry_not_folded_into_initial_immunity_protects_from_the_start(base):
    leaky = run([{"type": "vaccine", "coverage": 0.6, "start_day": 0, "efficacy": 0.8}])
    yearly = run([{"type": "vaccine", "coverage": 0.6, "start_day": 1, "efficacy": 0.8}])
    assert total(leaky) < 0.5 * total(base) and total(leaky) < total(yearly)


def test_an_age_targeted_vaccine_does_less_than_one_for_everyone(base):
    window = {"type": "vaccine", "kind": "campaign", "coverage": 0.6, "start_day": 5, "end_day": 15}
    children = run([{**window, "age_max": 18}])
    everyone = run([window])
    assert total(everyone) < total(children) < total(base)


def test_waning_vaccine_protection_lets_more_people_be_infected():
    window = {"type": "vaccine", "kind": "campaign", "coverage": 0.6, "start_day": 5, "end_day": 15}
    lasting = run([window], days=365)
    waning = run([{**window, "protection_days": 20}], days=365)
    assert total(waning) > total(lasting)


def test_treatment_cuts_transmission_and_a_capacity_limits_it(base):
    treated = run([{"type": "treatment", "coverage": 0.2}])
    capped = run([{"type": "treatment", "coverage": 0.2, "capacity": 2}])
    assert total(treated) < total(capped) < total(base)


def test_a_delayed_treatment_runs_as_agents_and_still_helps(base):
    delayed = run([{"type": "treatment", "coverage": 0.5, "delay_days": 2}])
    assert delayed["solver"] == "abm" and total(delayed) < total(base)


@pytest.mark.parametrize("delay", [0, 2])
def test_a_treatment_is_offered_every_day_from_the_delay_on_as_without_one(delay):
    # 20 seeds infectious for 20 days and almost no transmission: offered at 30% a day once the delay has passed, nearly all are
    # treated (1 - 0.7^18 of them even after a 2-day delay), and nobody before it; a delay only moves when the offers start
    body = {"disease": {"seed": {"mode": "count", "value": 20}, "beta": 0.001, "dur_inf": {"mean_days": 20.0}},
            "network": {"contacts_dist": "poisson"}, "run": {"n_agents": 2000, "sim_dur_years": 30 / 365, "rand_seed": 1},
            "interventions": [{"type": "treatment", "coverage": 0.3, "efficacy": 1.0, "delay_days": delay}]}
    sim = build_sim(SimParamsV2.model_validate(body))
    sim.run()
    cured = np.asarray(sim.results.treatment_0.cured.values, dtype=float)
    assert cured[:delay].sum() == 0 and cured.sum() >= 18


def test_a_delayed_treatment_for_the_symptomatic_reaches_only_the_symptomatic():
    # every infection asymptomatic except the 20 seeds, who start symptomatic: a delayed treatment of the symptomatic treats at most
    # the seeds, and one of everyone infectious the asymptomatic too
    def treated(symptomatic_only: bool) -> float:
        body = {"disease": {"seed": {"mode": "count", "value": 20}, "model": "seiar", "dur_exp": {"mean_days": 3.0}, "p_asymp": 1.0},
                "network": {"contacts_dist": "poisson"}, "run": {"n_agents": 5000, "sim_dur_years": 180 / 365, "rand_seed": 1},
                "interventions": [{"type": "treatment", "coverage": 1.0, "efficacy": 1.0, "delay_days": 2, "symptomatic_only": symptomatic_only}]}
        sim = build_sim(SimParamsV2.model_validate(body))
        sim.run()
        assert sim.solver.name == "abm"
        return float(np.sum(sim.results.treatment_0.delivered.values))
    assert treated(True) <= 20 < treated(False)


def test_isolation_reaches_whoever_the_treatment_is_for():
    # every infection asymptomatic: isolation for a treatment of everyone infectious more than halves the peak; for the symptomatic
    # only, it reaches just the seeds (who start symptomatic) and most of the peak stays
    seiar = dict(model="seiar", dur_exp={"mean_days": 3.0}, p_asymp=1.0)
    isolation = {"type": "treatment", "coverage": 0.0, "rel_trans_treated": 0.5}
    untreated = run(**seiar)
    everyone = run([isolation], **seiar)
    symptomatic = run([{**isolation, "symptomatic_only": True}], **seiar)
    assert peak(everyone) < 0.5 * peak(untreated) < peak(symptomatic)


def test_isolation_starts_with_the_offers_once_the_delay_has_passed():
    # full isolation and nobody treated: without a delay the seeds infect nobody; after a 2-day delay, everyone transmits for 2 days first
    isolation = {"type": "treatment", "coverage": 0.0, "rel_trans_treated": 0.0}
    agents = {"contacts_dist": "poisson"}                                   # agents in both, as a delay needs
    at_once = run([isolation], network=agents)
    after_two_days = run([{**isolation, "delay_days": 2}], network=agents)
    assert total(at_once) == 20 < total(after_two_days)


def test_isolation_while_treatment_runs_lowers_transmission(base):
    isolated = run([{"type": "treatment", "coverage": 0.0, "rel_trans_treated": 0.5}])
    assert peak(isolated) < 0.5 * peak(base)


def test_seasonality_raises_or_lowers_early_transmission_by_its_phase(base):
    high = run([{"type": "seasonality", "scale": 0.5, "shift": 0.0}])
    low = run([{"type": "seasonality", "scale": 0.5, "shift": 0.5}])
    assert high["stats"]["peak_day"] < base["stats"]["peak_day"] < low["stats"]["peak_day"]


@pytest.mark.parametrize("kind", ("transmission_reduction", "contact_reduction"))
def test_a_reduction_lowers_the_peak_only_inside_its_window(base, kind):
    reduced = run([{"type": kind, "scale": 0.5, "start_day": 10, "end_day": 60}])
    assert peak(reduced) < 0.5 * peak(base)
    assert reduced["series"]["new_infections"][:10] == pytest.approx(base["series"]["new_infections"][:10])


def test_the_behaviour_response_flattens_the_peak(base):
    response = run([{"type": "behavior_response", "scale": 0.6}])
    assert peak(response) < 0.5 * peak(base) and total(response) < total(base)
    assert 0 < response["stats"]["behavior"]["min_factor"] < 1


def test_closing_a_hybrid_layer_removes_its_transmission():
    hybrid = {"network_type": "hybrid"}
    open_layers = run(network=hybrid, days=60, beta=5.0)
    community = run([{"type": "contact_reduction", "layer": "community", "scale": 1.0}], network=hybrid, days=60, beta=5.0)
    everything = run([{"type": "contact_reduction", "layer": "all", "scale": 1.0}], network=hybrid, days=60, beta=5.0)
    assert open_layers["solver"] == "abm"
    assert total(everything) == 20 and total(community) < total(open_layers)
    assert np.sum(everything["series"]["new_infections"][1:]) == 0
