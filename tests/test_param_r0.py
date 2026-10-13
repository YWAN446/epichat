"""Spec 7.4 as revised by section 18: R0 from Starsim's exact per-contact
probability and the effective transmitting days, on both networks."""
import math

import numpy as np

import pytest

from epichat.params import r0
from epichat.params.migrate import coerce_params
from epichat.params.schema_v2 import SimParamsV2


def v2(**over) -> SimParamsV2:
    return SimParamsV2.model_validate(over)


def test_per_contact_probability_and_spectral_radius():
    assert r0.per_contact_prob(365.0) == pytest.approx(1 - math.exp(-1))
    assert r0.CONTACT_SPECTRAL_RADIUS == pytest.approx(11.0028224279, abs=1e-9)


def test_effective_days_follow_section_7_4():
    sir_const = v2(disease={"dur_inf": {"mean_days": 10}})
    sir_gamma = v2(disease={"dur_inf": {"mean_days": 10, "dist": "gamma", "sd_days": 4}})
    seir_both_const = v2(disease={"model": "seir", "dur_exp": {"mean_days": 5}, "dur_inf": {"mean_days": 10}})
    seir_exp_const = v2(disease={"model": "seir", "dur_exp": {"mean_days": 5}, "dur_inf": {"mean_days": 10, "dist": "gamma", "sd_days": 4}})
    seir_exp_gamma = v2(disease={"model": "seir", "dur_exp": {"mean_days": 5, "dist": "gamma", "sd_days": 2}, "dur_inf": {"mean_days": 10}})
    assert r0.effective_days(sir_const.disease) == 9
    assert r0.effective_days(sir_gamma.disease) == 9.5
    assert r0.effective_days(seir_both_const.disease) == 10
    assert r0.effective_days(seir_exp_const.disease) == 10.5
    assert r0.effective_days(seir_exp_gamma.disease) == 10
    assert r0.effective_days(v2(disease={"dur_inf": {"mean_days": 5.5}}).disease) == 5      # ceil(5.5) - 1
    assert r0.effective_days(v2(disease={"dur_inf": {"mean_days": 0.5}}).disease) == 0      # never transmits on a daily step


def test_random_network_r0_and_calibration_round_trip():
    p = v2(disease={"beta": 22.8125, "dur_inf": {"mean_days": 10}}, network={"n_contacts": 4})
    expected = 4 * (1 - math.exp(-22.8125 / 365)) * 9
    assert r0.approx_r0(p) == pytest.approx(expected)
    assert r0.max_r0(p) == 36.0
    for target in (1.5, 2.5, 4.0, 15.0):
        beta = r0.calibrate_beta(p, target)
        assert r0.approx_r0(r0.with_r0(p, target)) == pytest.approx(target, rel=1e-6)
        assert beta > 0


def test_seiar_asymptomatic_factor_enters_exactly():
    p = v2(disease={"model": "seiar", "dur_exp": {"mean_days": 5}, "p_asymp": 0.4, "rel_trans_asymp": 0.5})
    plain = v2(disease={"model": "seir", "dur_exp": {"mean_days": 5}})
    assert r0.asymp_factor(p.disease) == pytest.approx(0.8) and r0.asymp_factor(plain.disease) == 1.0
    assert r0.approx_r0(p) == pytest.approx(0.8 * r0.approx_r0(plain))


def test_age_structured_r0_ignores_shares_and_n_contacts():
    base = v2(network={"network_type": "age_structured", "n_contacts": 4})
    shares = v2(network={"network_type": "age_structured", "n_contacts": 40},
                demographics={"age_pct_under18": 38.6, "age_pct_18_64": 57.6, "age_pct_over65": 3.8})
    expected = r0.CONTACT_SPECTRAL_RADIUS * (1 - math.exp(-22.8125 / 365)) * 9
    assert r0.approx_r0(base) == pytest.approx(expected) and r0.approx_r0(shares) == pytest.approx(expected)
    scaled = v2(network={"network_type": "age_structured", "network_beta": 0.5})
    assert r0.approx_r0(scaled) == pytest.approx(expected / 2)
    assert r0.approx_r0(r0.with_r0(shares, 2.5)) == pytest.approx(2.5, rel=1e-6)


def test_unreachable_r0_names_the_maximum_and_the_levers():
    p = v2(network={"n_contacts": 2}, disease={"dur_inf": {"mean_days": 3}})      # max = 2 × 2 = 4
    with pytest.raises(r0.R0Unreachable) as e:
        r0.calibrate_beta(p, 4.0)
    assert e.value.maximum == 4.0 and e.value.target == 4.0
    assert e.value.levers == ("network.n_contacts", "disease.dur_inf.mean_days")
    short = v2(disease={"dur_inf": {"mean_days": 0.8}})
    with pytest.raises(r0.R0Unreachable) as e2:
        r0.calibrate_beta(short, 1.0)
    assert e2.value.maximum == 0.0
    aged = v2(network={"network_type": "age_structured"}, disease={"dur_inf": {"mean_days": 1}})
    with pytest.raises(r0.R0Unreachable) as e3:
        r0.calibrate_beta(aged, 1.0)
    assert e3.value.levers == ("network.network_beta", "disease.dur_inf.mean_days")


def test_clamp_beta_rounds_like_the_agent():
    assert r0.clamp_beta(0.00001) == 0.001 and r0.clamp_beta(5000) == 1000.0
    assert r0.clamp_beta(12.3456789) == 12.345679


