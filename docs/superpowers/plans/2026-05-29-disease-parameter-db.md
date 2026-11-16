# Disease Parameter Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a literature-backed JSON database of disease parameters (R₀, incubation period, infectious period) and an active warning system that alerts users when their simulation values fall outside known ranges.

**Architecture:** A standalone `disease_db.py` module reads `data/disease_parameters.json` (student-editable, no Python required to add diseases), performs alias-based disease name detection from user queries, and returns human-readable warning strings. Warnings are stored in `EpiChatResult.param_warnings` for CLI display and passed as an argument to `build_summary()` for the chat UI.

**Tech Stack:** Python stdlib only (`json`, `pathlib`) for the DB module; pytest for tests; existing `epichat` package structure.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `epichat/epichat/data/disease_parameters.json` | **Create** | Canonical disease parameter ranges with citations |
| `epichat/epichat/disease_db.py` | **Create** | DB loader, alias lookup, disease detection, param checker |
| `epichat/tests/test_disease_db.py` | **Create** | Unit tests for all disease_db functions |
| `epichat/epichat/epichat.py` | **Modify** | Add `param_warnings` to `EpiChatResult`; call checker in `EpiChat.run()`; show warnings in `format_cli()` |
| `epichat/epichat/chat_controller.py` | **Modify** | Add `param_warnings` arg to `build_summary()`; insert warning block in output |

