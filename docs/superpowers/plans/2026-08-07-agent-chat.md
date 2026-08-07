# EpiChat Agent Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace rule-based chat routing with a Claude tool-calling agent (configure → fetch → parameterize → run → report), behind an `EPICHAT_AGENT` flag with the staged pipeline as fallback.

**Architecture:** New `epichat/agent.py`: `AgentState` + `build_tools(state)` (`@beta_tool` closures wrapping existing deterministic code) + `EpiChatAgent` driving `client.beta.messages.tool_runner` on `claude-opus-5` with history mirroring and UI event callbacks. `app.py` routes chat messages to the agent when the flag is on.

**Tech Stack:** anthropic SDK 0.76.0 (`beta_tool`, `tool_runner` verified present), Python 3.10, Streamlit, pydantic v2, pytest + unittest.mock.

## Global Constraints

- Worktree root: `C:\Users\Yuke\stat\other-projects\EpiChat\epichat\.claude\worktrees\integrate-annie`; run tests with `py -3.10 -m pytest tests/ -q`.
- Existing suite (291 passed / 31 skipped) stays green after every task; flag-off path byte-identical.
- Agent model: `claude-opus-5`, `max_tokens=16000`, thinking left at default, system prompt list with `cache_control: {"type": "ephemeral"}` on its last block, `stop_reason == "refusal"` handled before reading content.
- Tools never let the LLM transcribe epidemiological numbers: fetched values auto-apply to state.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Agent core — state, configure_simulation, lookup_disease

**Files:** Create `epichat/agent.py`; Test `tests/test_agent_tools.py`.

**Produces:**
- `AgentState` dataclass: `params: SimParams | None = None`, `data_sources: list = field(default_factory=list)`, `total_population: int | None = None`, `plot_path: str | None = None`, `stats: dict = field(default_factory=dict)`, `executor: object | None = None`, `context_text: str = ""` (accumulated user text for detect/citation purposes).
- `build_tools(state) -> list[BetaFunctionToolParam]` returning the decorated closures. Task 1 implements `configure_simulation` and `lookup_disease`; later tasks append to the same factory.

`configure_simulation` signature (all-optional keyword args; docstring is the tool description — write it prescriptively: "Call this whenever the user specifies or changes any simulation setting; call again with only the changed fields"):

```python
@beta_tool
def configure_simulation(
    disease: str | None = None,
    country_iso3: str | None = None,
    disease_type: str | None = None,
    n_agents: int | None = None,
    sim_dur_years: float | None = None,
    r0: float | None = None,
    dur_inf: float | None = None,
    dur_exp: float | None = None,
    dur_immune: float | None = None,
    p_death: float | None = None,
    p_asymp: float | None = None,
    init_prev: float | None = None,
    vaccine_coverage: float | None = None,
    treatment_capacity: int | None = None,
    seasonality_scale: float | None = None,
) -> str: ...
```

Behavior: start from `state.params.model_dump()` or `{"beta": 22.8125}` defaults; overlay provided fields (map `country_iso3`→`country`; build/replace Intervention entries for vaccine/treatment/seasonality); `SimParams.model_validate` (ValidationError → return `"CONFIG ERROR: <msg>"` so the agent self-corrects); if `r0` provided, `from .parser import _calibrate_beta` and set beta (clamped 0.001–1000, recomputed against the validated params); run `check_params` with the detected disease for warnings; store to `state.params`; return JSON `{applied, approx_r0, warnings}`.

`lookup_disease(disease_name: str) -> str`: `detect_disease`/`lookup` from disease_db; return JSON with canonical name, r0/incubation_days/infectious_days/fatality_rate flat views (min/max/typical/source) or `"UNKNOWN DISEASE"` listing available names.

**Tests (write first, watch fail, implement, pass, commit):** configure creates params from scratch; merges without losing prior fields; invalid value returns CONFIG ERROR string (no raise, state unchanged); r0 sets calibrated beta ≈ approx_r0 target; warnings appear for out-of-range values; vaccine_coverage adds an Intervention; lookup measles returns r0 min 12/max 18 with source; unknown disease reported. Run: `py -3.10 -m pytest tests/test_agent_tools.py tests/ -q`. Commit `feat: agent state and configuration tools`.

---

