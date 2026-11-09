"""R0 and beta: each contact transmits at network_beta × beta / 365 a day over the transmission-weighted mean days of an infection."""
import numpy as np
import pytest

from epichat.params import r0
from epichat.params.migrate import coerce_params
from epichat.params.schema_v2 import SimParamsV2

RATE = 22.8125 / 365            # the default beta's rate per contact per day


def v2(**over) -> SimParamsV2:
    return SimParamsV2.model_validate(over)


def test_per_contact_rate_and_spectral_radius():
    assert r0.per_contact_rate(365.0) == 1.0 and r0.per_contact_rate(22.8125) == pytest.approx(RATE)
    assert r0.CONTACT_SPECTRAL_RADIUS == pytest.approx(11.0028224279, abs=1e-9)


def test_effective_days_are_the_plain_means():
    gamma = {"mean_days": 10, "dist": "gamma", "sd_days": 4}
    assert r0.effective_days(v2(disease={"dur_inf": {"mean_days": 10}}).disease) == 10
    assert r0.effective_days(v2(disease={"dur_inf": gamma}).disease) == 10
    assert r0.effective_days(v2(disease={"dur_inf": {"mean_days": 0.5}}).disease) == 0.5
    seir = v2(disease={"model": "seir", "dur_exp": {"mean_days": 5}, "dur_inf": gamma})
    assert r0.exposed_days(seir.disease) == 5 and r0.effective_days(seir.disease) == 10           # the latent days count only at rel_trans_exposed
    assert r0.exposed_days(SimParamsV2().disease) == 0.0


def test_the_default_scenario_is_r0_two_and_a_half():
    assert r0.approx_r0(SimParamsV2()) == pytest.approx(4 * RATE * 10) == pytest.approx(2.5)


def test_random_network_r0_and_calibration_round_trip():
    p = v2(network={"n_contacts": 4})
    assert r0.max_r0(p) == pytest.approx(4 * 1000 / 365 * 10)
    for target in (0.5, 1.5, 2.5, 4.0, 15.0):
        assert r0.calibrate_beta(p, target) == pytest.approx(365 * target / 40)
        assert r0.approx_r0(r0.with_r0(p, target)) == pytest.approx(target, rel=1e-5)


def test_network_beta_scales_r0_linearly():
    assert r0.approx_r0(v2(network={"network_beta": 0.5})) == pytest.approx(1.25)


def test_seiar_asymptomatic_factor_enters_exactly():
    p = v2(disease={"model": "seiar", "dur_exp": {"mean_days": 5}, "p_asymp": 0.4, "rel_trans_asymp": 0.5})
    plain = v2(disease={"model": "seir", "dur_exp": {"mean_days": 5}})
    assert r0.asymp_factor(p.disease) == pytest.approx(0.8) and r0.asymp_factor(plain.disease) == 1.0
    assert r0.approx_r0(p) == pytest.approx(0.8 * r0.approx_r0(plain))


def test_presymptomatic_transmission_adds_the_exposed_days_whatever_the_track():
    half = v2(disease={"model": "seir", "dur_exp": {"mean_days": 5}, "rel_trans_exposed": 0.5})
    assert r0.effective_days(half.disease) == pytest.approx(10 + 0.5 * 5)
    assert r0.effective_days(v2(disease={"model": "sir", "rel_trans_exposed": 0.5}).disease) == 10      # sir has no latent period
    p = v2(disease={"model": "seiar", "dur_exp": {"mean_days": 5}, "p_asymp": 0.8, "rel_trans_asymp": 0.0, "rel_trans_exposed": 1.0})
    assert r0.effective_days(p.disease) == pytest.approx(10 * 0.2 + 5)


def test_age_structured_r0_ignores_shares_and_n_contacts():
    base = v2(network={"network_type": "age_structured", "n_contacts": 4})
    shares = v2(network={"network_type": "age_structured", "n_contacts": 40},
                demographics={"age_pct_under18": 38.6, "age_pct_18_64": 57.6, "age_pct_over65": 3.8})
    expected = r0.CONTACT_SPECTRAL_RADIUS * RATE * 10
    assert r0.approx_r0(base) == pytest.approx(expected) and r0.approx_r0(shares) == pytest.approx(expected)
    assert r0.approx_r0(v2(network={"network_type": "age_structured", "network_beta": 0.5})) == pytest.approx(expected / 2)
    assert r0.approx_r0(r0.with_r0(shares, 2.5)) == pytest.approx(2.5, rel=1e-5)


def test_the_configured_contact_matrix_drives_the_age_structured_r0():
    base = v2(network={"network_type": "age_structured"})
    assert np.array_equal(r0.contact_matrix(base), r0.CONTACT_MATRIX)
    doubled = v2(network={"network_type": "age_structured", "contacts": {k: 2 * v for k, v in base.network.contacts.model_dump().items()}})
    assert r0.approx_r0(doubled) == pytest.approx(2 * r0.approx_r0(base))
    held = r0.recalibrate_beta(doubled, r0.approx_r0(base), base)      # fetch_demographics holds the confirmed R0 across the matrix change
    assert r0.approx_r0(held) == pytest.approx(r0.approx_r0(base), rel=1e-5) and held.disease.beta < base.disease.beta


def test_susceptibility_by_age_scales_r0_by_the_weighted_mean_or_the_column_scaled_spectral_radius():
    r = {"children": 2.0, "adults": 0.5, "elderly": 3.0}
    scaled = v2(disease={"rel_sus_age": r})
    assert r0.approx_r0(scaled) == pytest.approx(2.5 * (0.29 * 2.0 + 0.61 * 0.5 + 0.10 * 3.0))         # the world's ages by default
    aged = v2(network={"network_type": "age_structured"}, disease={"rel_sus_age": r})
    rho = float(np.linalg.eigvals(r0.CONTACT_MATRIX @ np.diag([2.0, 0.5, 3.0])).real.max())
    assert r0.approx_r0(aged) == pytest.approx(rho * RATE * 10)


