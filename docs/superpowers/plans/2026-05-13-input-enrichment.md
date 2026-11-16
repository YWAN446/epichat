# Input Enrichment Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pre-processing enrichment layer that accepts any input type (simple query, pasted report, URL, search request), extracts structured epidemiological facts into `OutbreakContext`, and passes that context into the existing `parse_query()` pipeline.

**Architecture:** A new `enricher.py` module runs before `parse_query()` on the first message of every scenario. It calls `claude-haiku-4-5-20251001` with the Anthropic `web_search_20250305` built-in tool, which handles URL fetching and news search internally via an agentic loop. The returned `OutbreakContext` Pydantic model (all fields nullable) is stored in session state and forwarded to `parse_query()` as additional context. A `EPICHAT_DEV_MODE` env flag renders the extracted fields as a chat message for testing.

**Tech Stack:** Python 3.10+, Pydantic v2, `anthropic>=0.76.0` (web_search_20250305 tool), Streamlit, pytest, unittest.mock

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `epichat/epichat/schema.py` | Add `OutbreakContext` Pydantic model |
| Create | `epichat/epichat/prompts/enrichment.txt` | System prompt for enrichment LLM call |
| Create | `epichat/epichat/enricher.py` | `enrich_input()` — LLM call + agentic loop + JSON parse |
| Modify | `epichat/epichat/prompts/extraction.txt` | Add OutbreakContext guidance section |
| Modify | `epichat/epichat/parser.py` | `parse_query()` and `_llm_call_1()` accept `OutbreakContext` |
| Modify | `epichat/epichat/chat_controller.py` | `update_collected()` pre-fills from `OutbreakContext` |
| Modify | `epichat/app.py` | Wire enrichment, dev mode card, pass context |
| Create | `epichat/tests/test_enricher.py` | Unit tests for enricher |
| Modify | `epichat/tests/test_parser_unit.py` | Tests for context-aware `parse_query()` |
| Modify | `epichat/tests/test_chat_controller.py` | Tests for updated `update_collected()` |

---

## Task 1: Add OutbreakContext to schema.py

**Files:**
- Modify: `epichat/epichat/schema.py`

- [ ] **Step 1: Write the failing test**

Create `epichat/tests/test_outbreak_context.py`:

```python
from epichat.schema import OutbreakContext


def test_all_fields_default_to_none():
    ctx = OutbreakContext(input_type="query")
    assert ctx.disease_name is None
    assert ctx.location is None
    assert ctx.total_cases is None
    assert ctx.total_deaths is None
    assert ctx.case_fatality_rate is None
    assert ctx.r0_estimate is None
    assert ctx.incubation_period_days is None
    assert ctx.infectious_period_days is None
    assert ctx.affected_population is None
    assert ctx.source_url is None
    assert ctx.pathogen_type is None
    assert ctx.geographic_scale is None
    assert ctx.outbreak_start_date is None
    assert ctx.outbreak_end_date is None
    assert ctx.interventions_mentioned == []
    assert ctx.confidence == "low"


def test_partial_fields_validate():
    ctx = OutbreakContext(
        input_type="report",
        disease_name="Mpox",
        location="Nigeria",
        total_cases=1240,
        total_deaths=38,
        confidence="high",
    )
    assert ctx.case_fatality_rate is None
    assert ctx.interventions_mentioned == []


def test_invalid_input_type_raises():
    import pytest
    with pytest.raises(Exception):
        OutbreakContext(input_type="unknown_type")


def test_invalid_geographic_scale_raises():
    import pytest
    with pytest.raises(Exception):
        OutbreakContext(input_type="query", geographic_scale="continent")
```

- [ ] **Step 2: Run test to verify it fails**

```
cd epichat
pytest tests/test_outbreak_context.py -v
```
Expected: `ImportError` or `AttributeError` — `OutbreakContext` does not exist yet.

- [ ] **Step 3: Add OutbreakContext to schema.py**

Open `epichat/epichat/schema.py`. After the existing imports, add `OutbreakContext` at the end of the file (after `SimParams`):

