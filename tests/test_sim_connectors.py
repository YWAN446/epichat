"""Spec 8.4: rel_trans is rel_trans_base × the active modifiers, every step."""
import math

import numpy as np
import pytest
import starsim as ss

from epichat.sim.connectors import TransmissibilityModifiers
from epichat.sim.models import MODELS


def build(name, connector, **pars):
    kw = dict(init_prev=ss.bernoulli(p=0.5), beta=ss.peryear(22.8125), dur_inf=ss.constant(ss.days(200)), p_death=ss.bernoulli(p=0.0))   # longer than the run: agents stay infectious
    kw.update(pars)
    sim = ss.Sim(n_agents=500, diseases=MODELS[name](**kw), networks=ss.RandomNet(n_contacts=4), connectors=connector,
                 start=ss.days(0), dur=ss.days(100), dt=ss.days(1), verbose=0, rand_seed=1)
    return sim


def test_without_seasonality_rel_trans_equals_the_base():
    sim = build("seiar", TransmissibilityModifiers("seiar"), p_asymp=ss.bernoulli(p=1.0), rel_trans_asymp=0.25, dur_exp=ss.constant(ss.days(1)))
    sim.run()
    d = sim.diseases[0]
    asymp = d.asymptomatic.uids
    assert len(asymp) > 0
    assert np.allclose(np.asarray(d.rel_trans[asymp]), 0.25)
    assert sim.connectors[0].factors[:3] == [1.0, 1.0, 1.0]


def test_seasonality_scales_the_base_with_starsims_formula():
    sim = build("seiar", TransmissibilityModifiers("seiar", seasonality_scale=0.2, seasonality_shift=0.1),
                p_asymp=ss.bernoulli(p=1.0), rel_trans_asymp=0.25, dur_exp=ss.constant(ss.days(1)))
    sim.run()
    d = sim.diseases[0]
    factors = sim.connectors[0].factors
    assert len(factors) == 101
    for ti in (0, 10, 50, 100):
        assert factors[ti] == pytest.approx(max(0.0, 1 + 0.2 * math.cos(2 * math.pi * (ti / 365 - 0.1))))
    asymp = d.asymptomatic.uids
    assert np.allclose(np.asarray(d.rel_trans[asymp]), 0.25 * factors[-1])


def test_factor_never_goes_negative():
    sim = build("sir", TransmissibilityModifiers("sir", seasonality_scale=1.0, seasonality_shift=0.5))
    sim.run()
    assert min(sim.connectors[0].factors) == 0.0 and max(sim.connectors[0].factors) <= 2.0


def test_the_connector_composes_every_writer_of_rel_sus_and_rel_trans_each_step():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({
        "disease": {"model": "sir", "beta": 50.0, "dur_inf": {"mean_days": 200}, "rel_sus_age": {"children": 1.5, "adults": 1.0, "elderly": 0.5}},
        "interventions": [{"type": "seasonality", "scale": 0.3}, {"type": "vaccine", "coverage": 0.5, "start_day": 1}],
        "demographics": {"age_pct_under18": 40.0, "age_pct_18_64": 50.0, "age_pct_over65": 10.0},
        "run": {"n_agents": 1000, "sim_dur_years": 40 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    sim.run()
    disease = sim.diseases[0]
    connector = sim.connectors[0]
    age = np.asarray(sim.people.age)
    expected_base = np.select([age < 18, age < 65], [1.5, 1.0], default=0.5)
    assert np.allclose(np.asarray(disease.rel_sus_base), expected_base)
    protection = np.asarray(disease.vaccine_protection)
    # coverage is a yearly probability: 1 − 0.5 ** (40 / 365) is about 7% of the agents after 40 days
    assert 0.03 < (protection == 0.0).mean() < 0.15 and set(np.unique(protection)) <= {0.0, 1.0}      # efficacy 1: protected or not
    assert np.allclose(np.asarray(disease.rel_sus), expected_base * protection)                     # a vaccinated agent stays protected after 40 steps
    assert np.allclose(np.asarray(disease.rel_trans), np.asarray(disease.rel_trans_base) * connector.factors[-1])


def test_sis_immunity_still_protects_under_the_connector():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"disease": {"model": "sis", "beta": 100.0, "initial_immune_frac": 0.5, "sis_waning": 0.0},
                                    "run": {"n_agents": 1000, "sim_dur_years": 30 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    sim.run()
    disease = sim.diseases[0]
    immune = np.asarray(disease.immunity) >= 1.0
    assert 0.4 < immune.mean() < 0.6
    assert np.all(np.asarray(disease.rel_sus)[immune] == 0.0)
    assert not np.any(np.asarray(disease.infected)[immune])


def _log(sim):
    import pandas as pd
    from epichat.sim.outputs import infection_log
    df = infection_log(sim).to_df()
    source = pd.to_numeric(df["source"], errors="coerce").to_numpy(dtype=float)
    t = np.array([float(getattr(x, "value", x)) for x in df["t"]])
    seeds = df["target"].to_numpy()[(t == 0) & ~(source >= 0)]
    return source, t, seeds


def test_in_a_first_generation_run_only_the_seeds_transmit_and_not_on_step_zero():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"disease": {"beta": 60.0, "seed": {"mode": "count", "value": 30}}, "run": {"n_agents": 3000, "sim_dur_years": 40 / 365, "rand_seed": 1}})
    sim = build_sim(p, first_generation=True)
    sim.run()
    source, t, seeds = _log(sim)
    caused = source >= 0
    assert len(seeds) == 30 and caused.sum() > 30                           # the seeds did infect
    assert np.isin(source[caused], seeds).all()                             # and nobody else did
    assert not (caused & (t == 0)).any()                                    # nothing on step 0


def test_a_run_that_is_not_a_pilot_spreads_past_the_seeds():
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.sim.builder import build_sim
    p = SimParamsV2.model_validate({"disease": {"beta": 60.0, "seed": {"mode": "count", "value": 30}}, "run": {"n_agents": 3000, "sim_dur_years": 40 / 365, "rand_seed": 1}})
    sim = build_sim(p)
    sim.run()
    source, t, seeds = _log(sim)
    assert not np.isin(source[source >= 0], seeds).all() and ((source >= 0) & (t == 0)).any()