def test_recalibrate_holds_r0_across_a_network_switch_and_recovers_a_changed_beta():
    before = r0.with_r0(v2(), 3.0)
    switched = before.model_copy(deep=True)
    switched.network.network_type = "age_structured"
    held = r0.recalibrate_beta(switched, 3.0, before)
    assert r0.approx_r0(held) == pytest.approx(3.0, rel=1e-6) and held.disease.beta != before.disease.beta
    raised = before.model_copy(deep=True)
    raised.disease.beta = round(before.disease.beta * 1.7, 4)
    intended = 4 * (1 - math.exp(-raised.disease.beta / 365)) * 9
    assert r0.approx_r0(r0.recalibrate_beta(raised, 3.0, before)) == pytest.approx(intended, rel=1e-6)
    stuck = v2(network={"n_contacts": 1}, disease={"dur_inf": {"mean_days": 2}})       # max 1
    assert r0.recalibrate_beta(stuck, 3.0, before).disease.beta == stuck.disease.beta


def test_migrated_v1_params_calibrate_without_the_population_weighting():
    p = coerce_params({"beta": 100.0, "network_type": "age_structured", "dur_inf": 10.0,
                       "age_pct_under18": 42.0, "age_pct_18_64": 55.0, "age_pct_over65": 3.0})
    assert r0.approx_r0(p) == pytest.approx(r0.CONTACT_SPECTRAL_RADIUS * (1 - math.exp(-100 / 365)) * 9)


def test_recalibrate_reads_a_changed_beta_on_the_network_it_was_set_on():
    """A beta set on the age-structured network means the R0 it implies there, not the random-network reading."""
    before = r0.with_r0(v2(network={"network_type": "age_structured"}), 3.0)
    raised = before.model_copy(deep=True)
    raised.disease.beta = 50.0
    out = r0.recalibrate_beta(raised, 3.0, before)
    assert out.disease.beta == pytest.approx(50.0, abs=1e-6)
    assert r0.approx_r0(out) == pytest.approx(r0.approx_r0(raised))


def test_age_shares_default_to_starsims_ages_and_read_the_fetched_shares():
    assert r0.age_shares(SimParamsV2()) == (0.3, 0.7, 0.0)
    p = SimParamsV2.model_validate({"demographics": {"age_pct_under18": 40.0, "age_pct_18_64": 55.0, "age_pct_over65": 5.0}})
    assert r0.age_shares(p) == pytest.approx((0.4, 0.55, 0.05))


def test_susceptibility_by_age_scales_the_random_network_r0_by_the_weighted_mean():
    base = SimParamsV2()
    scaled = SimParamsV2.model_validate({"disease": {"rel_sus_age": {"children": 2.0, "adults": 0.5, "elderly": 3.0}}})
    assert r0.approx_r0(scaled) == pytest.approx(r0.approx_r0(base) * (0.3 * 2.0 + 0.7 * 0.5))    # the elderly group is empty by default
    with_shares = SimParamsV2.model_validate({"disease": {"rel_sus_age": {"children": 2.0, "adults": 0.5, "elderly": 3.0}},
                                              "demographics": {"age_pct_under18": 40.0, "age_pct_18_64": 50.0, "age_pct_over65": 10.0}})
    assert r0.approx_r0(with_shares) == pytest.approx(r0.approx_r0(base) * (0.4 * 2.0 + 0.5 * 0.5 + 0.1 * 3.0))


def test_susceptibility_by_age_scales_the_age_structured_r0_by_the_column_scaled_spectral_radius():
    base = SimParamsV2.model_validate({"network": {"network_type": "age_structured"}})
    r = (1.5, 1.0, 0.7)
    scaled = SimParamsV2.model_validate({"network": {"network_type": "age_structured"},
                                         "disease": {"rel_sus_age": {"children": r[0], "adults": r[1], "elderly": r[2]}}})
    rho = float(np.linalg.eigvals(r0.CONTACT_MATRIX @ np.diag(r)).real.max())
    assert r0.approx_r0(scaled) == pytest.approx(r0.approx_r0(base) * rho / r0.CONTACT_SPECTRAL_RADIUS)
    assert r0.calibrate_beta(scaled, 4.0) == pytest.approx(-365.0 * math.log(1 - 4.0 / r0.max_r0(scaled)))


def test_presymptomatic_transmissibility_adds_the_exposed_days():
    constant = SimParamsV2.model_validate({"disease": {"model": "seir", "dur_exp": {"mean_days": 5}}})
    assert r0.exposed_days(constant.disease) == 4.0
    gamma = SimParamsV2.model_validate({"disease": {"model": "seir", "dur_exp": {"mean_days": 5, "dist": "gamma", "sd_days": 2}}})
    assert r0.exposed_days(gamma.disease) == 4.5
    assert r0.exposed_days(SimParamsV2().disease) == 0.0                                  # sir has no latent period
    half = SimParamsV2.model_validate({"disease": {"model": "seir", "dur_exp": {"mean_days": 5}, "rel_trans_exposed": 0.5}})
    assert r0.effective_days(half.disease) == pytest.approx(r0.effective_days(constant.disease) + 0.5 * 4.0)
    ignored = SimParamsV2.model_validate({"disease": {"model": "sir", "rel_trans_exposed": 0.5}})
    assert r0.effective_days(ignored.disease) == r0.effective_days(SimParamsV2().disease)


def test_weighted_cfr_follows_the_shares_and_the_scalar_fallback():
    p = SimParamsV2.model_validate({"disease": {"p_death": 0.01, "p_death_age": {"elderly": 0.2}},
                                    "demographics": {"age_pct_under18": 40.0, "age_pct_18_64": 50.0, "age_pct_over65": 10.0}})
    assert r0.weighted_cfr(p) == pytest.approx(0.4 * 0.01 + 0.5 * 0.01 + 0.1 * 0.2)
    assert r0.weighted_cfr(SimParamsV2.model_validate({"disease": {"p_death": 0.02}})) == pytest.approx(0.02)