```python
class OutbreakContext(BaseModel):
    input_type: Literal["query", "report", "url", "search"]
    source_url: Optional[str] = None
    disease_name: Optional[str] = None
    pathogen_type: Optional[str] = None
    location: Optional[str] = None
    geographic_scale: Optional[Literal["city", "regional", "national", "global"]] = None
    outbreak_start_date: Optional[str] = None
    outbreak_end_date: Optional[str] = None
    total_cases: Optional[int] = None
    total_deaths: Optional[int] = None
    case_fatality_rate: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    r0_estimate: Optional[float] = Field(default=None, gt=0.0)
    incubation_period_days: Optional[float] = Field(default=None, gt=0.0)
    infectious_period_days: Optional[float] = Field(default=None, gt=0.0)
    affected_population: Optional[str] = None
    interventions_mentioned: List[str] = []
    confidence: Literal["high", "medium", "low"] = "low"
```

`List`, `Optional`, `Literal`, `Field` are already imported in `schema.py`.

- [ ] **Step 4: Run tests to verify they pass**

```
pytest tests/test_outbreak_context.py -v
```
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```
git add epichat/schema.py tests/test_outbreak_context.py
git commit -m "feat: add OutbreakContext schema model"
```

---

## Task 2: Write enrichment.txt prompt

**Files:**
- Create: `epichat/epichat/prompts/enrichment.txt`

- [ ] **Step 1: Create the enrichment system prompt**

Create `epichat/epichat/prompts/enrichment.txt` with this content:

```
You are an epidemiological data extraction assistant. Your job is to extract structured outbreak information from any type of user input and return it as a single JSON object.

## Input types

Identify which type the input is:
- **query**: a brief natural language request (e.g. "simulate COVID in Kenya")
- **report**: a long block of pasted text containing epidemiological data
- **url**: a link to an online article or report — use web_search to fetch its content
- **search**: a request to find information (e.g. "search for recent mpox outbreak in Nigeria") — use web_search to find relevant articles

## What to extract

Return a JSON object with these fields (set to null if unknown):

- input_type: one of "query", "report", "url", "search"
- source_url: URL of the primary source, or null
- disease_name: common name (e.g. "Mpox", "COVID-19", "Influenza H5N1"), or null
- pathogen_type: "virus", "bacteria", "parasite", "fungus", or null
- location: country or region name, or null
- geographic_scale: "city", "regional", "national", or "global", or null
- outbreak_start_date: ISO date or descriptive date string (e.g. "2024-01"), or null
- outbreak_end_date: date the outbreak ended, or null if ongoing or unknown
- total_cases: integer count of confirmed/suspected cases, or null
- total_deaths: integer death count, or null
- case_fatality_rate: decimal fraction of deaths per case (0.0–1.0), or null
- r0_estimate: basic reproduction number, or null
- incubation_period_days: days from exposure to symptom onset, or null
- infectious_period_days: days a case is infectious, or null
- affected_population: who is primarily at risk (e.g. "children under 5"), or null
- interventions_mentioned: list of intervention strings from the source, or []
- confidence: "high" (detailed report), "medium" (news article/partial), or "low" (brief query)

## Critical rules

1. NEVER guess. If you are not certain, set the field to null.
2. Extract only facts explicitly stated in the source. Do not calculate case_fatality_rate unless both total_cases and total_deaths are clearly stated.
3. Use web_search when input_type is "url" or "search". Do not fabricate article content.
4. Return ONLY a valid JSON object. No markdown fences, no explanation.

## Example output for a news article URL

{"input_type":"url","source_url":"https://example.com/report","disease_name":"Mpox","pathogen_type":"virus","location":"Nigeria","geographic_scale":"national","outbreak_start_date":"2024-01","outbreak_end_date":null,"total_cases":1240,"total_deaths":38,"case_fatality_rate":0.031,"r0_estimate":null,"incubation_period_days":null,"infectious_period_days":null,"affected_population":"young adults","interventions_mentioned":["ring vaccination"],"confidence":"medium"}
```

- [ ] **Step 2: Verify the file was created**

```
python -c "from pathlib import Path; print(Path('epichat/prompts/enrichment.txt').read_text()[:100])"
```
Expected: first 100 characters of the prompt.

- [ ] **Step 3: Commit**

```
git add epichat/prompts/enrichment.txt
git commit -m "feat: add enrichment LLM system prompt"
```

---

## Task 3: Create enricher.py

