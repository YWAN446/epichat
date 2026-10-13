"""extract() produces the 8.6 series and stats from a finished Starsim 3.7 sim."""
import pytest

from epichat.params.migrate import coerce_params
from epichat.params.schema_v2 import SimParamsV2
from epichat.sim.builder import build_sim
from epichat.sim.outputs import SERIES_KEYS, extract

BASE = {"day", "n_susceptible", "n_infectious", "n_infected", "new_infections", "cum_infections", "new_deaths", "cum_deaths"}
EXPECTED = {
    "sir": BASE | {"n_recovered"},
    "sis": BASE,
    "sirs": BASE | {"n_recovered"},
    "seir": BASE | {"n_recovered", "n_exposed"},
    "seirs": BASE | {"n_recovered", "n_exposed"},
    "seiar": BASE | {"n_recovered", "n_exposed", "n_asymptomatic"},
}
EXTRA = {"seir": dict(dur_exp=3.0), "seirs": dict(dur_exp=3.0, dur_immune=60.0), "seiar": dict(dur_exp=3.0), "sirs": dict(dur_immune=60.0)}


def run(name, **over):
    base = dict(disease_type=name, beta=22.8125, n_agents=500, sim_dur_years=20 / 365, rand_seed=1, init_prev=0.05, p_death=0.3)
    base.update(EXTRA.get(name, {}))
    base.update(over)
    params = coerce_params(base)
    sim = build_sim(params)
    sim.run()
    return extract(sim, params.run.n_agents, sim.seeds_day0, params.demographics.use_demographics), sim


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_series_keys_lengths_and_stats_follow_8_6(name):
    out, sim = run(name)
    series, stats = out["series"], out["stats"]
    assert set(series) == EXPECTED[name]
    assert {len(v) for v in series.values()} == {21}
    assert series["day"] == list(range(21))
    assert series["n_infected"] == series["n_infectious"]
    assert stats["sim_days"] == 21 and stats["n_agents"] == 500 and stats["seeds_day0"] == sim.seeds_day0 > 0
    assert stats["peak_infections"] == max(series["n_infectious"])
    assert stats["peak_day"] == series["n_infectious"].index(max(series["n_infectious"]))
    assert stats["total_infected"] == round(series["cum_infections"][-1])
    assert stats["total_deaths"] == round(series["cum_deaths"][-1])
    assert all(isinstance(v, float) for key in series if key != "day" for v in series[key])
    assert set(SERIES_KEYS) >= EXPECTED[name] - {"day"}


def test_cumulative_infections_count_the_day_zero_seeds_once():
    out, sim = run("sir")
    res = sim.results.sir
    assert out["series"]["new_infections"][0] == float(res.new_infections.values[0] + sim.seeds_day0)
    assert out["series"]["cum_infections"][-1] == float(res.cum_infections.values[-1] + sim.seeds_day0)
    assert out["stats"]["total_infected"] == round(res.cum_infections.values[-1]) + sim.seeds_day0


