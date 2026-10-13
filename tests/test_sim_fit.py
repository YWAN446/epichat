"""Part 2, 7.7: a lever bisected on a log scale until one outcome the participant knows is reached."""
import pytest

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
    # 45 sits between the default R0's peak (day 32) and the latest peak an epidemic reaches here (about day 51 just above threshold);
    # a later target is unreachable: below the threshold the outbreak fades and the peak is the seeds' bump
    fitted, info = fit.fit_lever(scenario("peak_day", 45), 1)
    assert abs(info["achieved"] - 45) <= 3 and info["runs"] <= fit.MAX_RUNS and fitted.disease.beta == info["value"]


def test_an_unreachable_fit_stops_at_the_levers_bound():
    p = scenario("attack_rate", 0.9, n_agents=2000)
    body = p.model_dump()
    body["network"]["n_contacts"] = 1
    body["disease"]["dur_inf"] = {"mean_days": 2.0, "dist": "constant", "sd_days": None}
    fitted, info = fit.fit_lever(SimParamsV2.model_validate(body), 1)
    assert info["runs"] <= fit.MAX_RUNS and info["achieved"] < 0.9 and fitted.disease.beta == 1000.0            # the registry's upper bound


def test_the_replicates_run_with_the_fitted_lever_and_skip_the_pilot():
    p = scenario("attack_rate", 0.5, n_agents=5000, n_replicates=2)                      # 0.5 (R0 about 1.6) is far from criticality: both seeds land near it
    payload = run_replicates(p)
    assert set(payload["stats"]["fit"]) == {"target", "wanted", "achieved", "lever", "value", "runs"}
    assert payload["effective_params"]["disease"]["beta"] == payload["stats"]["fit"]["value"]
    assert all(abs(s["total_infected"] / 5000 - 0.5) < 0.08 for s in payload["replicates"]["stats"])
    body = p.model_dump()
    body["network"]["network_type"] = "hybrid"
    hybrid = run_replicates(SimParamsV2.model_validate({**body, "run": {**body["run"], "n_replicates": 1}}))
    assert "fit" in hybrid["stats"] and "r0_calibration" not in hybrid["stats"]                                  # the fit supersedes the pilot


def test_an_unreachable_fit_stops_at_the_joint_bound_of_the_two_levers_without_raising():
    # review I1: network.network_beta × (1 − e^(−β/365)) ≤ 1 cuts the registry's bound; the search ends there instead of raising
    import math
    body = scenario("attack_rate", 0.99, n_agents=2000).model_dump()
    body["disease"]["beta"] = 300.0
    body["disease"]["dur_inf"] = {"mean_days": 2.0, "dist": "constant", "sd_days": None}
    body["network"]["n_contacts"] = 1
    body["run"]["fit"]["lever"] = "network.network_beta"
    fitted, info = fit.fit_lever(SimParamsV2.model_validate(body), 1)
    bound = 1 / (1 - math.exp(-300 / 365))
    assert info["runs"] <= fit.MAX_RUNS and info["achieved"] < 0.99
    assert fitted.network.network_beta == pytest.approx(bound, rel=1e-4) and fitted.network.network_beta <= bound


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


def test_the_pilot_runs_before_a_fit_that_does_not_move_beta():
    body = varied("attack_rate", 0.5, "disease.rel_sus_cv", n_agents=5000).model_dump()
    body["network"]["network_type"] = "hybrid"
    payload = run_replicates(SimParamsV2.model_validate(body))
    assert "fit" in payload["stats"] and "r0_calibration" in payload["stats"]      # the fit keeps R0, so the pilot still sets beta
    assert payload["effective_params"]["disease"]["rel_sus_cv"] == payload["stats"]["fit"]["value"]
    beta_fit = scenario("attack_rate", 0.5, n_agents=5000).model_dump()
    beta_fit["network"]["network_type"] = "hybrid"
    payload = run_replicates(SimParamsV2.model_validate(beta_fit))
    assert "fit" in payload["stats"] and "r0_calibration" not in payload["stats"]  # a fit on beta still replaces the pilot