**Files:**
- Create: `epichat/epichat/enricher.py`
- Create: `epichat/tests/test_enricher.py`

- [ ] **Step 1: Write failing tests**

Create `epichat/tests/test_enricher.py`:

```python
from unittest.mock import MagicMock, patch

import pytest

from epichat.schema import OutbreakContext


def _mock_response(text: str, stop_reason: str = "end_turn"):
    block = MagicMock()
    block.type = "text"
    block.text = text
    resp = MagicMock()
    resp.stop_reason = stop_reason
    resp.content = [block]
    return resp


def test_enrich_simple_query():
    payload = '{"input_type":"query","disease_name":"COVID-19","location":"Kenya","confidence":"low"}'
    with patch("epichat.enricher.anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.return_value = _mock_response(payload)
        from epichat.enricher import enrich_input
        ctx = enrich_input("Simulate COVID-19 in Kenya")
    assert isinstance(ctx, OutbreakContext)
    assert ctx.input_type == "query"
    assert ctx.disease_name == "COVID-19"
    assert ctx.location == "Kenya"


def test_enrich_falls_back_on_api_error():
    with patch("epichat.enricher.anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.side_effect = Exception("network error")
        from epichat.enricher import enrich_input
        ctx = enrich_input("anything")
    assert isinstance(ctx, OutbreakContext)
    assert ctx.input_type == "query"
    assert ctx.disease_name is None


def test_enrich_falls_back_on_invalid_json():
    with patch("epichat.enricher.anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.return_value = _mock_response("not valid json")
        from epichat.enricher import enrich_input
        ctx = enrich_input("anything")
    assert isinstance(ctx, OutbreakContext)
    assert ctx.input_type == "query"


def test_enrich_handles_tool_use_then_end_turn():
    tool_block = MagicMock()
    tool_block.type = "tool_use"
    tool_block.id = "tu_123"
    tool_resp = MagicMock()
    tool_resp.stop_reason = "tool_use"
    tool_resp.content = [tool_block]

    final_payload = '{"input_type":"search","disease_name":"Mpox","location":"DRC","confidence":"medium"}'
    final_resp = _mock_response(final_payload)

    with patch("epichat.enricher.anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [tool_resp, final_resp]
        from epichat.enricher import enrich_input
        ctx = enrich_input("search for mpox in DRC")
    assert ctx.input_type == "search"
    assert ctx.disease_name == "Mpox"
    assert ctx.location == "DRC"
```

- [ ] **Step 2: Run tests to verify they fail**

```
pytest tests/test_enricher.py -v
```
Expected: `ImportError` — `epichat.enricher` does not exist.

- [ ] **Step 3: Create enricher.py**

Create `epichat/epichat/enricher.py`:

```python
from __future__ import annotations

import json
import os
from pathlib import Path

import anthropic
from dotenv import load_dotenv

from .schema import OutbreakContext

load_dotenv()

_ENRICHMENT_MODEL = "claude-haiku-4-5-20251001"
_PROMPT_PATH = Path(__file__).parent / "prompts" / "enrichment.txt"


def enrich_input(user_input: str) -> OutbreakContext:
    """Extract structured outbreak context from any input type.

    Uses the Anthropic web_search tool for URL and search inputs.
    Returns OutbreakContext(input_type="query") on any failure.
    """
    try:
        return _call_enrichment_llm(user_input)
    except Exception:
        return OutbreakContext(input_type="query")


def _call_enrichment_llm(user_input: str) -> OutbreakContext:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    system = _PROMPT_PATH.read_text(encoding="utf-8")
    messages: list[dict] = [{"role": "user", "content": user_input}]

    for _ in range(10):
        response = client.messages.create(
            model=_ENRICHMENT_MODEL,
            max_tokens=2048,
            system=system,
            tools=[{"type": "web_search_20250305", "name": "web_search"}],
            messages=messages,
        )
        text_blocks = [b.text for b in response.content if b.type == "text"]

        if response.stop_reason == "end_turn":
            raw = text_blocks[-1] if text_blocks else "{}"
            return _parse_context(raw)

        if response.stop_reason == "tool_use":
            messages = messages + [
                {"role": "assistant", "content": response.content},
                {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": b.id, "content": ""}
                        for b in response.content
                        if b.type == "tool_use"
                    ],
                },
            ]
            continue

        raw = text_blocks[-1] if text_blocks else "{}"
        return _parse_context(raw)

    return OutbreakContext(input_type="query")


def _parse_context(raw: str) -> OutbreakContext:
    if "```" in raw:
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    brace = raw.find("{")
    if brace > 0:
        raw = raw[brace:]
    data = json.loads(raw)
    return OutbreakContext.model_validate(data)
