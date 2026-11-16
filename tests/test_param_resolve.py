"""The v2 port of generator.resolve_demographics: fill country data into
defaults and re-solve beta for the held R0 with the exact formula."""
from unittest.mock import patch

import pytest

from epichat.params import r0
from epichat.params.resolve import resolve_demographics
from epichat.params.schema_v2 import SimParamsV2

DEMO = {"birth_rate": 28.1, "death_rate": 7.9, "source": "UN WPP 2024"}


def v2(**over) -> SimParamsV2:
    return SimParamsV2.model_validate(over)


def test_without_a_country_or_with_auto_off_nothing_changes():
    p = v2()
    assert resolve_demographics(p) == p
    off = v2(demographics={"country": "KEN", "auto_demographics": False})
    assert resolve_demographics(off) == off


def test_fills_default_rates_and_holds_r0_when_contacts_change():
    p = r0.with_r0(v2(demographics={"country": "KEN"}), 3.0)
    with patch("epichat.data_loaders.demographics.get_country_demographics", return_value=DEMO), \
         patch("epichat.data_loaders.contact_matrices.get_mean_contacts", return_value=11.6):
        out = resolve_demographics(p)
    assert out.demographics.birth_rate == 28.1 and out.demographics.death_rate == 7.9
    assert out.demographics.use_demographics is True and out.demographics.demographics_source == "UN WPP 2024"
    assert out.network.n_contacts == 12
    assert r0.approx_r0(out) == pytest.approx(3.0, rel=1e-5)
    assert p.network.n_contacts == 4            # the input is untouched


def test_user_values_are_left_alone():
    p = v2(demographics={"country": "KEN", "birth_rate": 15.0}, network={"n_contacts": 6})
    with patch("epichat.data_loaders.demographics.get_country_demographics", return_value=DEMO), \
         patch("epichat.data_loaders.contact_matrices.get_mean_contacts", return_value=11.6):
        out = resolve_demographics(p)
    assert out.demographics.birth_rate == 15.0 and out.demographics.death_rate == 7.9
    assert out.network.n_contacts == 6 and out.disease.beta == p.disease.beta


def test_lookup_failures_keep_the_defaults():
    p = v2(demographics={"country": "ZZZ"})
    with patch("epichat.data_loaders.demographics.get_country_demographics", side_effect=ValueError("no data")), \
         patch("epichat.data_loaders.contact_matrices.get_mean_contacts", side_effect=RuntimeError("no matrix")):
        out = resolve_demographics(p)
    assert out.demographics.use_demographics is False and out.network.n_contacts == 4


def test_unreachable_r0_after_a_contacts_change_keeps_beta():
    p = v2(demographics={"country": "KEN"}, disease={"beta": 1000.0, "dur_inf": {"mean_days": 2}})     # R0 about 3.7 at 4 contacts
    with patch("epichat.data_loaders.demographics.get_country_demographics", return_value=DEMO), \
         patch("epichat.data_loaders.contact_matrices.get_mean_contacts", return_value=1.0):
        out = resolve_demographics(p)
    assert out.network.n_contacts == 1 and out.disease.beta == 1000.0
