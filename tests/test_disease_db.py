"""Tests for the disease parameter database module."""
import pytest


class TestLoadDb:
    def test_returns_dict_with_diseases_key(self):
        from epichat.disease_db import load_db
        db = load_db()
        assert isinstance(db, dict)
        assert "diseases" in db

    def test_diseases_is_non_empty(self):
        from epichat.disease_db import load_db
        db = load_db()
        assert len(db["diseases"]) >= 8

    def test_measles_entry_has_required_keys(self):
        from epichat.disease_db import load_db
        entry = load_db()["diseases"]["measles"]
        assert "r0" in entry
        assert "incubation_days" in entry
        assert "infectious_days" in entry

    def test_r0_entry_has_min_max_source(self):
        from epichat.disease_db import load_db
        r0 = load_db()["diseases"]["measles"]["r0"]
        assert "min" in r0
        assert "max" in r0
        assert "source" in r0
        assert r0["min"] < r0["max"]


class TestLookup:
    def test_canonical_name_match(self):
        from epichat.disease_db import lookup
        assert lookup("measles") is not None

    def test_case_insensitive_canonical(self):
        from epichat.disease_db import lookup
        assert lookup("Measles") is not None
        assert lookup("MEASLES") is not None

    def test_alias_match_whooping_cough(self):
        from epichat.disease_db import lookup
        assert lookup("whooping cough") is not None

    def test_alias_match_flu(self):
        from epichat.disease_db import lookup
        assert lookup("flu") is not None

    def test_alias_match_chickenpox(self):
        from epichat.disease_db import lookup
        assert lookup("chickenpox") is not None

    def test_unknown_disease_returns_none(self):
        from epichat.disease_db import lookup
        assert lookup("unicorn fever") is None

    def test_returned_entry_has_r0_range(self):
        from epichat.disease_db import lookup
        entry = lookup("measles")
        assert entry["r0"]["min"] == 12
        assert entry["r0"]["max"] == 18


class TestDetectDisease:
    def test_detects_measles_in_query(self):
        from epichat.disease_db import detect_disease
        assert detect_disease("simulate measles in Kenya") == "measles"

    def test_detects_pertussis_via_alias(self):
        from epichat.disease_db import detect_disease
        assert detect_disease("model whooping cough spread in the UK") == "pertussis"

    def test_detects_flu_via_alias(self):
        from epichat.disease_db import detect_disease
        assert detect_disease("run a flu epidemic model") == "influenza"

    def test_case_insensitive_detection(self):
        from epichat.disease_db import detect_disease
        assert detect_disease("Simulate Measles outbreak") == "measles"

    def test_returns_none_for_unknown_query(self):
        from epichat.disease_db import detect_disease
        assert detect_disease("simulate a generic epidemic with R0=2") is None


class TestCheckParams:
    def test_no_warnings_for_in_range_measles(self):
        from epichat.disease_db import check_params
        warnings = check_params("measles", r0=15.0, dur_inf=8.0, dur_exp=10.0)
        assert warnings == []

    def test_warns_when_r0_above_range(self):
        from epichat.disease_db import check_params
        warnings = check_params("measles", r0=50.0, dur_inf=8.0, dur_exp=10.0)
        assert len(warnings) == 1
        assert "R" in warnings[0]
        assert "50" in warnings[0]
        assert "12" in warnings[0]  # min
        assert "18" in warnings[0]  # max

    def test_warns_when_r0_below_range(self):
        from epichat.disease_db import check_params
        warnings = check_params("measles", r0=1.0, dur_inf=8.0, dur_exp=10.0)
        assert len(warnings) == 1

    def test_warns_when_dur_inf_above_range(self):
        from epichat.disease_db import check_params
        warnings = check_params("measles", r0=15.0, dur_inf=100.0, dur_exp=10.0)
        assert len(warnings) == 1
        assert "Infectious" in warnings[0]

    def test_warns_when_dur_exp_above_range(self):
        from epichat.disease_db import check_params
        warnings = check_params("measles", r0=15.0, dur_inf=8.0, dur_exp=100.0)
        assert len(warnings) == 1
        assert "Incubation" in warnings[0]

    def test_skips_incubation_check_when_dur_exp_is_none(self):
        from epichat.disease_db import check_params
        warnings = check_params("measles", r0=15.0, dur_inf=8.0, dur_exp=None)
        assert warnings == []

    def test_multiple_violations_produce_multiple_warnings(self):
        from epichat.disease_db import check_params
        warnings = check_params("measles", r0=100.0, dur_inf=200.0, dur_exp=500.0)
        assert len(warnings) == 3

    def test_unknown_disease_returns_empty_list(self):
        from epichat.disease_db import check_params
        assert check_params("unicorn fever", r0=50.0, dur_inf=100.0, dur_exp=50.0) == []

    def test_warnings_contain_source_url(self):
        from epichat.disease_db import check_params
        warnings = check_params("measles", r0=100.0, dur_inf=8.0, dur_exp=10.0)
        assert any("http" in w for w in warnings)

    def test_warning_mentions_disease_name(self):
        from epichat.disease_db import check_params
        warnings = check_params("measles", r0=100.0, dur_inf=8.0, dur_exp=10.0)
        assert any("measles" in w.lower() for w in warnings)
