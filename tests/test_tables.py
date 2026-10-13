"""The bundled country tables of Part 2 (sections 5.3, 5.4, 6.1, 6.2, 13)."""
import csv
from pathlib import Path

import numpy as np
import pytest

from epichat.params import tables

ROOT = Path(__file__).resolve().parent.parent


def test_every_country_in_the_indicators_table_has_a_pyramid_for_2024():
    with open(ROOT / "epichat" / "data" / "demographics" / "WPP2024_Demographic_Indicators_Medium.csv", newline="", encoding="utf-8") as f:
        iso3s = {r["ISO3_code"] for r in csv.DictReader(f) if r["ISO3_code"] and r["Time"] == "2024" and r["LocTypeName"] == "Country/Area"}
    assert len(iso3s) > 200
    assert iso3s <= set(tables.countries())


def test_kenya_has_a_pyramid_shares_a_household_size_a_matrix_and_a_birth_series():
    h = tables.age_histogram("KEN")
    assert h.shape == (101,) and 40_000 < h.sum() < 80_000            # thousands: about 56 million people
    c, a, e = tables.age_shares("ken")
    assert 0.40 < c < 0.50 and 0.02 < e < 0.05 and abs(c + a + e - 1.0) < 1e-9
    assert tables.pyramid_year(2026) == 2024 and tables.pyramid_year(2028) == 2030 and tables.age_histogram("KEN", 2030)[0] != h[0]
    assert 3.0 < tables.household_size("KEN") < 5.0 and tables.household_size("XXX") is None
    m = tables.contact_matrix("KEN")
    assert m.shape == (3, 3) and m.min() >= 0 and m[1][1] > m[2][2]
    rates = tables.birth_rate_series("KEN", 2024, 30)
    assert len(rates) == 30 and 20 < rates[0] < 35 and rates[-1] < rates[0]
    assert tables.birth_rate_series("KEN", 2049, 5)[-1] == tables.birth_rate_series("KEN", 2050, 1)[0]    # past the table: its last year
    assert tables.age_histogram("XXX") is None and tables.contact_matrix("XXX") is None and tables.birth_rate_series("XXX", 2024, 2) is None


def test_aggregation_counts_bands_and_preserves_each_targets_total():
    pop = np.ones(101)                       # a uniform population: the 15-19 band is 3/5 children, 2/5 adults
    c = tables.aggregate_contacts(np.ones((16, 16)), pop)
    for t in range(3):
        assert np.allclose(c[:, t], [3.6, 9.4, 3.0])         # children 3 bands + 3/5, adults 2/5 + 9, elderly 65-69, 70-74, 75+
    assert np.allclose(c.sum(axis=0), 16.0)                  # a target's contacts with everyone is its bands' mean row sum
    m = np.arange(256, dtype=float).reshape(16, 16)
    c = tables.aggregate_contacts(m, pop)
    rows = m.sum(axis=1)
    assert c[:, 0].sum() == pytest.approx((rows[:3].sum() + 0.6 * rows[3]) / 3.6)   # children targets: bands 0-2 fully, 3/5 of band 3


def test_aggregation_matches_an_explicit_single_age_sum_on_the_bundled_sample():
    sample = {}
    with open(ROOT / "tests" / "fixtures" / "prem_2021_sample.csv", newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            sample.setdefault(r["iso3"], np.zeros((16, 16)))[int(r["row"]), int(r["col"])] = float(r["value"])
    assert set(sample) == {"GBR", "KEN"}
    for iso3, m16 in sample.items():
        pop = tables.age_histogram(iso3)
        c = tables.aggregate_contacts(m16, pop)
        band = lambda age: min(age // 5, 15)
        band_pop = lambda b: pop[list(range(5 * b, 101 if b == 15 else 5 * b + 5))].sum()
        children = range(0, 18)
        expected = sum(pop[a] * sum(m16[band(a), band(b)] * pop[b] / band_pop(band(b)) for b in children) for a in children) / pop[list(children)].sum()
        assert c[0][0] == pytest.approx(expected, rel=1e-9)
        assert np.allclose(tables.contact_matrix(iso3), c, atol=1e-4)      # the bundled table is this function's output, rounded