All commands run from `C:\Users\Yuke\stat\other-projects\EpiChat\epichat\` (the project root).

---

## Task 1: Create the disease parameter database

**Files:**
- Create: `epichat/epichat/data/disease_parameters.json`

- [ ] **Step 1: Create the data directory**

```powershell
New-Item -ItemType Directory -Force epichat\data
```

- [ ] **Step 2: Write disease_parameters.json**

Create `epichat/epichat/data/disease_parameters.json` with this exact content:

```json
{
  "diseases": {
    "measles": {
      "aliases": ["rubeola", "morbilli"],
      "r0": {
        "min": 12,
        "max": 18,
        "typical": 15,
        "source": "https://pubmed.ncbi.nlm.nih.gov/28757186/"
      },
      "incubation_days": {
        "min": 6,
        "max": 21,
        "typical": 12,
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC5930806/"
      },
      "infectious_days": {
        "min": 4,
        "max": 12,
        "typical": 8,
        "note": "4 days before to 4 days after rash onset",
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC5930806/"
      }
    },
    "mumps": {
      "aliases": ["epidemic parotitis"],
      "r0": {
        "min": 10,
        "max": 12,
        "typical": 11,
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC557899/"
      },
      "incubation_days": {
        "min": 14,
        "max": 25,
        "typical": 18,
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC5930806/"
      },
      "infectious_days": {
        "min": 7,
        "max": 25,
        "typical": 14,
        "note": "7 days before to 11-14 days after parotitis onset",
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC5930806/"
      }
    },
    "rubella": {
      "aliases": ["german measles", "three-day measles"],
      "r0": {
        "min": 2,
        "max": 5,
        "typical": 3,
        "note": "Literature reports R0 < 5; lower bound set at 2 (minimum viable epidemic threshold)",
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC8893344/"
      },
      "incubation_days": {
        "min": 13,
        "max": 24,
        "typical": 17,
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC5930806/"
      },
      "infectious_days": {
        "min": 7,
        "max": 21,
        "typical": 14,
        "note": "7 days before to 7 days after onset (CDC)",
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC5930806/"
      }
    },
    "varicella": {
      "aliases": ["chickenpox", "varicella-zoster", "chicken pox"],
      "r0": {
        "min": 8,
        "max": 10,
        "typical": 9,
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC8954496/"
      },
      "incubation_days": {
        "min": 10,
        "max": 21,
        "typical": 14,
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC5930806/"
      },
      "infectious_days": {
        "min": 4,
        "max": 10,
        "typical": 7,
        "note": "Typically 1-2 days before to 5-7 days after rash onset",
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC8954496/"
      }
    },
    "pertussis": {
      "aliases": ["whooping cough", "bordetella pertussis", "whooping-cough"],
      "r0": {
        "min": 12,
        "max": 17,
        "typical": 14,
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC11679829/"
      },
      "incubation_days": {
        "min": 3,
        "max": 7,
        "typical": 5,
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC5930806/"
      },
      "infectious_days": {
        "min": 14,
        "max": 28,
        "typical": 14,
        "note": "First 2-4 weeks after cough onset",
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC11679829/"
      }
    },
    "influenza": {
      "aliases": ["flu", "seasonal flu", "seasonal influenza", "the flu"],
      "r0": {
        "min": 1.2,
        "max": 1.4,
        "typical": 1.28,
        "note": "Seasonal community transmission; pandemic strains (H1N1 1918: ~1.8, H5N1: ~0.34) differ significantly",
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC4169819/"
      },
      "incubation_days": {
        "min": 1,
        "max": 4,
        "typical": 2,
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC5930806/"
      },
      "infectious_days": {
        "min": 1,
        "max": 10,
        "typical": 5,
        "note": "1 day before to 10 days after onset (children); shorter in adults",
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC5930806/"
      }
    },
    "meningococcal": {
      "aliases": ["meningitis", "neisseria meningitidis", "meningococcal disease", "bacterial meningitis"],
      "r0": {
        "min": 1.0,
        "max": 1.9,
        "typical": 1.3,
        "note": "Three estimates from HPD intervals: 1.31 (1.03-1.64), 1.22 (0.90-1.64), 1.4 (0.91-1.9)",
        "source": "https://www.sciencedirect.com/science/article/abs/pii/S156713482030191X"
      },
      "incubation_days": {
        "min": 1,
        "max": 10,
        "typical": 3,
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC5930806/"
      },
      "infectious_days": {
        "min": 1,
        "max": 7,
        "typical": 2,
        "note": "Non-infectious 1-2 days after antibiotic treatment starts",
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC5930806/"
      }
    },
    "hepatitis_a": {
      "aliases": ["hepatitis a", "hep a", "hav", "hepatitis-a"],
      "r0": {
        "min": 2.1,
        "max": 2.8,
        "typical": 2.4,
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC6152969/"
      },
      "incubation_days": {
        "min": 20,
        "max": 125,
        "typical": 28,
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC5930806/"
      },
      "infectious_days": {
        "min": 14,
        "max": 28,
        "typical": 21,
        "note": "2 weeks before to 1 week after onset",
        "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC5930806/"
      }
    }
  }
}
```

- [ ] **Step 3: Verify JSON is valid**

```powershell
python -c "import json; db = json.loads(open('epichat/data/disease_parameters.json', encoding='utf-8').read()); print(f'OK: {len(db[\"diseases\"])} diseases loaded')"
```

Expected output: `OK: 8 diseases loaded`

- [ ] **Step 4: Commit**

```powershell
git add epichat/data/disease_parameters.json
git commit -m "data: add disease parameter database with 8 diseases and literature citations"
```

---

## Task 2: Implement disease_db.py — loader and lookup

**Files:**
- Create: `epichat/epichat/disease_db.py`
- Create: `epichat/tests/test_disease_db.py`

- [ ] **Step 1: Write the failing tests**

Create `epichat/tests/test_disease_db.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
pytest tests/test_disease_db.py::TestLoadDb tests/test_disease_db.py::TestLookup -v
```

Expected: `ModuleNotFoundError: No module named 'epichat.disease_db'`

- [ ] **Step 3: Create epichat/epichat/disease_db.py with load_db() and lookup()**

```python
from __future__ import annotations

import json
from pathlib import Path

_DB_PATH = Path(__file__).parent / "data" / "disease_parameters.json"
_db: dict | None = None


def load_db() -> dict:
    global _db
    if _db is None:
        _db = json.loads(_DB_PATH.read_text(encoding="utf-8"))
    return _db


def lookup(disease_name: str) -> dict | None:
    """Case-insensitive match against canonical names and all aliases."""
    db = load_db()
    name_lower = disease_name.lower().strip()
    for canonical, entry in db["diseases"].items():
        if canonical == name_lower:
            return entry
        if any(alias.lower() == name_lower for alias in entry.get("aliases", [])):
            return entry
    return None
```

- [ ] **Step 4: Run tests to verify they pass**

```powershell
pytest tests/test_disease_db.py::TestLoadDb tests/test_disease_db.py::TestLookup -v
```

Expected: All 11 tests `PASSED`

- [ ] **Step 5: Commit**

```powershell
git add epichat/disease_db.py tests/test_disease_db.py
git commit -m "feat: add disease_db loader and alias-based lookup"
```

---

## Task 3: Add detect_disease() and check_params() to disease_db.py

**Files:**
- Modify: `epichat/epichat/disease_db.py`
- Modify: `epichat/tests/test_disease_db.py`

- [ ] **Step 1: Add failing tests to test_disease_db.py**

Append these classes to `epichat/tests/test_disease_db.py`:

```python

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
```

- [ ] **Step 2: Run new tests to verify they fail**

```powershell
pytest tests/test_disease_db.py::TestDetectDisease tests/test_disease_db.py::TestCheckParams -v
```

Expected: `AttributeError` or `ImportError` — `detect_disease` and `check_params` not yet defined.

- [ ] **Step 3: Add detect_disease() and check_params() to disease_db.py**

Add these two functions at the end of `epichat/epichat/disease_db.py`:

```python

