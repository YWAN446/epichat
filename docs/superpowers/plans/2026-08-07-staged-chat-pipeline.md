# Staged Chat Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the chat parse flow into understand → confirm → visible parallel fetch → summary, and fix language detection keying off mentioned places.

**Architecture:** `parser.py` exposes a staged API (`extract_intent` / `fetch_query` / `finalize_params`) with `parse_query` recomposed on top so the CLI is untouched. `chat_controller.py` gains pure formatting functions for the understanding card and per-tool chat lines. `app.py` adds a `confirm` conversation stage and a parallel fetch step that appends one persistent chat message per tool. The WB Data360 adapter parallelizes its per-indicator HTTP calls internally.

**Tech Stack:** Python 3.10 (`py -3.10`), Streamlit, pydantic v2, `concurrent.futures.ThreadPoolExecutor`, pytest with `unittest.mock`.

## Global Constraints

- Repo root (worktree): `C:\Users\Yuke\stat\other-projects\EpiChat\epichat\.claude\worktrees\integrate-annie` — run all commands from here.
- Run tests with `py -3.10 -m pytest` (bare `python` is 3.12 and lacks deps).
- `parse_query`'s observable behavior (including `get_last_resolved()` / `get_last_location_queried()`) must not change; the existing suite (274 passed / 31 skipped) must stay green after every task.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No new dependencies.

---

### Task 1: Staged parser API

**Files:**
- Modify: `epichat/parser.py` (the `parse_query` function, ~line 350)
- Test: `tests/test_parser_unit.py` (append)

**Interfaces:**
- Consumes: existing `_llm_call_1`, `_llm_call_2`, `_resolver`, `_apply_*` chain, `ClarificationNeeded`.
- Produces (used by Tasks 3 and 5):
  - `extract_intent(user_input: str, context: OutbreakContext | None = None) -> IntentResult` (raises `ClarificationNeeded`)
  - `fetch_query(query: DataQuery) -> list[ResolvedField]`
  - `finalize_params(user_input: str, intent: IntentResult, resolved: list[ResolvedField]) -> SimParams`

- [ ] **Step 1: Write the failing tests** (append to `tests/test_parser_unit.py`)

```python
# ── Staged API ────────────────────────────────────────────────────────────────

def test_extract_intent_returns_intent_result():
    client = _mock_llm(_PRELIM_JSON)
    with patch("epichat.parser.anthropic.Anthropic", return_value=client):
        from epichat.parser import extract_intent
        intent = extract_intent("run a default SIR model")
    assert isinstance(intent, IntentResult)
    assert intent.preliminary_params.disease_type == "sir"


def test_fetch_query_resolves_single_query():
    from epichat.parser import fetch_query, _resolver
    from epichat.resolver import DataQuery

    field = ResolvedField(field="total_population", value=1000, citation="test")
    fake_adapter = MagicMock()
    fake_adapter.source_name = "fake_src"
    fake_adapter.fetch.return_value = [field]
    _resolver.register(fake_adapter)
    try:
        result = fetch_query(DataQuery(source="fake_src"))
    finally:
        _resolver._adapters.pop("fake_src", None)
    assert result == [field]


def test_finalize_params_updates_last_resolved():
    from epichat.parser import finalize_params, get_last_resolved
    from epichat.resolver import DataQuery
    from epichat.schema import SimParams

    intent = IntentResult(
        preliminary_params=SimParams(beta=1.0),
        data_queries=[DataQuery(source="un_wpp", location_id=76)],
    )
    resolved = [ResolvedField(field="total_population", value=5000, citation="test")]
    params = finalize_params("run a default SIR model", intent, resolved)
    assert isinstance(params, SimParams)
    assert get_last_resolved() == resolved
    from epichat.parser import get_last_location_queried
    assert get_last_location_queried() is True
```

Note: `finalize_params` with a non-empty `resolved` list calls `_llm_call_2`
(an LLM). Patch it to identity so the test stays offline — wrap the
`finalize_params(...)` call as:

