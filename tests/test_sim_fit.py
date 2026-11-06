"""Part 2, 7.7: a lever bisected until one outcome the participant knows is reached."""
import pytest

from epichat.params.r0 import with_r0
from epichat.params.schema_v2 import SimParamsV2
from epichat.sim import fit
from epichat.sim.replicates import run_replicates


def scenario(target: str, value: float, **run) -> SimParamsV2:
    return SimParamsV2.model_validate({"disease": {"dur_inf": {"mean_days": 10.0, "dist": "gamma", "sd_days": 4.0}, "p_death": 0.0, "seed": {"mode": "count", "value": 50}},
                                       "run": {"n_agents": 10000, "sim_dur_years": 1.0, "rand_seed": 1, "fit": {"target": target, "value": value}, **run}})


def test_outcomes_and_tolerances():
    stats = {"total_infected": 3000, "peak_day": 60, "peak_infections": 400}
    assert fit.outcome(stats, "attack_rate", 10000) == 0.3 and fit.outcome(stats, "peak_day", 10000) == 60 and fit.outcome(stats, "peak_infections", 10000) == 400
    assert fit.within("attack_rate", 0.31, 0.3) and not fit.within("attack_rate", 0.33, 0.3)
    assert fit.within("peak_day", 63, 60) and not fit.within("peak_day", 64, 60)
    assert fit.within("peak_infections", 419, 400) and not fit.within("peak_infections", 425, 400)


def test_no_fit_runs_nothing(monkeypatch):
    monkeypatch.setattr(fit, "evaluate", lambda p, seed: pytest.fail("a run happened without a fit"))
    p = SimParamsV2()
    assert fit.fit_lever(p, 1) == (p, None)


def test_the_attack_rate_is_fitted_within_two_points_in_at_most_eight_runs():
    p = scenario("attack_rate", 0.3)
    fitted, info = fit.fit_lever(p, 1)
    assert info["target"] == "attack_rate" and info["wanted"] == 0.3 and info["lever"] == "disease.beta" and info["runs"] <= fit.MAX_RUNS
    assert abs(info["achieved"] - 0.3) <= 0.02 and fitted.disease.beta == info["value"] and fitted.disease.beta != p.disease.beta


def test_the_peak_day_is_fitted_within_three_days():
    fitted, info = fit.fit_lever(scenario("peak_day", 45), 1)
    assert abs(info["achieved"] - 45) <= 3 and info["runs"] <= fit.MAX_RUNS and fitted.disease.beta == info["value"]


def test_an_unreachable_fit_stops_at_the_levers_bound():
    p = scenario("attack_rate", 0.9, n_agents=2000)
    body = p.model_dump()
    body["network"]["n_contacts"] = 1
    body["network"]["network_beta"] = 0.1                                              # R0 0.55 at the largest beta
    body["disease"]["dur_inf"] = {"mean_days": 2.0, "dist": "constant", "sd_days": None}
    fitted, info = fit.fit_lever(SimParamsV2.model_validate(body), 1)
    assert info["runs"] <= fit.MAX_RUNS and info["achieved"] < 0.9 and fitted.disease.beta == 1000.0            # the registry's upper bound


def test_the_replicates_run_with_the_fitted_lever():
    p = scenario("attack_rate", 0.5, n_agents=5000, n_replicates=2)
    payload = run_replicates(p)
    assert set(payload["stats"]["fit"]) == {"target", "wanted", "achieved", "lever", "value", "runs"}
    assert payload["effective_params"]["disease"]["beta"] == payload["stats"]["fit"]["value"]
    assert "replicates" not in payload and abs(payload["stats"]["total_infected"] / 5000 - 0.5) <= 0.02        # an ODE runs once


def test_a_fit_on_the_hybrid_network_runs_as_agents_and_its_replicates_land_near_the_target():
    body = scenario("attack_rate", 0.5, n_agents=3000, n_replicates=2).model_dump()
    body["network"]["network_type"] = "hybrid"
    payload = run_replicates(SimParamsV2.model_validate(body))
    assert payload["stats"]["solver"] == "abm" and payload["stats"]["fit"]["runs"] <= fit.MAX_RUNS
    assert all(abs(s["total_infected"] / 3000 - 0.5) < 0.1 for s in payload["replicates"]["stats"])


def varied(target: str, value: float, lever: str, cv: float = 0.0, response: dict | None = None, **run) -> SimParamsV2:
    body = scenario(target, value, **run).model_dump()
    body["disease"]["rel_sus_cv"] = cv
    if response is not None:
        body["interventions"] = [{"type": "behavior_response", **response}]
    body["run"]["fit"]["lever"] = lever
    return SimParamsV2.model_validate(body)