def detect_disease(user_input: str) -> str | None:
    """Return canonical disease name if any disease name/alias appears in the query."""
    db = load_db()
    text = user_input.lower()
    for canonical, entry in db["diseases"].items():
        if canonical in text:
            return canonical
        for alias in entry.get("aliases", []):
            if alias.lower() in text:
                return canonical
    return None


def check_params(
    disease_name: str,
    r0: float,
    dur_inf: float,
    dur_exp: float | None,
) -> list[str]:
    """Return warning strings for values outside the literature range.

    Returns [] if the disease is not in the database or all values are in range.
    Never raises.
    """
    try:
        entry = lookup(disease_name)
        if entry is None:
            return []

        warnings: list[str] = []

        r0_data = entry.get("r0", {})
        if r0_data and not (r0_data["min"] <= r0 <= r0_data["max"]):
            warnings.append(
                f"R₀ ≈ {r0:.1f} is outside the literature range for "
                f"{disease_name} ({r0_data['min']}–{r0_data['max']}). "
                f"Source: {r0_data['source']}"
            )

        inf_data = entry.get("infectious_days", {})
        if inf_data and not (inf_data["min"] <= dur_inf <= inf_data["max"]):
            warnings.append(
                f"Infectious period {dur_inf:.4g} days is outside the literature range for "
                f"{disease_name} ({inf_data['min']}–{inf_data['max']} days). "
                f"Source: {inf_data['source']}"
            )

        if dur_exp is not None:
            inc_data = entry.get("incubation_days", {})
            if inc_data and not (inc_data["min"] <= dur_exp <= inc_data["max"]):
                warnings.append(
                    f"Incubation period {dur_exp:.4g} days is outside the literature range for "
                    f"{disease_name} ({inc_data['min']}–{inc_data['max']} days). "
                    f"Source: {inc_data['source']}"
                )

        return warnings
    except Exception:
        return []
```

- [ ] **Step 4: Run all disease_db tests**

```powershell
pytest tests/test_disease_db.py -v
```

Expected: All tests `PASSED` (no skips, no failures).

- [ ] **Step 5: Commit**

```powershell
git add epichat/disease_db.py tests/test_disease_db.py
git commit -m "feat: add detect_disease and check_params to disease_db"
```

---

## Task 4: Add param_warnings to EpiChatResult and integrate into pipeline

**Files:**
- Modify: `epichat/epichat/epichat.py`
- Create: `epichat/tests/test_param_warnings.py`

- [ ] **Step 1: Write failing tests**

Create `epichat/tests/test_param_warnings.py`:

```python
"""Tests for param_warnings integration in EpiChatResult."""
import pytest
from dataclasses import fields


class TestEpiChatResultHasWarningsField:
    def test_param_warnings_field_exists(self):
        from epichat import EpiChatResult
        field_names = [f.name for f in fields(EpiChatResult)]
        assert "param_warnings" in field_names

    def test_param_warnings_defaults_to_empty_list(self):
        from epichat import EpiChatResult
        from epichat.schema import SimParams
        result = EpiChatResult(
            user_input="test",
            params=SimParams(beta=10.0, disease_type="sir"),
            stats={},
            plot_path=None,
            narration={},
        )
        assert result.param_warnings == []

    def test_param_warnings_can_be_set(self):
        from epichat import EpiChatResult
        from epichat.schema import SimParams
        result = EpiChatResult(
            user_input="test",
            params=SimParams(beta=10.0, disease_type="sir"),
            stats={},
            plot_path=None,
            narration={},
            param_warnings=["R₀ too high"],
        )
        assert result.param_warnings == ["R₀ too high"]