```

- [ ] **Step 4: Run tests to verify they pass**

```
pytest tests/test_enricher.py -v
```
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```
git add epichat/enricher.py tests/test_enricher.py
git commit -m "feat: add enricher module with web_search agentic loop"
```

---

## Task 4: Update extraction.txt and parser.py

**Files:**
- Modify: `epichat/epichat/prompts/extraction.txt`
- Modify: `epichat/epichat/parser.py`
- Modify: `epichat/tests/test_parser_unit.py`

- [ ] **Step 1: Write failing test for context-aware parse_query**

Open `epichat/tests/test_parser_unit.py` and add at the end:

```python
from unittest.mock import MagicMock, patch
from epichat.schema import OutbreakContext


def _make_intent_response(disease_type="sir", beta=22.8125):
    payload = (
        '{"preliminary_params":{"disease_type":"' + disease_type + '",'
        '"n_agents":10000,"n_contacts":4,"network_type":"random",'
        '"network_beta":1.0,"beta":' + str(beta) + ',"init_prev":0.01,'
        '"dur_inf":10.0,"dur_exp":null,"dur_immune":null,"p_asymp":0.3,'
        '"rel_trans_asymp":0.5,"p_death":0.0,"sim_dur_years":1.0,'
        '"rand_seed":null,"use_demographics":false,"birth_rate":20.0,'
        '"death_rate":10.0,"interventions":[]},"data_queries":[]}'
    )
    block = MagicMock()
    block.type = "text"
    block.text = payload
    resp = MagicMock()
    resp.stop_reason = "end_turn"
    resp.content = [block]
    return resp