def test_unreachable_r0_names_the_maximum_and_the_levers():
    p = v2(network={"n_contacts": 1}, disease={"dur_inf": {"mean_days": 0.5}})        # max 1000 / 365 × 0.5
    with pytest.raises(r0.R0Unreachable) as e:
        r0.calibrate_beta(p, 2.0)
    assert e.value.maximum == pytest.approx(1000 / 365 * 0.5) and e.value.target == 2.0
    assert e.value.levers == ("network.n_contacts", "disease.dur_inf.mean_days")
    with pytest.raises(r0.R0Unreachable) as e:
        r0.calibrate_beta(v2(network={"network_type": "age_structured", "network_beta": 0.01}, disease={"dur_inf": {"mean_days": 0.5}}), 2.0)
    assert e.value.levers == r0.AGE_LEVERS


def test_clamp_beta_rounds_like_the_agent():
    assert r0.clamp_beta(0.00001) == 0.001 and r0.clamp_beta(5000) == 1000.0
    assert r0.clamp_beta(12.3456789) == 12.345679


def test_recalibrate_holds_r0_across_a_network_switch_and_recovers_a_changed_beta():
    before = r0.with_r0(v2(), 3.0)
    switched = before.model_copy(deep=True)
    switched.network.network_type = "age_structured"
    held = r0.recalibrate_beta(switched, 3.0, before)
    assert r0.approx_r0(held) == pytest.approx(3.0, rel=1e-5) and held.disease.beta != before.disease.beta
    raised = before.model_copy(deep=True)
    raised.disease.beta = round(before.disease.beta * 1.7, 4)
    assert r0.approx_r0(r0.recalibrate_beta(raised, 3.0, before)) == pytest.approx(4 * raised.disease.beta / 365 * 10, rel=1e-5)
    stuck = v2(network={"n_contacts": 1}, disease={"dur_inf": {"mean_days": 0.5}})
    assert r0.recalibrate_beta(stuck, 3.0, before).disease.beta == stuck.disease.beta


def test_recalibrate_reads_a_changed_beta_on_the_network_it_was_set_on():
    before = r0.with_r0(v2(network={"network_type": "age_structured"}), 3.0)
    raised = before.model_copy(deep=True)
    raised.disease.beta = 50.0
    out = r0.recalibrate_beta(raised, 3.0, before)
    assert out.disease.beta == pytest.approx(50.0, abs=1e-5) and r0.approx_r0(out) == pytest.approx(r0.approx_r0(raised))


def test_migrated_v1_params_read_the_same_formula():
    p = coerce_params({"beta": 100.0, "network_type": "age_structured", "dur_inf": 10.0,
                       "age_pct_under18": 42.0, "age_pct_18_64": 55.0, "age_pct_over65": 3.0})
    assert r0.approx_r0(p) == pytest.approx(r0.CONTACT_SPECTRAL_RADIUS * 100 / 365 * 10)


def test_age_shares_default_to_the_worlds_and_read_the_fetched_shares():
    assert r0.age_shares(SimParamsV2()) == (0.29, 0.61, 0.10)
    p = v2(demographics={"age_pct_under18": 40.0, "age_pct_18_64": 55.0, "age_pct_over65": 5.0})
    assert r0.age_shares(p) == pytest.approx((0.4, 0.55, 0.05))


def test_weighted_cfr_follows_the_shares_and_the_scalar_fallback():
    p = v2(disease={"p_death": 0.01, "p_death_age": {"elderly": 0.2}},
           demographics={"age_pct_under18": 40.0, "age_pct_18_64": 50.0, "age_pct_over65": 10.0})
    assert r0.weighted_cfr(p) == pytest.approx(0.4 * 0.01 + 0.5 * 0.01 + 0.1 * 0.2)
    assert r0.weighted_cfr(v2(disease={"p_death": 0.02})) == pytest.approx(0.02)


def test_hybrid_r0_sums_the_layers_weighted_by_their_transmissibility():
    p = v2(network={"network_type": "hybrid"})          # defaults: household 2, contacts 20/16/20, betas 3/0.6/0.6/0.3, ages 6-22 and 22-65
    shares = r0.DEFAULT_AGE_SHARES
    school, work = r0.age_range_share(shares, 6, 22), r0.age_range_share(shares, 22, 65)
    assert school == pytest.approx(0.29 * 12 / 18 + 0.61 * 4 / 47) and work == pytest.approx(0.61 * 43 / 47)
    assert r0.age_range_share(shares, 0, 95) == pytest.approx(1.0)
    contacts = 3.0 * 2.0 + 0.6 * 20 * school + 0.6 * 16 * work + 0.3 * 20
    assert r0.hybrid_contacts(p) == pytest.approx(contacts) and r0.approx_r0(p) == pytest.approx(contacts * RATE * 10)
    assert r0.r0_is_approximate(p) and r0.r0_is_approximate(v2(network={"contact_duration_days": 7}))
    assert not r0.r0_is_approximate(v2()) and not r0.r0_is_approximate(v2(network={"network_type": "age_structured"}))
    with pytest.raises(r0.R0Unreachable) as e:
        r0.calibrate_beta(p, 1000.0)
    assert e.value.levers == r0.HYBRID_LEVERS
    assert r0.approx_r0(r0.with_r0(p, 2.5)) == pytest.approx(2.5, rel=1e-5)
