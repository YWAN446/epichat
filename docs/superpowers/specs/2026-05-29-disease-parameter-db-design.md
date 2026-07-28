# Disease Parameter Database — Design Spec

**Date:** 2026-05-29  
**Status:** Approved

---

## Problem

EpiChat has a small, hard-coded disease defaults table in `extraction.txt`. When a user specifies epidemiological parameters (R₀, incubation period, infectious period) that are biologically implausible for a named disease, the system proceeds without comment. There is no mechanism to warn users that their values fall outside the literature-supported range.

Additionally, the hard-coded table is embedded in a prompt string, making it hard to maintain as the set of covered diseases grows.

---

## Goals

1. Create a structured, literature-backed database of infectious disease parameters that a non-developer (student) can extend by editing a JSON file.
2. Use this database to actively warn users when their stated R₀, incubation period, or infectious period is outside the known range for the named disease — before the simulation runs.
3. Surface these warnings in both the chat UI (parameter summary) and the CLI output.

---

## Out of Scope (for now)

- Fact-checking `p_death`, `n_contacts`, `dur_immune` — deferred until more literature data is collected.
- Replacing the extraction prompt's disease defaults table — the database `typical` values could be used for this later, but it is not part of this implementation.
- LLM-based fact-checking — the database approach is deterministic and citable.

---

## Architecture

### 1. Data file: `epichat/epichat/data/disease_parameters.json`

Canonical source of truth. The student edits this file to add diseases or update values. No Python changes required to add a new disease.

**Schema per disease entry:**

```json
{
  "diseases": {
    "<canonical_name>": {
      "aliases": ["<alternate name>", "..."],
      "r0": {
        "min": <float>,
        "max": <float>,
        "typical": <float>,
        "source": "<URL>"
      },
      "incubation_days": {
        "min": <float>,
        "max": <float>,
        "typical": <float>,
        "source": "<URL>"
      },
      "infectious_days": {
        "min": <float>,
        "max": <float>,
        "typical": <float>,
        "note": "<optional human-readable clarification>",
        "source": "<URL>"
      }
    }
  }
}
```

**Initial diseases (from student documentation):**

| Disease        | R₀ range  | Incubation (days) | Infectious (days) |
|----------------|-----------|-------------------|-------------------|
| Measles        | 12–18     | 6–21              | 4–12              |
| Mumps          | 10–12     | 14–25             | 7–25              |
| Rubella        | 2–5       | 13–24             | 14–21             |
| Varicella      | 8–10      | 10–21             | 5–10              |
| Pertussis      | 12–17     | 3–7               | 14–21             |
| Influenza (seasonal) | 1.2–1.4 | 1–4            | 1–10              |
| Meningococcal  | 1.0–1.9   | 1–10              | 1–2               |
| Hepatitis A    | 2.1–2.8   | 20–125            | 14–21             |

All entries include source citations as PMC/PubMed URLs from the student's documentation.

### 2. Python module: `epichat/epichat/disease_db.py`

Loaded once at import time. Provides three public functions:

```python
def load_db() -> dict
```
Reads `data/disease_parameters.json` relative to the module file. Returns the parsed dict. Called once at module load; result cached in a module-level variable.

```python
def lookup(disease_name: str) -> dict | None
```
Case-insensitive match against canonical names and all aliases. Returns the disease entry dict, or `None` if not found.

```python
def check_params(
    disease_name: str,
    r0: float,
    dur_inf: float,
    dur_exp: float | None,
) -> list[str]
```
Looks up the disease. For each of the three parameters, if the value is outside `[min, max]`, appends a warning string of the form:

> `"R₀ ≈ {value} is outside the literature range for {disease} ({min}–{max}). Source: {url}"`

Returns an empty list if the disease is not in the database or all values are within range. Never raises — any load or lookup failure returns `[]`.

**Disease name detection:** `check_params` is called with the disease name detected by scanning the user query string against all aliases in the loaded database. This is a simple case-insensitive substring match — no LLM call required.

A helper function `detect_disease(user_input: str) -> str | None` in `disease_db.py` implements this scan.

### 3. Pipeline integration

#### `epichat/epichat/schema.py` — no changes

#### `epichat/epichat/epichat.py`

- `EpiChatResult` gets a new field: `param_warnings: list[str] = field(default_factory=list)`
- In `EpiChat.run()`, after `parse_query()` succeeds, call:
  ```python
  from .disease_db import detect_disease, check_params
  disease = detect_disease(user_input)
  warnings = check_params(disease, params.approx_r0(), params.dur_inf, params.dur_exp) if disease else []
  ```
  Store `warnings` in the `EpiChatResult`.

#### `epichat/epichat/chat_controller.py` — `build_summary()`

`build_summary()` receives a `param_warnings: list[str]` argument (default `[]`). If non-empty, inserts a warning block before the closing "Would you like to adjust?" line.

> **Note on timing:** `build_summary()` is called pre-simulation in the chat UI (before `EpiChat.run()`), so the chat UI layer is responsible for computing warnings itself. After calling `parse_query()` to get `SimParams`, the chat UI should call `detect_disease(user_input)` and `check_params(...)` from `disease_db` and pass the result to `build_summary(param_warnings=warnings)`. This keeps the warnings visible before the user confirms to run.

```
⚠️ Parameter notes
• R₀ ≈ 100.0 is outside the literature range for measles (12–18). Source: https://...
```

#### `epichat/epichat/epichat.py` — `format_cli()`

Same block inserted after the separator line in the results output.

---

## Warning display examples

**Chat UI (in build_summary):**

```
⚠️ Parameter notes
• R₀ ≈ 100.0 is outside the literature range for measles (12–18). Source: https://pubmed.ncbi.nlm.nih.gov/28757186/
• Infectious period 120 days is outside the literature range for measles (4–12 days). Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC5930806/

Would you like to adjust anything, or shall I run the simulation?
```

**CLI:**

```
RESULTS
------------------------------------------
⚠️  Parameter notes
  • R₀ ≈ 100.0 is outside the literature range for measles (12–18).
    Source: https://pubmed.ncbi.nlm.nih.gov/28757186/
------------------------------------------
Peak infections: ...
```

---

## File changes summary

| File | Change |
|------|--------|
| `epichat/epichat/data/disease_parameters.json` | **New** — disease database |
| `epichat/epichat/disease_db.py` | **New** — loader, lookup, checker, detector |
| `epichat/epichat/epichat.py` | Add `param_warnings` to `EpiChatResult`; call checker after `parse_query()` |
| `epichat/epichat/chat_controller.py` | Add warning block in `build_summary()` |

---

## Extension path

When more literature data is collected for `p_death`, `n_contacts`, `dur_immune`, add those keys to the JSON schema and extend `check_params()` to check them. No structural changes required.