```python
    with patch("epichat.parser._llm_call_2", side_effect=lambda ui, prelim, res: prelim):
        params = finalize_params("run a default SIR model", intent, resolved)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `py -3.10 -m pytest tests/test_parser_unit.py -q -k "extract_intent or fetch_query or finalize"`
Expected: FAIL / ERROR with `ImportError: cannot import name 'extract_intent'`

- [ ] **Step 3: Implement the staged API in `epichat/parser.py`**

Add directly above `parse_query`:

```python
def extract_intent(user_input: str, context: OutbreakContext | None = None) -> IntentResult:
    """Stage 1 of the chat pipeline: LLM intent extraction.

    Raises ClarificationNeeded when the query is ambiguous.
    """
    return _llm_call_1(user_input, context)


def fetch_query(query: DataQuery) -> list[ResolvedField]:
    """Stage 2: resolve a single data query through the registered adapters."""
    return _resolver.resolve([query])


def finalize_params(
    user_input: str,
    intent: IntentResult,
    resolved: list[ResolvedField],
) -> SimParams:
    """Stage 3: refinement plus deterministic post-processing.

    Also records `resolved` so get_last_resolved()/get_last_location_queried()
    reflect this parse, matching parse_query's behavior.
    """
    global _last_resolved, _last_location_queried
    _last_resolved = resolved
    _last_location_queried = any(
        q.source == "un_wpp" and q.location_id != 0
        for q in intent.data_queries
    )
    params = _llm_call_2(user_input, intent.preliminary_params, resolved)
    params = _apply_age_distribution(params, resolved)
    params = _apply_vaccination_coverage(params, resolved)
    params = _apply_surveillance(params, resolved)
    params = _apply_wb_disease_prevalence(params, resolved)
    params = _apply_health_system(params, resolved)
    params = _apply_population_scale(params, resolved)
    params = _apply_disease_db_r0(user_input, params)
    params = _apply_country(params, intent.data_queries)
    return params
```

Then replace the body of `parse_query` (keep its docstring) with the
composition:

```python
    global _last_resolved, _last_location_queried
    _last_resolved = []
    _last_location_queried = False
    intent = extract_intent(user_input, context)
    resolved: list[ResolvedField] = []
    for query in intent.data_queries:
        resolved.extend(fetch_query(query))
    return finalize_params(user_input, intent, resolved)
```

- [ ] **Step 4: Run the full suite**

Run: `py -3.10 -m pytest tests/ -q`
Expected: 277 passed (274 + 3 new), 31 skipped

- [ ] **Step 5: Commit**

```bash
git add epichat/parser.py tests/test_parser_unit.py
git commit -m "refactor: expose staged parser API (extract/fetch/finalize)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Parallelize WB Data360 indicator fetches

**Files:**
- Modify: `epichat/adapters/wb_data360.py:73-100` (the per-indicator loop in `fetch`)
- Test: `tests/test_wb_data360.py` (append)

**Interfaces:**
- Consumes: existing `_fetch_text(url)` module function and `INDICATOR_MAP`.
- Produces: `fetch` keeps its exact signature/return; only wall-clock changes.