def test_parse_query_forwards_context_to_llm(monkeypatch):
    ctx = OutbreakContext(
        input_type="report",
        disease_name="Ebola",
        location="DRC",
        total_cases=500,
        confidence="high",
    )
    captured = {}

    def fake_create(**kwargs):
        captured["messages"] = kwargs["messages"]
        return _make_intent_response()

    with patch("epichat.parser.anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.side_effect = fake_create
        from epichat.parser import parse_query
        parse_query("run ebola sim", context=ctx)

    user_content = captured["messages"][0]["content"]
    assert "Outbreak context" in user_content
    assert "Ebola" in user_content
    assert "DRC" in user_content


def test_parse_query_without_context_unchanged(monkeypatch):
    captured = {}

    def fake_create(**kwargs):
        captured["messages"] = kwargs["messages"]
        return _make_intent_response()

    with patch("epichat.parser.anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.side_effect = fake_create
        from epichat.parser import parse_query
        parse_query("run a default SIR model")

    user_content = captured["messages"][0]["content"]
    assert "Outbreak context" not in user_content
```

- [ ] **Step 2: Run tests to verify they fail**

```
pytest tests/test_parser_unit.py::test_parse_query_forwards_context_to_llm tests/test_parser_unit.py::test_parse_query_without_context_unchanged -v
```
Expected: FAIL — `parse_query` does not accept `context` yet.

- [ ] **Step 3: Append context guidance to extraction.txt**

Open `epichat/epichat/prompts/extraction.txt`. At the very end of the file, append:

```
## Outbreak context (when provided)

If the user message begins with an "Outbreak context" block, use its values to inform your parameter choices:
- Use disease_name to select disease_type if it matches a known disease in the table above.
- Use total_cases and total_deaths to refine init_prev and p_death if not stated in the query.
- Use r0_estimate to compute beta if R0 is not stated in the query.
- Use location to populate data_queries if a country/region is present.
- User-stated values in the query always take precedence over context values.
```

- [ ] **Step 4: Add `_format_context` and update `_llm_call_1` and `parse_query` in parser.py**

Open `epichat/epichat/parser.py`. 

First, add the import at the top (after the existing `from .schema import SimParams` line):

```python
from .schema import OutbreakContext, SimParams
```

Then add the `_format_context` helper after the `_parse_json` function (around line 69):

```python
def _format_context(context: OutbreakContext) -> str:
    lines = ["Outbreak context (extracted from source):"]
    for key, val in context.model_dump(exclude={"input_type", "confidence"}).items():
        if val is not None and val != []:
            lines.append(f"  {key}: {val}")
    return "\n".join(lines)
```

Then update `_llm_call_1` signature and body (replace the existing `def _llm_call_1` function):

```python
def _llm_call_1(user_input: str, context: OutbreakContext | None = None) -> IntentResult:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    content = user_input
    if context is not None:
        content = _format_context(context) + "\n\nUser query: " + user_input
    message = client.messages.create(
        model=_MODEL,
        max_tokens=1500,
        system=_load_system_prompt(),
        messages=[{"role": "user", "content": content}],
    )
    raw = message.content[0].text.strip()
    data = _parse_json(raw)

    if "clarification_needed" in data:
        raise ValueError(f"Query needs clarification: {data['clarification_needed']}")

    if "preliminary_params" in data:
        prelim = data["preliminary_params"]
        prelim = {k: v for k, v in prelim.items() if v is not None or k in ("dur_exp", "dur_immune", "rand_seed", "capacity")}
        params = SimParams(**prelim)
        queries = [DataQuery(**q) for q in data.get("data_queries", [])]
        return IntentResult(preliminary_params=params, data_queries=queries)

    data = {k: v for k, v in data.items() if v is not None or k in ("dur_exp", "dur_immune", "rand_seed", "capacity")}
    return IntentResult(preliminary_params=SimParams(**data), data_queries=[])
```

Then update `parse_query` signature (replace just the `def parse_query` line and its docstring header):

```python
def parse_query(user_input: str, context: OutbreakContext | None = None) -> SimParams:
```

And inside `parse_query`, change the `_llm_call_1` call from:
```python
    intent = _llm_call_1(user_input)
```
to:
```python
    intent = _llm_call_1(user_input, context)
```

- [ ] **Step 5: Run tests to verify they pass**

```
pytest tests/test_parser_unit.py -v
```
Expected: all tests PASS including the two new ones.

- [ ] **Step 6: Commit**

```
git add epichat/prompts/extraction.txt epichat/parser.py tests/test_parser_unit.py
git commit -m "feat: parser accepts OutbreakContext as optional context for LLM-1"
```

---

## Task 5: Update chat_controller.py

**Files:**
- Modify: `epichat/epichat/chat_controller.py`
- Modify: `epichat/tests/test_chat_controller.py`

- [ ] **Step 1: Write failing tests**

Open `epichat/tests/test_chat_controller.py` and add at the end:

```python
from epichat.schema import OutbreakContext


def test_update_collected_prefills_disease_from_context():
    collected = {"disease": False, "location": False, "population": False, "interventions": False}
    ctx = OutbreakContext(input_type="report", disease_name="Ebola")
    result = update_collected(collected, None, [], "", outbreak_context=ctx)
    assert result["disease"] is True
    assert result["location"] is False


def test_update_collected_prefills_location_and_population_from_context():
    collected = {"disease": False, "location": False, "population": False, "interventions": False}
    ctx = OutbreakContext(input_type="url", location="Nigeria")
    result = update_collected(collected, None, [], "", outbreak_context=ctx)
    assert result["location"] is True
    assert result["population"] is True


def test_update_collected_prefills_interventions_from_context():
    collected = {"disease": False, "location": False, "population": False, "interventions": False}
    ctx = OutbreakContext(
        input_type="report",
        disease_name="Mpox",
        location="DRC",
        interventions_mentioned=["ring vaccination"],
    )
    result = update_collected(collected, None, [], "", outbreak_context=ctx)
    assert result["interventions"] is True


def test_update_collected_no_context_unchanged():
    collected = {"disease": False, "location": False, "population": False, "interventions": False}
    result = update_collected(collected, None, [], "")
    assert result == collected
```

Note: check the top of `test_chat_controller.py` for the existing import of `update_collected` — it should already be there.

- [ ] **Step 2: Run tests to verify they fail**

```
pytest tests/test_chat_controller.py::test_update_collected_prefills_disease_from_context tests/test_chat_controller.py::test_update_collected_prefills_location_and_population_from_context tests/test_chat_controller.py::test_update_collected_prefills_interventions_from_context tests/test_chat_controller.py::test_update_collected_no_context_unchanged -v
```
Expected: FAIL — `update_collected` does not accept `outbreak_context` yet.

- [ ] **Step 3: Update chat_controller.py**

Open `epichat/epichat/chat_controller.py`. 

Add `OutbreakContext` to the `TYPE_CHECKING` block:

```python
if TYPE_CHECKING:
    from .resolver import ResolvedField
    from .schema import OutbreakContext, SimParams
```

Replace the `def update_collected` function signature and add pre-filling logic at the top of the function body:

```python
def update_collected(
    collected: dict[str, bool],
    params,  # SimParams | None
    data_sources: list,
    last_user_message: str,
    outbreak_context: "OutbreakContext | None" = None,
) -> dict[str, bool]:
    result = dict(collected)

    # Pre-fill from OutbreakContext before applying params-based logic
    if outbreak_context is not None:
        if outbreak_context.disease_name is not None:
            result["disease"] = True
        if outbreak_context.location is not None:
            result["location"] = True
            result["population"] = True
        if outbreak_context.interventions_mentioned:
            result["interventions"] = True

    if params is None:
        return result

    msg_lower = last_user_message.lower().strip().rstrip(".")
    # ... (keep all existing logic below unchanged, but change `result = dict(collected)` 
    # at the original top of the function to just continue using the `result` dict already set above)
```

**Important:** The existing body of `update_collected` starts with `if params is None: return dict(collected)` and then `result = dict(collected)`. Replace those two lines with the new version above. All logic below (`if params.disease_type != "sir"...` etc.) remains unchanged and continues to work on `result`.

The full updated function body (replacing from `if params is None:` through `return result`):

```python
def update_collected(
    collected: dict[str, bool],
    params,  # SimParams | None
    data_sources: list,
    last_user_message: str,
    outbreak_context: "OutbreakContext | None" = None,
) -> dict[str, bool]:
    result = dict(collected)

    if outbreak_context is not None:
        if outbreak_context.disease_name is not None:
            result["disease"] = True
        if outbreak_context.location is not None:
            result["location"] = True
            result["population"] = True
        if outbreak_context.interventions_mentioned:
            result["interventions"] = True

    if params is None:
        return result

    msg_lower = last_user_message.lower().strip().rstrip(".")

    if (
        params.disease_type != "sir"
        or any(rf.field in _DISEASE_INDICATOR_FIELDS for rf in data_sources)
        or params.p_death > 0
        or params.dur_inf != 10.0
        or params.n_contacts != 4
        or bool(params.interventions)
    ):
        result["disease"] = True

    if any(rf.field == "total_population" for rf in data_sources):
        result["location"] = True

    if result["location"] or re.search(r"\b\d{4,}\b", last_user_message):
        result["population"] = True

    if result["disease"] and result["location"] and result["population"]:
        if params.interventions or any(w in msg_lower for w in _SKIP_WORDS):
            result["interventions"] = True

    return result
```

- [ ] **Step 4: Run tests to verify they pass**

```
pytest tests/test_chat_controller.py -v
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```
git add epichat/chat_controller.py tests/test_chat_controller.py
git commit -m "feat: update_collected pre-fills from OutbreakContext"
```

---

## Task 6: Update app.py

**Files:**
- Modify: `epichat/app.py`

- [ ] **Step 1: Add import and DEV_MODE constant**

Open `epichat/app.py`. 

After the existing `from epichat.parser import ...` line, add:

```python
from epichat.enricher import enrich_input
```

After `load_dotenv()` (near the top), add:

```python
DEV_MODE = os.environ.get("EPICHAT_DEV_MODE", "false").lower() == "true"
```

`os` is already imported via the existing `epichat.epichat` module chain — but `app.py` itself imports `os` indirectly. Add an explicit `import os` near the top of `app.py` if not already present. Check the file's imports — if `os` is missing, add `import os` after `import datetime`.

- [ ] **Step 2: Add outbreak_context to session state defaults**

In `_CONV_DEFAULTS`, add:

```python
    "outbreak_context": None,
```

- [ ] **Step 3: Add _do_enrich and _format_context_card functions**

Add these two functions after the existing `_do_parse()` function:

```python
def _do_enrich(text: str) -> None:
    try:
        st.session_state.outbreak_context = enrich_input(text)
    except Exception:
        st.session_state.outbreak_context = None


def _format_context_card(ctx) -> str:
    lines = ["**🔬 Extracted context (dev mode)**\n", "| Field | Value |", "|-------|-------|"]
    for k, v in ctx.model_dump().items():
        display_v = str(v) if v not in (None, []) else "*unknown*"
        lines.append(f"| {k} | {display_v} |")
    return "\n".join(lines)
```

- [ ] **Step 4: Update _do_parse to pass outbreak_context**

Replace the existing `_do_parse` function:

```python
def _do_parse() -> None:
    try:
        ctx = st.session_state.get("outbreak_context")
        st.session_state.params = parse_query(st.session_state.context, context=ctx)
        st.session_state.data_sources = get_last_resolved()
        if get_last_location_queried():
            st.session_state._location_recognized = True
    except Exception:
        pass
```

- [ ] **Step 5: Update _process_pending collecting stage**

In `_process_pending`, replace the `if s.stage == "collecting":` block:

```python
    if s.stage == "collecting":
        s.context = (s.context + " " + text).strip()
        if s.outbreak_context is None:
            _do_enrich(text)
            if DEV_MODE and s.outbreak_context is not None:
                _add_msg("assistant", _format_context_card(s.outbreak_context))
        _do_parse()
        s.collected = update_collected(
            s.collected, s.params, s.data_sources, text,
            outbreak_context=s.outbreak_context,
        )
        if st.session_state.get("_location_recognized"):
            s.collected["location"] = True
            s.collected["population"] = True
            st.session_state._location_recognized = False
        if s.params is None:
            _add_msg(
                "assistant",
                "I had trouble understanding that. Could you rephrase? "
                "For example: 'Simulate HIV in Kenya'.",
            )
            return
        question = next_question(s.collected, s.params, s.data_sources)
        if question is None:
            _add_msg("assistant", _build_summary_with_description())
            s.stage = "ready"
        else:
            _add_msg("assistant", question)
```

- [ ] **Step 6: Update _start_new_scenario to reset and enrich**

In `_start_new_scenario`, after `s.params = None` and `s.collected = {k: False for k in s.collected}`, add:

```python
    s.outbreak_context = None
```

Then after `s.context = text` and before `_do_parse()`, add the enrichment call:

```python
    _do_enrich(text)
    if DEV_MODE and s.outbreak_context is not None:
        _add_msg("assistant", _format_context_card(s.outbreak_context))
```

Also update the `update_collected` call in `_start_new_scenario` to pass `outbreak_context`:

```python
    s.collected = update_collected(
        s.collected, s.params, s.data_sources, text,
        outbreak_context=s.outbreak_context,
    )
```

- [ ] **Step 7: Smoke test the app**

```
cd epichat
EPICHAT_DEV_MODE=true streamlit run app.py
```

Test these three scenarios manually:
1. Type `simulate COVID in Kenya` — should show context card with disease_name=COVID-19 (or similar), location=Kenya, then proceed to Q&A.
2. Paste a paragraph of text describing an outbreak — should show extracted fields in card.
3. Type `search for recent mpox outbreak in DRC` — should trigger web_search, show populated card.

Verify in each case the context card appears before the parameter questions (in dev mode), and the parameter summary reflects extracted values.

- [ ] **Step 8: Commit**

```
git add app.py
git commit -m "feat: wire enrichment into app — dev mode card, context forwarded to parse_query"
```

---

## Task 7: Full regression check

**Files:** no new files

- [ ] **Step 1: Run full test suite**

```
cd epichat
pytest tests/ -v
```
Expected: all existing tests plus new tests PASS. No regressions.

- [ ] **Step 2: Run app in production mode and verify no dev card**

```
streamlit run app.py
```

Type `simulate measles in Nigeria with 80% vaccination`. Verify:
- No context card appears (DEV_MODE is off by default)
- The parameter summary appears as before
- The simulation runs successfully

- [ ] **Step 3: Final commit**

```
git add -u
git commit -m "feat: input enrichment layer complete — OutbreakContext, enricher, dev mode"
```