class TestFormatCliShowsWarnings:
    def _make_result(self, warnings):
        from epichat import EpiChatResult
        from epichat.schema import SimParams
        return EpiChatResult(
            user_input="test",
            params=SimParams(beta=10.0, disease_type="sir"),
            stats={"peak_infections": 0, "total_infected": 0, "total_deaths": 0, "n_agents": 100},
            plot_path=None,
            narration={"summary": "test summary", "key_findings": []},
            param_warnings=warnings,
        )

    def test_no_warning_block_when_empty(self):
        result = self._make_result([])
        output = result.format_cli()
        assert "Parameter notes" not in output

    def test_warning_block_appears_when_non_empty(self):
        result = self._make_result(["R₀ ≈ 100 is outside the literature range for measles (12–18)."])
        output = result.format_cli()
        assert "Parameter notes" in output

    def test_warning_text_appears_in_output(self):
        result = self._make_result(["R₀ ≈ 100 is outside the literature range for measles (12–18)."])
        output = result.format_cli()
        assert "100" in output
        assert "measles" in output

    def test_multiple_warnings_all_appear(self):
        result = self._make_result(["Warning one", "Warning two"])
        output = result.format_cli()
        assert "Warning one" in output
        assert "Warning two" in output
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
pytest tests/test_param_warnings.py -v
```

Expected: `AttributeError` — `EpiChatResult` has no `param_warnings` attribute.

- [ ] **Step 3: Add param_warnings to EpiChatResult in epichat.py**

In `epichat/epichat/epichat.py`, find the `EpiChatResult` dataclass and add the field:

```python
# Before (the last field in EpiChatResult):
    data_sources: list[ResolvedField] = field(default_factory=list)

# After:
    data_sources: list[ResolvedField] = field(default_factory=list)
    param_warnings: list[str] = field(default_factory=list)
```

- [ ] **Step 4: Add warning block to format_cli() in epichat.py**

In `EpiChatResult.format_cli()`, find the separator definition and the RESULTS header:

```python
# Find this block (around line 37):
        sep = "-" * 42
        lines.append("\nRESULTS")
        lines.append(sep)
```

Insert the warning block immediately after the separator line — still inside `format_cli()`, right before `s = self.stats`:

```python
        sep = "-" * 42
        lines.append("\nRESULTS")
        lines.append(sep)

        if self.param_warnings:
            lines.append("⚠️  Parameter notes")
            for w in self.param_warnings:
                lines.append(f"  • {w}")
            lines.append(sep)

        s = self.stats
```

- [ ] **Step 5: Call the checker in EpiChat.run()**

In `EpiChat.run()`, after the `parse_query()` call succeeds, add the disease detection and warning check. Find this block:

```python
        try:
            params = parse_query(user_input)
        except (ValueError, ValidationError) as e:
            return EpiChatResult(
                user_input=user_input,
                params=None,  # type: ignore[arg-type]
                stats={},
                plot_path=None,
                narration={},
                error=str(e),
            )
```

Add the warning logic immediately after:

```python
        try:
            params = parse_query(user_input)
        except (ValueError, ValidationError) as e:
            return EpiChatResult(
                user_input=user_input,
                params=None,  # type: ignore[arg-type]
                stats={},
                plot_path=None,
                narration={},
                error=str(e),
            )

        from .disease_db import detect_disease, check_params as _db_check
        _disease = detect_disease(user_input)
        _param_warnings = (
            _db_check(_disease, params.approx_r0(), params.dur_inf, params.dur_exp)
            if _disease else []
        )
```

Then update the final `return EpiChatResult(...)` at the bottom of `run()` to include the warnings:

```python
        return EpiChatResult(
            user_input=user_input,
            params=params,
            stats=exec_result["stats"],
            plot_path=exec_result["plot_path"],
            narration=narration,
            data_sources=get_last_resolved(),
            param_warnings=_param_warnings,
        )
```

- [ ] **Step 6: Run tests to verify they pass**

```powershell
pytest tests/test_param_warnings.py -v
```

Expected: All 7 tests `PASSED`.

- [ ] **Step 7: Run all tests to verify nothing broken**

```powershell
pytest tests/test_disease_db.py tests/test_param_warnings.py -v
```

Expected: All tests `PASSED`.

- [ ] **Step 8: Commit**

```powershell
git add epichat/epichat.py tests/test_param_warnings.py
git commit -m "feat: add param_warnings to EpiChatResult and warning display in CLI"
```

---

## Task 5: Add param_warnings to build_summary() in chat_controller.py

**Files:**
- Modify: `epichat/epichat/chat_controller.py`
- Create: `epichat/tests/test_build_summary_warnings.py`

- [ ] **Step 1: Write failing tests**

Create `epichat/tests/test_build_summary_warnings.py`:

```python
"""Tests for param_warnings display in build_summary."""
import pytest