def test_delayed_seeds_are_already_in_the_disease_counts():
    p = SimParamsV2.model_validate({"disease": {"beta": 0.001, "seed": {"mode": "count", "value": 30, "day": 4}},
                                    "run": {"n_agents": 500, "sim_dur_years": 10 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    sim.run()
    out = extract(sim, 500, sim.seeds_day0, False)
    assert out["stats"]["seeds_day0"] == 0 and out["series"]["new_infections"][:4] == [0.0] * 4
    assert out["series"]["new_infections"][4] >= 30 and out["stats"]["total_infected"] >= 30


@pytest.mark.parametrize("name", ["seir", "seirs", "seiar"])
def test_n_infectious_excludes_the_exposed(name):
    out, sim = run(name)
    res = sim.results[name]
    assert out["series"]["n_infectious"] == [float(v) for v in res.n_infectious.values]
    assert out["series"]["n_exposed"] == [float(v) for v in res.n_exposed.values]


def test_seiar_n_infectious_includes_asymptomatic_agents():
    out, sim = run("seiar", p_asymp=1.0)
    assert max(out["series"]["n_asymptomatic"]) > 0
    assert out["series"]["n_infectious"] == [float(v) for v in sim.results.seiar.n_infectious.values]
    assert out["stats"]["peak_infections"] == max(out["series"]["n_infectious"])


def test_deaths_are_the_disease_deaths_and_all_causes_only_with_demographics():
    out, sim = run("sir", use_demographics=True, birth_rate=20.0, death_rate=500.0, p_death=0.0)
    assert out["stats"]["total_deaths"] == 0 and max(out["series"]["new_deaths"]) == 0
    assert out["series"]["cum_deaths_all"][-1] > 0 == out["series"]["cum_deaths"][-1]
    assert out["series"]["new_deaths_all"] == [float(v) for v in sim.results.new_deaths.values]
    plain, _ = run("sir", p_death=0.5)
    assert "cum_deaths_all" not in plain["series"] and plain["stats"]["total_deaths"] > 0
    cum = plain["series"]["cum_deaths"]
    assert all(b >= a for a, b in zip(cum, cum[1:]))


def test_seeds_stat_counts_day_zero_and_delayed_seeds():
    out, sim = run("sir")
    assert out["stats"]["seeds"] == out["stats"]["seeds_day0"] == sim.seeds_day0
    p = SimParamsV2.model_validate({"disease": {"beta": 0.001, "seed": {"mode": "count", "value": 30, "day": 4}},
                                    "run": {"n_agents": 500, "sim_dur_years": 10 / 365, "rand_seed": 1}})
    delayed = build_sim(p)
    delayed.run()
    stats = extract(delayed, 500, delayed.seeds_day0, False)["stats"]
    assert stats["seeds_day0"] == 0 and stats["seeds"] == 30


def test_measured_r0_counts_the_seeds_secondary_infections():
    from epichat.sim.outputs import measured_r0
    p = SimParamsV2.model_validate({"disease": {"beta": 100.0, "dur_inf": {"mean_days": 5}, "seed": {"mode": "count", "value": 20}},
                                    "run": {"n_agents": 2000, "sim_dur_years": 30 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    sim.run()
    r0 = measured_r0(sim)
    df = sim.analyzers["infection_log"].logs["sir"].to_df()
    seeds = df[df["source"].astype(float) < 0]["target"].to_numpy()
    assert len(seeds) == 20 and r0 == float(df["source"].isin(seeds).sum()) / 20 and r0 > 0.5
    assert extract(sim, 2000, sim.seeds_day0, False)["stats"]["r0_measured"] == r0
    quiet = SimParamsV2.model_validate({"disease": {"beta": 0.001, "seed": {"mode": "count", "value": 20}}, "run": {"n_agents": 2000, "sim_dur_years": 30 / 365, "rand_seed": 1}})
    sim = build_sim(quiet)
    sim.run()
    assert measured_r0(sim) == 0.0                                                   # seeds, but they infected nobody
    later = SimParamsV2.model_validate({"disease": {"seed": {"mode": "count", "value": 20, "day": 5}}, "run": {"n_agents": 2000, "sim_dur_years": 30 / 365, "rand_seed": 1}})
    sim = build_sim(later)
    sim.run()
    assert measured_r0(sim) is None                                                  # no day-0 seeds


def test_measured_r0_is_unknown_on_the_age_structured_network():
    # Starsim's MixingPools record no per-agent sources (−999999 for every secondary infection), so the seeds' secondary infections cannot be counted
    from epichat.sim.outputs import measured_r0
    p = SimParamsV2.model_validate({"network": {"network_type": "age_structured"},
                                    "demographics": {"age_pct_under18": 38.6, "age_pct_18_64": 57.6, "age_pct_over65": 3.8},
                                    "disease": {"seed": {"mode": "count", "value": 20}}, "run": {"n_agents": 2000, "sim_dur_years": 30 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    sim.run()
    assert sim.results.sir.cum_infections.values[-1] > 100 and measured_r0(sim) is None
    assert extract(sim, 2000, sim.seeds_day0, False)["stats"]["r0_measured"] is None
