"""Follow-up spec 7.2: the diseases with a routine-immunization indicator live in one place."""
import json
from pathlib import Path

from epichat.params.indicators import VACCINE_INDICATORS, has_vaccine, has_vaccine_indicator

ROOT = Path(__file__).resolve().parent.parent


def test_the_web_reads_the_same_list():
    # The frozen agent (epichat/agent.py, _GHO_CODES) keeps WHO's retired GHO codes; only the web reads this list.
    exported = json.loads((ROOT / "web" / "data" / "vaccine_indicators.json").read_text(encoding="utf-8"))
    assert exported == {"indicators": VACCINE_INDICATORS}


def test_the_codes_are_the_sources_own():
    # UNICEF's WHO/UNICEF estimates (IM_), and the World Bank's Pol3 (WB_HNP_), since UNICEF has no Pol3 series.
    codes = [code for codes in VACCINE_INDICATORS.values() for code in codes]
    assert codes and all(code.startswith(("IM_", "WB_HNP_")) for code in codes)
    assert VACCINE_INDICATORS["measles"] == ["IM_MCV1", "IM_MCV2"]
    assert VACCINE_INDICATORS["rubella"] == ["IM_RCV1"]                      # its own vaccine, not measles' MCV1
    assert VACCINE_INDICATORS["polio"] == ["WB_HNP_SH_IMM_POL3"]


def test_hepatitis_a_has_a_vaccine_but_no_coverage_series():
    # The old code, WHS3_45, was hepatitis B dose 3.
    assert not has_vaccine_indicator("hepatitis_a")
    assert has_vaccine("hepatitis_a") and has_vaccine("Measles") and not has_vaccine("covid19") and not has_vaccine(None)


def test_a_disease_is_matched_by_its_canonical_name():
    assert has_vaccine_indicator("measles") and has_vaccine_indicator("Measles")
    assert not has_vaccine_indicator("covid19") and not has_vaccine_indicator(None) and not has_vaccine_indicator("")
