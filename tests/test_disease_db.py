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