### Task 2: Fetch tools with deterministic auto-apply

**Files:** Modify `epichat/agent.py`; Test append `tests/test_agent_tools.py`.

- `fetch_demographics(country_iso3: str) -> str`: locate the registered `un_wpp` adapter via `parser._resolver._adapters.get("un_wpp")`; if present, resolve `location_id = adapter.location_id(iso3)` and `fetch_query(DataQuery(source="un_wpp", indicators=[55, 59, 71, 49], location_id=...))`. On no adapter/no data, fall back to `data_loaders.demographics.get_country_demographics` (offline CSV) wrapped into ResolvedFields. Auto-apply: `age_distribution_pct` → `age_pct_*` + `network_type="age_structured"` (reuse `_apply_age_distribution` semantics), `total_population` → `state.total_population`, birth/death → params + `use_demographics=True`, `country` set. Append fields to `state.data_sources`. Return JSON of applied values + citations.
- `fetch_health_system(country_iso3: str) -> str`: `fetch_query(DataQuery(source="wb_data360", indicator_codes=[beds, physicians, nurses, UHC codes], location_code=iso3))`; apply `treatment_capacity` to an existing treatment intervention's capacity (create none); record sources; return JSON.
- `fetch_vaccination_coverage(country_iso3: str, disease: str) -> str`: map disease→GHO indicator codes (reuse the mapping used by the staged pipeline's queries; at minimum measles→MCV1/2, pertussis→DTP3, polio→polio, hepatitis→HepB3); `fetch_query(DataQuery(source="who_gho", indicator_codes=..., location_code=iso3))`; auto-add vaccine Intervention at coverage/100 if none exists (reuse `_apply_vaccination_coverage` semantics); record sources; return JSON.
- All three: adapter/network exceptions → return `"FETCH ERROR: <msg>"` (never raise); params-absent guard (`configure_simulation` must run first → tell the agent so).

**Tests:** fake adapters registered into `parser._resolver` (restore in finally, mirroring `test_fetch_query_resolves_single_query`); demographics applies age pcts + population and records sources; offline fallback used when adapter missing (mock `get_country_demographics`); vaccination adds vaccine intervention once (not duplicated on second call); health-system applies capacity only when treatment exists; error strings on adapter raise. Commit `feat: agent data-fetch tools with deterministic auto-apply`.

---

### Task 3: run_simulation tool

**Files:** Modify `epichat/agent.py`; Test append `tests/test_agent_tools.py`.

`run_simulation() -> str`: guard params present; `pop_scale = state.total_population / params.n_agents` when known else 1.0; timestamped `results/sim_*.png` plot path; `exec_result = state.executor._execute_with_retry(state.context_text, state.params, plot_path, pop_scale=pop_scale)`; on `exec_result["error"]` return `"SIMULATION ERROR: ..."`; else store `state.stats`, `state.plot_path = exec_result["plot_path"]`; return JSON stats (peak, total infected, deaths, attack rate).

**Tests:** mock executor object with `_execute_with_retry` returning canned stats → state populated, JSON correct; error path returns SIMULATION ERROR and leaves stats empty; missing params guard. Commit `feat: agent run_simulation tool`.

---

### Task 4: EpiChatAgent loop

**Files:** Modify `epichat/agent.py`; Test `tests/test_agent_loop.py`.

- `_SYSTEM` prompt constant (workflow policy: understand; present settings + get explicit confirmation before fetching; fetch then parameterize; confirm before run_simulation; report with citations after; respond in the user's language; never state epidemiological values that did not come from a tool result; keep responses concise). Rendered as `[{"type":"text","text":_SYSTEM,"cache_control":{"type":"ephemeral"}}]`.
- `EpiChatAgent`: `__init__(executor)` builds `AgentState(executor=executor)`, `self.history: list = []`, `self.tools = build_tools(self.state)`, `self.client = anthropic.Anthropic()`.
- `handle(user_text: str, on_event: Callable[[str, dict], None]) -> None`:

```python
self.state.context_text += " " + user_text
self.history.append({"role": "user", "content": user_text})
runner = self.client.beta.messages.tool_runner(
    model="claude-opus-5", max_tokens=16000,
    system=_system_blocks(), tools=self.tools, messages=self.history,
)
for message in runner:
    if message.stop_reason == "refusal":
        on_event("text", {"text": _REFUSAL_MSG}); break
    for block in message.content:
        if block.type == "text" and block.text.strip():
            on_event("text", {"text": block.text})
        elif block.type == "tool_use":
            on_event("tool_use", {"name": block.name, "input": block.input})
    self.history.append({"role": "assistant", "content": message.content})
    tool_response = runner.generate_tool_call_response()
    if tool_response is not None:
        for tr in tool_response["content"]:
            on_event("tool_result", {"tool_use_id": tr["tool_use_id"],
                                     "content": tr.get("content"),
                                     "is_error": tr.get("is_error", False)})
        self.history.append(tool_response)
if self.state.plot_path:
    on_event("plot", {"path": self.state.plot_path,
                      "sources": list(self.state.data_sources)})
    self.state.plot_path = None
```

  Wrap the runner loop in try/except: `anthropic.APIError` and unexpected exceptions → `logger.exception` + `on_event("text", {...friendly error...})`; history left consistent (roll back the trailing user message only if nothing was appended after it).

**Tests (mocked client):** stub `client.beta.messages.tool_runner` to yield scripted messages (text-only turn; tool_use turn with a `generate_tool_call_response` returning a tool-result message) and assert: history mirroring order (user → assistant → tool result), events fired in order with right payloads, refusal path emits friendly text and stops, plot event fires when state.plot_path set. Use `SimpleNamespace`/`MagicMock` blocks with `.type`/`.text`/`.name`/`.input`. Commit `feat: EpiChatAgent tool-runner loop`.

---

### Task 5: App integration behind the flag

**Files:** Modify `app.py`; Modify `epichat/chat_controller.py` (one formatter); Modify `README.md` (flag doc). Test append `tests/test_chat_controller.py` (formatter only).

- `chat_controller.format_agent_tool_line(name: str, payload: dict, is_error: bool = False) -> str`: friendly names map (`configure_simulation`→"⚙️ Configured simulation", `lookup_disease`→"📖 Disease database", `fetch_demographics`→"🔧 UN WPP demographics", `fetch_health_system`→"🔧 World Bank health system", `fetch_vaccination_coverage`→"🔧 WHO vaccination coverage", `run_simulation`→"▶️ Simulation") + compact payload summary (reuse `_fmt_value`; truncate long strings); errors prefix ⚠. Unit-test name mapping, error prefix, truncation.
- `app.py`: `_USE_AGENT = os.environ.get("EPICHAT_AGENT", "1") != "0"`. Session state: `s.agent` created lazily per conversation (`EpiChatAgent(executor=s.chat)`), reset in `_reset_conversation`/`_start_new_scenario` paths and on New Chat. In `_process_pending`, before the stage machine: if `_USE_AGENT`: run `_agent_turn(text)` and return. `_agent_turn` wraps `s.agent.handle(text, on_event)` in `st.status("Working…")`; `on_event` maps: `text`→`_add_msg("assistant", ...)`, `tool_use`→`_add_msg("assistant", format_agent_tool_line(...))` + `status.write`, `tool_result` errors→⚠ line, `plot`→`_add_msg` with `plot_path` + `format_data_sources(sources, params=s.agent.state.params)` block; also mirror `s.params = s.agent.state.params` and `s.data_sources = s.agent.state.data_sources` after the turn so exports/summaries keep working.
- README: document `EPICHAT_AGENT` (default on; `0` restores the staged pipeline), the agent model, and the workflow.

Verify: `py -3.10 -m py_compile app.py` + full suite + `EPICHAT_AGENT=0` smoke (suite exercises staged path only anyway). Commit `feat: agent chat flow behind EPICHAT_AGENT flag`.

---

### Task 6: Live verification

1. Restart streamlit on 8502 (flag defaults on). Drive in browser: "Model a dengue epidemic in Brazil" → expect agent understanding + confirmation ask; "go" → 🔧 fetch lines + configure line; confirm → run → stats + plot + sources block, all in English.
2. New chat: "Simule uma epidemia de dengue no Brasil" → agent responds in Portuguese.
3. `EPICHAT_AGENT=0` restart → staged pipeline card flow still works (one quick query).
4. Fix-forward anything found; screenshot final transcript; report.