def test_the_variation_is_fitted_to_an_attack_rate_and_beta_stays():
    p = varied("attack_rate", 0.6, "disease.rel_sus_cv")
    fitted, info = fit.fit_lever(p, 1)
    assert info["lever"] == "disease.rel_sus_cv" and info["runs"] <= fit.MAX_RUNS and abs(info["achieved"] - 0.6) <= 0.02, info
    assert fitted.disease.beta == p.disease.beta and fitted.disease.rel_sus_cv == info["value"] and 0.5 < info["value"] < 1.6, info


def test_the_behaviour_response_is_fitted_to_an_attack_rate():
    p = varied("attack_rate", 0.7, "behavior_response.scale", response={"scale": 0.2, "half_prevalence": 0.01})
    fitted, info = fit.fit_lever(p, 1)
    entry = next(i for i in fitted.interventions if i.type == "behavior_response")
    assert abs(info["achieved"] - 0.7) <= 0.02 and info["runs"] <= fit.MAX_RUNS and entry.scale == info["value"] and fitted.disease.beta == p.disease.beta, info
    assert entry.half_prevalence == 0.01 and 0.2 < entry.scale < 0.95


def test_a_falling_lever_that_cannot_reach_the_target_ends_at_its_bound():
    high = varied("attack_rate", 0.99, "disease.rel_sus_cv", cv=1.0)             # no variation at all still infects fewer than 99%
    fitted, info = fit.fit_lever(high, 1)
    assert info["runs"] <= fit.MAX_RUNS and fitted.disease.rel_sus_cv == 0.0 and info["achieved"] < 0.99, info
    low = varied("attack_rate", 0.05, "behavior_response.scale", response={"scale": 0.5})
    fitted, info = fit.fit_lever(low, 1)
    entry = next(i for i in fitted.interventions if i.type == "behavior_response")
    assert info["runs"] <= fit.MAX_RUNS and entry.scale == pytest.approx(0.95) and info["achieved"] > 0.05, info


def test_a_lever_at_zero_starts_at_a_half_and_the_levers_know_their_direction():
    assert fit.LEVERS["disease.beta"].rising and fit.LEVERS["network.network_beta"].rising
    assert not fit.LEVERS["disease.rel_sus_cv"].rising and not fit.LEVERS["behavior_response.scale"].rising
    assert fit.LEVERS["disease.rel_sus_cv"].bounds == (0.0, 2.0) and fit.LEVERS["behavior_response.scale"].bounds == (0.0, 0.95)
    seen = []
    original = fit.evaluate

    def spy(p, seed):
        seen.append(p.disease.rel_sus_cv)
        return original(p, seed)

    fit.evaluate = spy
    try:
        fit.fit_lever(varied("attack_rate", 0.6, "disease.rel_sus_cv"), 1)
    finally:
        fit.evaluate = original
    assert seen[0] == 0.5                                                          # a variation of 0 cannot be doubled


def _flattened(scale: float, wanted: float, lever: str) -> SimParamsV2:
    """R0 1.5 with a 1% seeding over 120 days: a strong response holds the peak near the seeds while the infections go on."""
    body = {"disease": {"dur_inf": {"mean_days": 10.0, "dist": "gamma", "sd_days": 4.0}, "p_death": 0.0, "seed": {"mode": "fraction", "value": 0.01}},
            "interventions": [{"type": "behavior_response", "scale": scale}],
            "run": {"n_agents": 10000, "sim_dur_years": 120 / 365, "rand_seed": 1, "fit": {"target": "attack_rate", "value": wanted, "lever": lever}}}
    return with_r0(SimParamsV2.model_validate(body), 1.5)


def test_a_flattened_epidemic_is_not_a_fade_out():
    # the peak criterion of a fade-out is for the peak day: on an attack rate the plateau a response makes is not a fade-out
    p = _flattened(0.3, 0.10, "behavior_response.scale")
    fitted, info = fit.fit_lever(p, 1)
    entry = next(i for i in fitted.interventions if i.type == "behavior_response")
    assert abs(info["achieved"] - 0.10) <= 0.02 and entry.scale > 0.6 and info["runs"] <= fit.MAX_RUNS, info
    p = _flattened(0.6, 0.05, "disease.beta")
    fitted, info = fit.fit_lever(p, 1)
    assert abs(info["achieved"] - 0.05) <= 0.02 and fitted.disease.beta < p.disease.beta, info