def _make_params(**kwargs):
    from epichat.schema import SimParams
    defaults = dict(beta=10.0, disease_type="sir")
    defaults.update(kwargs)
    return SimParams(**defaults)


class TestBuildSummaryWarnings:
    def test_no_warning_section_when_empty(self):
        from epichat.chat_controller import build_summary
        params = _make_params()
        output = build_summary(params, data_sources=[], param_warnings=[])
        assert "Parameter notes" not in output

    def test_warning_section_appears_when_warnings_present(self):
        from epichat.chat_controller import build_summary
        params = _make_params()
        output = build_summary(
            params,
            data_sources=[],
            param_warnings=["R₀ ≈ 50.0 is outside the literature range for measles (12–18)."],
        )
        assert "Parameter notes" in output

    def test_warning_text_in_output(self):
        from epichat.chat_controller import build_summary
        params = _make_params()
        output = build_summary(
            params,
            data_sources=[],
            param_warnings=["R₀ ≈ 50.0 is outside the literature range for measles (12–18)."],
        )
        assert "50.0" in output
        assert "measles" in output

    def test_warning_appears_before_run_question(self):
        from epichat.chat_controller import build_summary
        params = _make_params()
        output = build_summary(
            params,
            data_sources=[],
            param_warnings=["Some warning here"],
        )
        warning_pos = output.index("Some warning here")
        run_q_pos = output.index("Would you like to adjust")
        assert warning_pos < run_q_pos

    def test_default_param_warnings_is_empty(self):
        """build_summary() still works when param_warnings not passed."""
        from epichat.chat_controller import build_summary
        params = _make_params()
        output = build_summary(params, data_sources=[])
        assert "Parameter notes" not in output

    def test_multiple_warnings_all_in_output(self):
        from epichat.chat_controller import build_summary
        params = _make_params()
        output = build_summary(
            params,
            data_sources=[],
            param_warnings=["First warning", "Second warning"],
        )
        assert "First warning" in output
        assert "Second warning" in output
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
pytest tests/test_build_summary_warnings.py -v
```

Expected: `TypeError` — `build_summary()` does not accept `param_warnings` argument.

- [ ] **Step 3: Update build_summary() signature in chat_controller.py**

Find the `build_summary` function signature (currently line 158):

```python
def build_summary(params, data_sources: list, description: str = "", lang: str = "English") -> str:
```

Change it to:

```python
def build_summary(params, data_sources: list, description: str = "", lang: str = "English", param_warnings: list[str] | None = None) -> str:
```

- [ ] **Step 4: Insert warning block in build_summary()**

Find this block near the end of `build_summary()` (the closing section, before the return):

```python
    _RUN_QUESTION = "Would you like to adjust anything, or shall I run the simulation?"
    result = "\n\n".join(parts)
```

Insert the warning block between `parts` assembly and the run question:

```python
    if param_warnings:
        warn_lines = ["⚠️ **Parameter notes**"]
        for w in param_warnings:
            warn_lines.append(f"- {w}")
        parts.append("  \n".join(warn_lines))

    _RUN_QUESTION = "Would you like to adjust anything, or shall I run the simulation?"
    result = "\n\n".join(parts)
```

- [ ] **Step 5: Run all tests**

```powershell
pytest tests/test_disease_db.py tests/test_param_warnings.py tests/test_build_summary_warnings.py -v
```

Expected: All tests `PASSED`.

- [ ] **Step 6: Commit**

```powershell
git add epichat/chat_controller.py tests/test_build_summary_warnings.py
git commit -m "feat: show param_warnings in build_summary for chat UI"
```

---

## Self-Review Checklist

- [x] **disease_parameters.json** — all 8 diseases with R₀, incubation, infectious period, citations ✓
- [x] **load_db / lookup** — Task 2 ✓
- [x] **detect_disease / check_params** — Task 3 ✓
- [x] **EpiChatResult.param_warnings** — Task 4, Step 3 ✓
- [x] **format_cli() warning block** — Task 4, Step 4 ✓
- [x] **EpiChat.run() integration** — Task 4, Step 5 ✓
- [x] **build_summary() param_warnings** — Task 5 ✓
- [x] **Chat UI caller note** — spec covers that the chat UI (app.py) must pass `param_warnings` from `detect_disease` + `check_params` calls to `build_summary()`. This plan does not modify `app.py` — the Streamlit app layer wires this up separately using the public functions from `disease_db`.
