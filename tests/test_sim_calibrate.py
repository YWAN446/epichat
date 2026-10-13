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
    assert pilot.disease.seed.mode == "count" and pilot.disease.seed.value == 300 and pilot.disease.seed.day == 0      # min(300, 2% of 50k)
    assert pilot.interventions == [] and pilot.disease.initial_immune_frac == 0.0 and pilot.run.calibrate_r0 is False
    assert pilot.network.network_type == "hybrid" and pilot.disease.beta == p.disease.beta
    small = calibrate.pilot_params(hybrid(1000, 2.5, sim_dur_years=20 / 365), 1)
    assert small.disease.seed.value == 20 and small.run.sim_dur_years == pytest.approx(20 / 365)                       # the floor; never longer than the run


def test_hybrid_calibration_lands_within_five_percent_in_at_most_three_corrections():
    p = hybrid(50_000, 2.5)
    calibrated, info = calibrate.calibrate_by_measurement(p, 1)
    assert info["target"] == pytest.approx(2.5, abs=1e-3) and info["corrections"] <= calibrate.MAX_CORRECTIONS
    assert abs(info["measured"] - 2.5) / 2.5 <= calibrate.TOLERANCE
    assert calibrated.disease.beta != p.disease.beta or info["corrections"] == 0
    body = calibrated.model_dump()
    body["disease"]["seed"] = {"mode": "count", "value": 500, "day": 0}
    body["run"].update(sim_dur_years=60 / 365, calibrate_r0=False)
    sim = build_sim(SimParamsV2.model_validate(body), seed=2)
    sim.run()
    assert abs(extract(sim, 50_000, sim.seeds_day0, False)["stats"]["r0_measured"] - 2.5) / 2.5 < 0.12               # a fresh seed, 500 seeds


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
    assert set(info) == {"target", "measured", "corrections"}
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
