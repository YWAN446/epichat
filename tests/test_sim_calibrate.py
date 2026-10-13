"""Part 2, 5.7: beta calibrated to the measured R0 where the formula is approximate."""
import pytest

from epichat.params import r0
from epichat.params.schema_v2 import SimParamsV2
from epichat.sim import calibrate
from epichat.sim.builder import build_sim
from epichat.sim.outputs import extract
from epichat.sim.replicates import run_replicates

SHARES = {"age_pct_under18": 38.6, "age_pct_18_64": 57.6, "age_pct_over65": 3.8}


def hybrid(n_agents: int, target: float, **run) -> SimParamsV2:
    p = SimParamsV2.model_validate({"disease": {"dur_inf": {"mean_days": 10.0, "dist": "gamma", "sd_days": 4.0}, "p_death": 0.0,
                                                "seed": {"mode": "count", "value": 50}},
                                    "network": {"network_type": "hybrid"}, "demographics": SHARES,
                                    "run": {"n_agents": n_agents, "sim_dur_years": 1.0, "rand_seed": 1, **run}})
    return r0.with_r0(p, target)


def test_exact_networks_and_the_switch_run_no_pilot(monkeypatch):
    monkeypatch.setattr(calibrate, "measure", lambda p, seed: pytest.fail("a pilot ran on an exact network"))
    for p in (SimParamsV2(), SimParamsV2.model_validate({"network": {"network_type": "age_structured"}}),
              SimParamsV2.model_validate({"network": {"network_type": "hybrid"}, "run": {"calibrate_r0": False}})):
        assert calibrate.calibrate_by_measurement(p, 1) == (p, None)
    assert calibrate.needs_calibration(SimParamsV2.model_validate({"network": {"contact_duration_days": 7}}))


def test_pilot_params_are_short_bare_and_well_seeded():
    p = hybrid(50_000, 2.5)
    body = p.model_dump()
    body["interventions"] = [{"type": "seasonality", "scale": 0.3}]
    body["disease"]["initial_immune_frac"] = 0.4
    p = SimParamsV2.model_validate(body)
    pilot = calibrate.pilot_params(p, 7)
    assert pilot.run.sim_dur_years == pytest.approx(40 / 365) and pilot.run.rand_seed == 7 and pilot.run.n_replicates == 1
    assert pilot.disease.seed.mode == "count" and pilot.disease.seed.value == 1000 and pilot.disease.seed.day == 0     # the cap: 15% of 50k over the target is 3000
    assert pilot.interventions == [] and pilot.disease.initial_immune_frac == 0.0 and pilot.run.calibrate_r0 is False
    assert pilot.network.network_type == "hybrid" and pilot.disease.beta == p.disease.beta
    small = calibrate.pilot_params(hybrid(1000, 2.5, sim_dur_years=20 / 365), 1)
    assert small.disease.seed.value == 60 and small.run.sim_dur_years == pytest.approx(20 / 365)                       # 15% of 1000 over 2.5; never longer than the run
    assert calibrate.pilot_seeds(hybrid(200, 2.5), 2.5) == 20                                                          # the floor
    tiny = SimParamsV2.model_validate({"disease": {"seed": {"mode": "count", "value": 5}}, "run": {"n_agents": 15}})
    assert calibrate.pilot_seeds(tiny, 2.5) == 15                                                                      # never more seeds than agents
    measles = r0.with_r0(SimParamsV2.model_validate({"disease": {"dur_inf": {"mean_days": 8.0, "dist": "gamma", "sd_days": 3.0}},
                                                     "run": {"n_agents": 10000, "rand_seed": 1}}), 12.0)
    assert calibrate.pilot_params(measles, 1).disease.seed.value == 125         # 15% of the agents over the target: fewer seeds at a high R0


def test_hybrid_calibration_reaches_the_target_within_its_noise_in_at_most_three_corrections():
    p = hybrid(50_000, 2.5)
    calibrated, info = calibrate.calibrate_by_measurement(p, 1)
    assert info["target"] == pytest.approx(2.5, abs=1e-3) and info["corrections"] <= calibrate.MAX_CORRECTIONS and info["reached"] is True
    assert abs(info["measured"] - 2.5) <= max(calibrate.TOLERANCE * 2.5, calibrate.NOISE_SIGMAS * info["se"])
    fresh = calibrate.measure(calibrated, 2)                                     # another random seed, the same sterile experiment
    assert abs(fresh.mean - 2.5) / 2.5 < 0.10, fresh


def test_a_pilot_that_measures_nothing_stops_cleanly():
    body = hybrid(1000, 2.5, sim_dur_years=60 / 365).model_dump()
    body["disease"]["beta"] = 0.001
    p = SimParamsV2.model_validate(body)
    calibrated, info = calibrate.calibrate_by_measurement(p, 1)
    assert calibrated.disease.beta == 0.001 and info["corrections"] == 0 and info["measured"] in (0.0, None)


