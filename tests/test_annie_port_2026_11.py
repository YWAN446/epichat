"""Annie's October parameters (plan docs/superpowers/plans/2026-11-03-annie-params-oct.md): what the second port carried."""
import json
from pathlib import Path

import pytest

DB = Path(__file__).resolve().parent.parent / "epichat" / "data" / "disease_parameters.json"


@pytest.fixture(scope="module")
def diseases():
    return json.loads(DB.read_text(encoding="utf-8"))["diseases"]


def consensus(diseases, disease, param):
    c = diseases[disease]["parameters"][param].get("consensus") or {}
    return (c.get("min"), c.get("typical"), c.get("max"))


def test_dengue_and_rsv_are_cited_now(diseases):
    assert consensus(diseases, "dengue", "r0") == (2.0293, 6.16, 10.29)
    assert consensus(diseases, "dengue", "incubation_days") == (3, 5.9, 10)
    assert consensus(diseases, "dengue", "infectious_days") == (1, 4.5, 7)
    assert consensus(diseases, "dengue", "asymptomatic_fraction") == (0.08, 0.6, 0.8)
    assert consensus(diseases, "rsv", "r0") == (0.92, 3.0, 7.1)
    assert consensus(diseases, "rsv", "immunity_duration") == (60, 460, 812)
    assert len(diseases["rsv"]["parameters"]["incubation_days"]["estimates"]) == 3


def test_ebola_and_the_smaller_edits(diseases):
    assert consensus(diseases, "ebola", "incubation_days") == (2, 9, 21)
    assert consensus(diseases, "ebola", "infectious_days") == (3.5, 5.61, 10.7)
    assert consensus(diseases, "rubella", "fatality_rate") == (0.0005, 0.0005, 0.0005)
    assert consensus(diseases, "varicella", "asymptomatic_fraction") == (0.07, 0.1, 0.33)
    measles = diseases["measles"]["parameters"]["fatality_rate"]["estimates"]
    assert next(e for e in measles if e["value"] == 2.21).get("range") is None      # [0.07, 2.08] excluded its own value


def test_two_values_stay_out_of_simulations_until_annie_answers(diseases):
    dengue = diseases["dengue"]["parameters"]["fatality_rate"]
    assert dengue["status"] == "under_review" and "ICU" in dengue["review_note"]
    assert consensus(diseases, "dengue", "fatality_rate") == (None, None, None)
    assert len(dengue["estimates"]) == 3                                              # the estimates stay, for the student to read
    meningococcal = diseases["meningococcal"]["parameters"]["infectious_days"]
    assert meningococcal["status"] == "under_review" and "7 days before" in meningococcal["review_note"]
    assert len(meningococcal["estimates"]) == 2


def test_her_extra_estimate_fields_fit_main_schema(diseases):
    # Her two Ebola "contacts" estimates are contacts traced per case, not per day: not ported (a question for Annie).
    assert not diseases["ebola"]["parameters"]["average_contacts_daily"].get("estimates")
    asymptomatic = diseases["ebola"]["parameters"]["asymptomatic_fraction"]["estimates"]
    assert any("PMID 25390569" in (e.get("notes") or "") for e in asymptomatic)
    assert all("pmid" not in e for e in asymptomatic)


def test_rsv_fatality_and_infectious_period_are_held_back(diseases):
    # Final review: 0.31% is deaths per LRTI episode in under-5s and 1.7% an inpatient CFR, while the simulation counts every
    # infection as a case; and 11.2 days is a PCR-shedding figure next to cited estimates of 6.5 days.
    fatality = diseases["rsv"]["parameters"]["fatality_rate"]
    assert fatality["status"] == "under_review" and "inpatient" in fatality["review_note"]
    assert consensus(diseases, "rsv", "fatality_rate") == (None, None, None)
    infectious = diseases["rsv"]["parameters"]["infectious_days"]
    assert infectious["status"] == "under_review" and "shedding" in infectious["review_note"]
    assert consensus(diseases, "rsv", "infectious_days") == (None, None, None)
    assert sorted(e["value"] for e in infectious["estimates"]) == [6.5, 6.5]


def test_a_cited_estimate_with_its_number_as_text_is_kept(diseases):
    # Final review: Bylsma 2022, a systematic review, carried "0.85" as a string and was dropped as a placeholder.
    fatality = diseases["rsv"]["parameters"]["fatality_rate"]["estimates"]
    assert any(e.get("doi") == "10.1093/infdis/jiac226" and e["value"] == 0.85 for e in fatality)


def test_the_port_stops_on_a_cited_estimate_it_cannot_read():
    import sys
    sys.path.insert(0, str(DB.parent.parent.parent / "scripts"))
    import port_annie_parameters as port
    kept = port._clean({"unit": "percentage", "estimates": [{"title": "A study", "value": "0.85"}]}, "x", "fatality_rate")
    assert kept["estimates"][0]["value"] == 0.85
    with pytest.raises(SystemExit, match="A study"):
        port._clean({"unit": "percentage", "estimates": [{"title": "A study", "value": "N/A"}]}, "x", "fatality_rate")
    untitled = port._clean({"unit": "percentage", "estimates": [{"title": "", "value": None}]}, "x", "fatality_rate")
    assert "estimates" not in untitled                                                # an in-progress placeholder is still dropped
