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