def test_run_replicates_reports_the_calibration_and_the_corrected_beta():
    p = hybrid(5000, 2.5, sim_dur_years=60 / 365)
    payload = run_replicates(p)
    info = payload["stats"]["r0_calibration"]
    assert set(info) == {"target", "measured", "se", "corrections", "reached"}
    assert payload["effective_params"]["disease"]["beta"] != p.disease.beta or info["corrections"] == 0
    assert payload["effective_params"]["network"]["network_type"] == "hybrid" and "r0_measured" in payload["stats"]
    plain = run_replicates(SimParamsV2.model_validate({"run": {"n_agents": 1000, "sim_dur_years": 30 / 365, "rand_seed": 1}}))
    assert "r0_calibration" not in plain["stats"] and plain["effective_params"]["disease"]["beta"] == SimParamsV2().disease.beta


def test_the_final_size_is_close_on_every_network_at_the_same_measured_r0():
    # the review's measurement: with beta held to the same measured R0, Covasim's hybrid layers (20/16/20 static contacts plus households)
    # are effectively well mixed, so the product must not promise a lower final size from the network alone
    def attack(network: str) -> float:
        p = r0.with_r0(SimParamsV2.model_validate({"network": {"network_type": network}, "demographics": SHARES,
                                                   "run": {"n_agents": 10000, "rand_seed": 1}}), 2.5)
        out = run_replicates(p)
        return out["stats"]["total_infected"] / 10000
    assert abs(attack("hybrid") - attack("random")) < 0.03


def _plain(target: float, dur: dict, n: int = 20000) -> SimParamsV2:
    return r0.with_r0(SimParamsV2.model_validate({"disease": {"dur_inf": dur, "p_death": 0.0}, "run": {"n_agents": n, "rand_seed": 1}}), target)


def test_the_pilot_measures_the_configured_r0_where_it_is_known():
    # the random network's formula is exact, so the sterile first-generation experiment must return it, at a low and at a high R0
    ten = [calibrate.measure(_plain(2.5, {"mean_days": 10.0, "dist": "gamma", "sd_days": 4.0}), s).mean for s in (1, 2, 3)]
    assert abs(sum(ten) / 3 - 2.5) / 2.5 < 0.04, ten
    high = [calibrate.measure(_plain(12.0, {"mean_days": 8.0, "dist": "gamma", "sd_days": 3.0}, n=10000), s).mean for s in (1, 2, 3)]
    assert abs(sum(high) / 3 - 12.0) / 12.0 < 0.10, high                        # the shipped pilot read 5.9 here


def test_a_short_infectious_period_on_the_hybrid_network_is_not_lowered():
    # flu-like: the shipped pilot lowered beta by 9%, because its seeds transmitted on an extra first step (a quarter more of a 4-day
    # period); measured as a first generation the formula's beta is within a few percent, and never needs lowering
    body = hybrid(10_000, 1.5).model_dump()
    body["disease"]["dur_inf"] = {"mean_days": 4.0, "dist": "gamma", "sd_days": 1.5}
    p = r0.with_r0(SimParamsV2.model_validate(body), 1.5)
    calibrated, info = calibrate.calibrate_by_measurement(p, 1)
    assert calibrated.disease.beta >= p.disease.beta and info["reached"] is True, info
    fresh = calibrate.measure(calibrated, 2)
    assert abs(fresh.mean - 1.5) / 1.5 < 0.10, fresh


def test_a_high_r0_on_the_hybrid_network_is_corrected_not_exploded():
    # measles-like: the shipped pilot multiplied beta by 7.4 on a measurement that could not move
    body = hybrid(10_000, 2.5).model_dump()
    body["disease"]["dur_inf"] = {"mean_days": 8.0, "dist": "gamma", "sd_days": 3.0}
    p = r0.with_r0(SimParamsV2.model_validate(body), 12.0)
    calibrated, info = calibrate.calibrate_by_measurement(p, 1)
    assert 1.2 < calibrated.disease.beta / p.disease.beta < 3.0 and info["reached"] is True, (calibrated.disease.beta / p.disease.beta, info)


def test_a_correction_stops_at_a_bound_or_when_it_does_not_help(monkeypatch):
    from epichat.sim.outputs import Measurement
    p = hybrid(2000, 2.5)
    # a network that cannot carry the target: the measurement never moves, whatever beta is
    monkeypatch.setattr(calibrate, "measure", lambda q, seed: Measurement(1.0, 0.01, 40, 1.0))
    stuck, info = calibrate.calibrate_by_measurement(p, 1)
    assert stuck.disease.beta == p.disease.beta and info["corrections"] == 0 and info["reached"] is False and info["measured"] == 1.0
    # a correction that would break network_beta × (1 − e^(−β/365)) ≤ 1 is not taken
    body = p.model_dump()
    body["network"]["network_beta"] = 10.0
    body["disease"]["beta"] = 38.0                                               # 10 × (1 − e^(−38/365)) = 0.99
    tight = SimParamsV2.model_validate(body)
    half = 0.5 * r0.approx_r0(tight)
    monkeypatch.setattr(calibrate, "measure", lambda q, seed: Measurement(half, 0.01, 40, 1.0))
    held, info = calibrate.calibrate_by_measurement(tight, 1)
    assert held.disease.beta == tight.disease.beta and info["reached"] is False
