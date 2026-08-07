import numpy as np
import pytest
from epichat.schema import SimParams


def test_age_pct_fields_default_to_none():
    p = SimParams(beta=10.0)
    assert p.age_pct_under18 is None
    assert p.age_pct_18_64 is None
    assert p.age_pct_over65 is None


def test_age_pct_fields_accept_valid_values():
    p = SimParams(beta=10.0, age_pct_under18=40.0, age_pct_18_64=57.0, age_pct_over65=3.0)
    assert p.age_pct_under18 == 40.0
    assert p.age_pct_18_64 == 57.0
    assert p.age_pct_over65 == 3.0


def test_approx_r0_age_structured_without_age_pcts_unchanged():
    """No age_pct fields → spectral radius of unweighted POLYMOD matrix (dominant eigenvalue ≈ 11)."""
    p = SimParams(beta=100.0, network_type="age_structured", network_beta=1.0, dur_inf=10.0)
    r0 = p.approx_r0()
    # spectral radius of C ≈ 11.0; scale = 100 * 1.0 * (10/365) ≈ 2.74 → R0 ≈ 30.1
    assert pytest.approx(r0, abs=1.0) == 30.1


def test_age_pct_fields_reject_sum_not_100():
    with pytest.raises(ValueError, match="sum to 100"):
        SimParams(beta=10.0, age_pct_under18=10.0, age_pct_18_64=10.0, age_pct_over65=10.0)


def test_approx_r0_age_structured_with_age_pcts_differs_from_uniform():
    """When all age_pcts are set, R0 should reflect population-weighted NGM."""
    uniform = SimParams(beta=100.0, network_type="age_structured", network_beta=1.0, dur_inf=10.0)
    # Kenya-like: very young population, almost no elderly
    weighted = SimParams(
        beta=100.0, network_type="age_structured", network_beta=1.0, dur_inf=10.0,
        age_pct_under18=42.0, age_pct_18_64=55.0, age_pct_over65=3.0,
    )
    assert abs(uniform.approx_r0() - weighted.approx_r0()) > 0.5


def test_approx_r0_age_structured_partial_age_pcts_uses_uniform():
    """Partial age_pct fields (not all three set) must fall back to uniform POLYMOD weighting."""
    partial = SimParams(beta=100.0, network_type="age_structured", age_pct_under18=40.0)
    uniform = SimParams(beta=100.0, network_type="age_structured")
    assert partial.approx_r0() == pytest.approx(uniform.approx_r0(), rel=1e-9)


# ── country normalization ─────────────────────────────────────────────────────

def test_country_iso3_is_uppercased():
    assert SimParams(beta=1.0, country="ken").country == "KEN"
    assert SimParams(beta=1.0, country=" BRA ").country == "BRA"


def test_country_full_name_is_dropped_not_fatal():
    """The refinement LLM sometimes emits full names ('Brazil'); that must not
    invalidate the whole parameter set — the parser re-fills ISO3 later."""
    assert SimParams(beta=1.0, country="Brazil").country is None
    assert SimParams(beta=1.0, country="United States").country is None
    assert SimParams(beta=1.0, country="B1A").country is None


def test_country_none_stays_none():
    assert SimParams(beta=1.0).country is None