- [ ] **Step 1: Write the failing test** (append to `tests/test_wb_data360.py`; mirror that file's existing mock style for `_fetch_text` — it already stubs `epichat.adapters.wb_data360._fetch_text`)

```python
def test_fetch_runs_indicators_concurrently(monkeypatch):
    """All indicator URLs are fetched even when calls overlap; results identical
    to the serial implementation (order-independent dict build)."""
    import threading
    import epichat.adapters.wb_data360 as wb

    seen = []
    lock = threading.Lock()

    def fake_fetch_text(url):
        with lock:
            seen.append(url)
        code = url.split("INDICATOR=")[1].split("&")[0]
        return (
            '{"value": [{"OBS_VALUE": "2.5", "TIME_PERIOD": "2022"}]}'
            if code == "WB_WDI_SH_MED_BEDS_ZS" else '{"value": []}'
        )

    monkeypatch.setattr(wb, "_fetch_text", fake_fetch_text)
    adapter = wb.WorldBankData360Adapter()
    from epichat.resolver import DataQuery
    q = DataQuery(
        source="wb_data360",
        indicator_codes=["WB_WDI_SH_MED_BEDS_ZS", "WB_WDI_SH_MED_PHYS_ZS"],
        location_code="BRA",
    )
    results = adapter.fetch(q)
    assert len(seen) == 2                       # every indicator attempted
    assert any(r.field for r in results)        # beds indicator produced a field
```

(If the adapter class name in the file differs, use the name exported there —
check `grep -n "^class" epichat/adapters/wb_data360.py`.)

- [ ] **Step 2: Run it — it should PASS on the serial code too.** That is expected:
this test pins behavior, the next step changes only the execution strategy.
Run: `py -3.10 -m pytest tests/test_wb_data360.py -q`

- [ ] **Step 3: Parallelize the loop** — replace the `for code in query.indicator_codes:` block in `fetch` with:

```python
        codes = [c for c in query.indicator_codes if c in INDICATOR_MAP]

        def _fetch_one(code: str) -> tuple[str, tuple[float, str] | None]:
            url = (
                f"{_BASE_URL}/data360/data"
                f"?DATABASE_ID={query.database_id}"
                f"&INDICATOR={code}"
                f"&REF_AREA={query.location_code}"
                f"&timePeriodFrom={query.start_year}"
                f"&timePeriodTo={query.end_year}"
            )
            try:
                data = json.loads(_fetch_text(url))
            except Exception as exc:
                _logger.warning("WorldBankData360Adapter fetch failed for %s: %s", code, exc)
                return code, None
            rows = [
                r for r in data.get("value", [])
                if r.get("OBS_VALUE") is not None and r.get("OBS_VALUE") != "null"
            ]
            if not rows:
                return code, None
            best = max(rows, key=lambda r: r.get("TIME_PERIOD", "") or "")
            return code, (float(best["OBS_VALUE"]), best.get("TIME_PERIOD", "unknown"))

        if codes:
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=min(8, len(codes))) as pool:
                for code, value in pool.map(_fetch_one, codes):
                    if value is not None:
                        raw[code] = value
```

- [ ] **Step 4: Run the adapter tests + full suite**

Run: `py -3.10 -m pytest tests/test_wb_data360.py tests/ -q`
Expected: all green (278 passed, 31 skipped)

- [ ] **Step 5: Commit**

```bash
git add epichat/adapters/wb_data360.py tests/test_wb_data360.py
git commit -m "perf: fetch WB Data360 indicators concurrently

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Chat formatting functions

**Files:**
- Modify: `epichat/chat_controller.py` (append after `_abbrev`, ~line 55)
- Test: `tests/test_chat_controller.py` (append)

**Interfaces:**
- Consumes: `DataQuery`, `ResolvedField`, `SimParams`, existing `_abbrev(citation)`, `language.translate`.
- Produces (used by Task 5):
  - `describe_query(query: DataQuery) -> str`
  - `format_understanding_card(params: SimParams, queries: list[DataQuery], disease_name: str | None = None, lang: str = "English") -> str`
  - `format_tool_result(query: DataQuery, fields: list[ResolvedField]) -> str`
  - `format_tool_failure(query: DataQuery, reason: str) -> str`

- [ ] **Step 1: Write the failing tests** (append to `tests/test_chat_controller.py`)

```python
# ── Staged-pipeline formatting ────────────────────────────────────────────────

def _dq(**kw):
    from epichat.resolver import DataQuery
    return DataQuery(**{"source": "wb_data360", **kw})


def _rf(field="total_population", value=213_600_000, citation="UN WPP 2024"):
    from epichat.resolver import ResolvedField
    return ResolvedField(field=field, value=value, citation=citation)


class TestDescribeQuery:
    def test_known_sources_get_friendly_names(self):
        from epichat.chat_controller import describe_query
        assert "World Bank" in describe_query(_dq(location_code="BRA"))
        assert "UN WPP" in describe_query(_dq(source="un_wpp", location_id=76))
        assert "WHO" in describe_query(_dq(source="who_gho", location_code="BRA"))

    def test_includes_target_location(self):
        from epichat.chat_controller import describe_query
        assert "BRA" in describe_query(_dq(location_code="BRA"))

    def test_unknown_source_falls_back_to_raw_name(self):
        from epichat.chat_controller import describe_query
        assert "mystery" in describe_query(_dq(source="mystery"))


class TestUnderstandingCard:
    def test_card_lists_settings_and_fetch_plan(self):
        from epichat.chat_controller import format_understanding_card
        from epichat.schema import SimParams
        params = SimParams(beta=1.0, disease_type="seir", n_agents=100_000, sim_dur_years=1.0)
        card = format_understanding_card(
            params, [_dq(location_code="BRA")], disease_name="dengue",
        )
        assert "dengue" in card.lower()
        assert "SEIR" in card
        assert "100,000" in card
        assert "World Bank" in card          # fetch plan present
        assert "fetch the data" in card      # confirmation ask present

    def test_card_without_queries_omits_fetch_plan(self):
        from epichat.chat_controller import format_understanding_card
        from epichat.schema import SimParams
        card = format_understanding_card(SimParams(beta=1.0), [])
        assert "plan to fetch" not in card


class TestToolLines:
    def test_result_line_has_source_values_citation(self):
        from epichat.chat_controller import format_tool_result
        line = format_tool_result(
            _dq(source="un_wpp", location_id=76), [_rf()],
        )
        assert line.startswith("🔧")
        assert "UN WPP" in line
        assert "213,600,000" in line or "2.136e+08" in line

    def test_empty_fields_marked_as_no_data(self):
        from epichat.chat_controller import format_tool_result
        line = format_tool_result(_dq(location_code="BRA"), [])
        assert line.startswith("⚠")

    def test_failure_line(self):
        from epichat.chat_controller import format_tool_failure
        line = format_tool_failure(_dq(location_code="BRA"), "timed out")
        assert line.startswith("⚠") and "timed out" in line
```

- [ ] **Step 2: Run to verify failure**

Run: `py -3.10 -m pytest tests/test_chat_controller.py -q -k "DescribeQuery or UnderstandingCard or ToolLines"`
Expected: ImportError on `describe_query`

- [ ] **Step 3: Implement in `epichat/chat_controller.py`** (append after `_abbrev`)

```python
_QUERY_SOURCES: dict[str, str] = {
    "un_wpp": "UN WPP (population & age structure)",
    "wb_data360": "World Bank WDI (health & demographic indicators)",
    "who_gho": "WHO GHO (vaccination coverage)",
}


def describe_query(query) -> str:
    """Human-readable name for a DataQuery: source + target location."""
    label = _QUERY_SOURCES.get(query.source, query.source)
    if query.location_code:
        where = query.location_code
    elif getattr(query, "location_id", 0):
        where = f"location #{query.location_id}"
    else:
        where = "global"
    return f"{label} — {where}"


def _fmt_value(v) -> str:
    if isinstance(v, bool):
        return str(v)
    if isinstance(v, int):
        return f"{v:,}"
    if isinstance(v, float):
        return f"{v:,.4g}"
    if isinstance(v, dict):
        return ", ".join(f"{k}: {vv}" for k, vv in list(v.items())[:3])
    return str(v)


def format_understanding_card(
    params,
    queries: list,
    disease_name: str | None = None,
    lang: str = "English",
) -> str:
    """The Stage-1 'here is what I understood' message with the fetch plan."""
    lines = ["**Here's what I understood:**", ""]
    if disease_name:
        lines.append(f"- **Disease:** {disease_name}")
    lines.append(f"- **Model:** {params.disease_type.upper()}")
    location = next((q.location_code for q in queries if q.location_code), None)
    if location:
        lines.append(f"- **Location:** {location}")
    lines.append(f"- **Population (agents):** {params.n_agents:,}")
    lines.append(f"- **Duration:** {params.sim_dur_years:g} year(s)")
    if params.interventions:
        kinds = ", ".join(i.type for i in params.interventions)
        lines.append(f"- **Interventions:** {kinds}")
    if queries:
        lines.append("")
        lines.append("**I plan to fetch:**")
        for q in queries:
            lines.append(f"- {describe_query(q)}")
    lines.append("")
    lines.append("Anything to change, or shall I fetch the data?")
    card = "\n".join(lines)
    if lang != "English":
        from .language import translate
        card = translate(card, lang)
    return card


def format_tool_result(query, fields: list) -> str:
    """Persistent chat line for one completed data fetch."""
    label = describe_query(query)
    if not fields:
        return f"⚠ **{label}** — no data returned"
    parts = [
        f"{f.field.replace('_', ' ')}: {_fmt_value(f.value)}" for f in fields[:4]
    ]
    more = f" (+{len(fields) - 4} more)" if len(fields) > 4 else ""
    cite = _abbrev(fields[0].citation)
    return f"🔧 **{label}** — " + "; ".join(parts) + more + f"  [{cite}]"


def format_tool_failure(query, reason: str) -> str:
    return f"⚠ **{describe_query(query)}** — {reason}; continuing without it"
```

- [ ] **Step 4: Run the tests**

Run: `py -3.10 -m pytest tests/test_chat_controller.py tests/ -q`
Expected: all green

- [ ] **Step 5: Commit**

```bash
git add epichat/chat_controller.py tests/test_chat_controller.py
git commit -m "feat: understanding-card and per-tool chat line formatting

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Language detection hardening

**Files:**
- Modify: `epichat/language.py:28-33` (system prompt in `detect_language`)
- Test: `tests/test_language.py` (append)

**Interfaces:**
- Produces: module constant `_DETECT_SYSTEM` (referenced by tests); `detect_language` signature unchanged.

- [ ] **Step 1: Write the failing test** (append to `tests/test_language.py`; follow that file's existing mocking idiom)

```python
def test_detect_prompt_guards_against_topic_language():
    """The prompt must judge the written language, not mentioned places/diseases."""
    from epichat.language import _DETECT_SYSTEM
    assert "WRITTEN" in _DETECT_SYSTEM
    assert "dengue epidemic in Brazil" in _DETECT_SYSTEM  # few-shot anchor
```

- [ ] **Step 2: Run to verify failure**

Run: `py -3.10 -m pytest tests/test_language.py -q -k topic_language`
Expected: ImportError on `_DETECT_SYSTEM`

- [ ] **Step 3: Implement** — in `epichat/language.py`, extract the inline system
string into a module constant and use it in `detect_language`:

```python
_DETECT_SYSTEM = (
    "Identify the language the user's text is WRITTEN in. "
    "Judge only the words and grammar of the text itself — countries, places, "
    "diseases, and foreign loanwords merely MENTIONED in the text do not "
    'count. For example, "Model a dengue epidemic in Brazil" is written in '
    "English. Reply with ONLY the language name in English — one short "
    "phrase. Examples: English, French, Spanish, Arabic, Chinese "
    "(Simplified), Hindi, Portuguese, Japanese, Swahili. Never explain."
)
```

and in `detect_language`, replace `system=( ... )` with `system=_DETECT_SYSTEM`.

- [ ] **Step 4: Run tests**

Run: `py -3.10 -m pytest tests/test_language.py tests/ -q`
Expected: all green

- [ ] **Step 5: Commit**

```bash
git add epichat/language.py tests/test_language.py
git commit -m "fix: language detection judges written language, not topic

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: App orchestration — confirm stage and visible parallel fetch

**Files:**
- Modify: `app.py` — imports (~line 32), `_CONV_DEFAULTS` (~line 80), `_do_parse` region (~line 195), and the `collecting` branch of `_process_pending` (~line 320)

**Interfaces:**
- Consumes: Task 1 `extract_intent/fetch_query/finalize_params`; Task 3 formatters; existing `detect_run_intent`, `detect_new_scenario`, `update_collected`, `next_question`, `_build_summary_with_description`, `_add_msg`, `_lang`.
- Produces: session keys `pending_intent`, `fetch_cache` (dict), stage value `"confirm"`.

No unit tests (Streamlit session flow) — Task 6 verifies live. Keep all logic
that can be pure in chat_controller (already done in Task 3).

- [ ] **Step 1: Update imports** — replace the parser import block with:

```python
from epichat.parser import (
    ClarificationNeeded,
    extract_intent,
    fetch_query,
    finalize_params,
    get_last_resolved,
    get_last_location_queried,
    parse_query,
)
from epichat.chat_controller import (
    describe_query,
    format_tool_failure,
    format_tool_result,
    format_understanding_card,
)
```

(merge with the existing `epichat.chat_controller` import block rather than
duplicating it), and add to `_CONV_DEFAULTS`:

```python
    "pending_intent": None,
    "fetch_cache": {},
```

- [ ] **Step 2: Replace `_do_parse` with the staged helpers**

```python
def _do_understand() -> None:
    """Stage 1: extract intent; on ambiguity store the clarifying question."""
    s = st.session_state
    s.pending_intent = None
    s.parse_clarification = None
    for attempt in (1, 2):
        try:
            s.pending_intent = extract_intent(s.context, s.get("outbreak_context"))
            return
        except ClarificationNeeded as e:
            s.parse_clarification = e.question
            return
        except Exception:
            _logger.exception("extract_intent failed (attempt %d/2)", attempt)


def _detected_disease_name() -> str | None:
    s = st.session_state
    ctx = s.get("outbreak_context")
    if ctx is not None and ctx.disease_name:
        return ctx.disease_name
    from epichat.disease_db import detect_disease
    return detect_disease(s.context)


def _do_fetch_and_finalize() -> None:
    """Stage 2: parallel data fetches with per-tool chat lines, then finalize."""
    s = st.session_state
    intent = s.pending_intent
    resolved: list = []
    with st.status("Fetching data…", expanded=True) as status:
        pending = []
        for q in intent.data_queries:
            key = repr(q)
            if key in s.fetch_cache:
                resolved.extend(s.fetch_cache[key])   # reuse, no duplicate line
            else:
                pending.append((key, q))
        if pending:
            from concurrent.futures import ThreadPoolExecutor, as_completed
            with ThreadPoolExecutor(max_workers=min(4, len(pending))) as pool:
                futures = {pool.submit(fetch_query, q): (key, q) for key, q in pending}
                for fut in as_completed(futures):
                    key, q = futures[fut]
                    try:
                        fields = fut.result()
                    except Exception as exc:
                        _logger.exception("fetch_query failed for %s", q.source)
                        line = format_tool_failure(q, str(exc)[:120])
                        fields = []
                    else:
                        line = format_tool_result(q, fields)
                    s.fetch_cache[key] = fields
                    resolved.extend(fields)
                    status.write(line)
                    _add_msg("assistant", line)
        status.update(label="Calibrating parameters…")
        s.params = None
        for attempt in (1, 2):
            try:
                s.params = finalize_params(s.context, intent, resolved)
                break
            except Exception:
                _logger.exception("finalize_params failed (attempt %d/2)", attempt)
        s.data_sources = get_last_resolved()
        if get_last_location_queried():
            s._location_recognized = True
        status.update(label="Data ready", state="complete", expanded=False)
    _add_msg("assistant", "🧮 Parameters calibrated (β matched to literature R₀; "
                          "demographics filled at generation)")
```

- [ ] **Step 3: Rewire `_process_pending`** — replace the body of the
`if s.stage == "collecting":` branch with:

```python
    if s.stage == "collecting":
        s.context = (s.context + " " + text).strip()
        if s.outbreak_context is None:
            _do_enrich(text)
            if DEV_MODE and s.outbreak_context is not None and s.outbreak_context.disease_name is not None:
                _add_msg("assistant", _format_context_card(s.outbreak_context))
        _do_understand()
        if s.pending_intent is None:
            _add_msg(
                "assistant",
                s.parse_clarification
                or "I had trouble understanding that. Could you rephrase? "
                   "For example: 'Simulate HIV in Kenya'.",
            )
            return
        _add_msg("assistant", format_understanding_card(
            s.pending_intent.preliminary_params,
            s.pending_intent.data_queries,
            disease_name=_detected_disease_name(),
            lang=_lang(),
        ))
        s.stage = "confirm"

    elif s.stage == "confirm":
        if detect_new_scenario(text):
            _start_new_scenario(text)
            return
        if detect_run_intent(text):
            _do_fetch_and_finalize()
            if s.params is None:
                _add_msg("assistant",
                         "I couldn't finalize the parameters — could you rephrase "
                         "or adjust the settings?")
                s.stage = "collecting"
                return
            s.collected = update_collected(
                s.collected, s.params, s.data_sources, s.context,
                outbreak_context=s.outbreak_context,
            )
            if st.session_state.get("_location_recognized"):
                s.collected["location"] = True
                s.collected["population"] = True
                st.session_state._location_recognized = False
            question = next_question(s.collected, s.params, s.data_sources, lang=_lang())
            if question is None:
                _add_msg("assistant", _build_summary_with_description())
                s.stage = "ready"
            else:
                _add_msg("assistant", question)
                s.stage = "collecting"
        else:
            # Treat as a correction: fold into context and re-present the card
            s.context = (s.context + " " + text).strip()
            _do_understand()
            if s.pending_intent is None:
                _add_msg(
                    "assistant",
                    s.parse_clarification
                    or "I had trouble understanding that. Could you rephrase?",
                )
                s.stage = "collecting"
                return
            _add_msg("assistant", format_understanding_card(
                s.pending_intent.preliminary_params,
                s.pending_intent.data_queries,
                disease_name=_detected_disease_name(),
                lang=_lang(),
            ))
```

Keep the existing `elif s.stage == "ready":` branch and everything after it
unchanged. Delete the now-unused `_do_parse` (its only caller was the old
collecting branch); `parse_query` remains imported for the modify/ready path
if referenced there — check with `grep -n "_do_parse\|parse_query" app.py`
and remove the import only if truly unused.

- [ ] **Step 4: Sanity-run the suite and a syntax check**

Run: `py -3.10 -m pytest tests/ -q && py -3.10 -m py_compile app.py`
Expected: suite green; app compiles

- [ ] **Step 5: Commit**

```bash
git add app.py
git commit -m "feat: staged chat flow — understand, confirm, visible parallel fetch

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Live verification

**Files:** none (verification only; fix-forward commits if issues found)

- [ ] **Step 1: Restart the app**

Stop the running background streamlit task, then:
`py -3.10 -m streamlit run app.py --server.headless true --server.port 8502` (background)
and wait for HTTP 200 on http://localhost:8502.

- [ ] **Step 2: Drive the dengue flow in the browser**

Type `Model a dengue epidemic in Brazil`. Verify:
- Understanding card appears in **English** within ~10s: disease dengue,
  model type, location BRA, agents, duration, fetch plan listing UN WPP +
  World Bank lines, ending with the confirm ask.
- Reply `go`. Verify per-tool 🔧 lines land as fetches complete, then the 🧮
  calibration line, then the summary — all in English.
- Total fetch wall time noticeably shorter than the previous ~90s run.

- [ ] **Step 3: Verify correction path**

Reply flow: new chat → `model an outbreak` → clarifying question appears →
`dengue in Brazil` → card → `make it 50,000 people` → updated card showing
50,000 → `go` → tool lines and summary.

- [ ] **Step 4: Verify no regression on a plain query**

New chat → `Run a default SIR model` → card (no fetch plan section) → `go`
→ straight to calibration + summary (no tool lines, nothing to fetch).

- [ ] **Step 5: Screenshot the final dengue transcript for the user; report results.**
