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
