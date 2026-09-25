"""Tool-calling agent for the EpiChat conversation flow.

The agent (claude-opus-5 via the Anthropic SDK tool runner) owns the chat:
it understands the request, confirms settings, fetches data, parameterizes,
runs the simulation, and reports — in the user's language. Every
epidemiological decision stays deterministic inside the tools below; the
model orchestrates but never invents or transcribes parameter values.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Callable

import anthropic
from anthropic import beta_tool

from .schema import SimParams

logger = logging.getLogger(__name__)

_MODEL = "claude-opus-5"
_MAX_TOKENS = 16000

_MAX_CONTINUATIONS = 5  # resumes allowed after a pause_turn, per user turn

# Anthropic-hosted tools. The _20260209 variants run code execution
# internally for dynamic filtering — declaring code_execution alongside them
# gives the model two execution environments and confuses it.
_WEB_TOOLS: list[dict] = [
    {"type": "web_search_20260209", "name": "web_search", "max_uses": 5},
    {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 3,
     "citations": {"enabled": True}, "max_content_tokens": 20000},
]

# Server-tool names the UI surfaces. The _20260209 web tools run inside an
# internal code sandbox, so code_execution blocks also arrive as
# server_tool_use; those are implementation detail and would otherwise show
# up as chat lines and in PDF/DOCX exports.
_VISIBLE_SERVER_TOOLS = {"web_search", "web_fetch"}

_SYSTEM = """You are EpiChat, an epidemiological simulation assistant built on \
Starsim agent-based models. You help researchers and students configure, run, \
and understand epidemic simulations grounded in real data.

# Workflow

Follow this sequence for every simulation request:
1. **Understand.** Identify the disease, location, and any settings the user \
gave. Use lookup_disease for literature parameters of known diseases. Ask one \
focused clarifying question only when a genuinely ambiguous choice would \
change the simulation materially.
2. **Configure and confirm.** Call configure_simulation with what you know, \
then present the settings to the user in a compact list (disease, model type, \
location, population, duration, key parameters, planned data fetches) and ask \
whether to proceed. Wait for their confirmation before fetching any data.
3. **Fetch and parameterize.** After confirmation, fetch real data \
(fetch_demographics for the country; fetch_health_system when a treatment \
intervention is relevant; fetch_vaccination_coverage for vaccine-preventable \
diseases). Fetched values are applied to the configuration automatically — \
never retype them. Then summarize the final parameterization, including any \
literature warnings, and ask whether to run.
4. **Run.** Call run_simulation only after the user confirms. The plot is \
shown automatically.
5. **Report.** Interpret the results plainly: peak, attack rate, deaths, what \
the interventions did, and caveats. Cite the data sources that were used.

# Rules

- Respond in the language the user writes in.
- Never state an epidemiological value that did not come from a tool result \
or the user. If a tool errors, say what failed and continue with what you have.
- Keep responses focused and brief; a simple question gets a direct answer in \
prose. Do not narrate routine tool calls — the interface shows them.
- For questions unrelated to epidemic simulation, answer briefly and steer \
back to what you can help with."""

_REFUSAL_MSG = ("I'm unable to help with that request. Let's get back to "
                "epidemic simulations — what would you like to model?")

_ERROR_MSG = ("Something went wrong while processing that (a technical error, "
              "not a problem with your request). Please try again — the "
              "conversation is intact.")

_DEFAULT_BETA = 22.8125  # matches the schema's default SIR configuration


@dataclass
class AgentState:
    """Mutable, deterministic conversation state shared by all tools."""

    params: SimParams | None = None
    disease: str | None = None
    data_sources: list = field(default_factory=list)
    total_population: int | None = None
    plot_path: str | None = None
    stats: dict = field(default_factory=dict)
    executor: object | None = None
    context_text: str = ""


def _upsert_intervention(interventions: list[dict], kind: str, **fields) -> list[dict]:
    out = [i for i in interventions if i.get("type") != kind]
    out.append({"type": kind, **fields})
    return out


def _param_warnings(state: AgentState, params: SimParams) -> list[str]:
    from .disease_db import check_params, detect_disease

    disease = state.disease or detect_disease(state.context_text or "")
    if not disease:
        return []
    return check_params(
        disease, params.approx_r0(), params.dur_inf, params.dur_exp,
        p_death=params.p_death or None,
        n_contacts=params.n_contacts,
        dur_immune=params.dur_immune,
        p_asymp=params.p_asymp if params.disease_type == "seiar" else None,
    )


def build_tools(state: AgentState) -> list:
    """Return the agent's tools as closures over the shared state."""

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
        vaccine_start_day: int | None = None,
        treatment_capacity: int | None = None,
        seasonality_scale: float | None = None,
    ) -> str:
        """Create or update the validated simulation configuration.

        Call this whenever the user specifies or changes any setting, passing
        only the fields that changed — earlier settings are preserved. Pass
        r0 to have beta calibrated deterministically to that R0. The result
        reports the validated configuration and any literature-range
        warnings; a CONFIG ERROR result explains what to fix.

        Args:
            disease: Disease name as the user said it (e.g. "dengue").
            country_iso3: ISO3 country code (e.g. "BRA").
            disease_type: Model type: sir, seir, sis, sirs, seirs, or seiar.
            n_agents: Number of simulated agents.
            sim_dur_years: Simulation duration in years.
            r0: Target basic reproduction number; beta is calibrated to it.
            dur_inf: Infectious period in days.
            dur_exp: Incubation period in days (SEIR-family models).
            dur_immune: Immunity duration in days (SIRS-family models).
            p_death: Infection fatality rate as a fraction of 1.
            p_asymp: Asymptomatic fraction (SEIAR), fraction of 1.
            init_prev: Initial prevalence as a fraction of 1.
            vaccine_coverage: Vaccine coverage fraction; adds/updates the
                vaccine intervention.
            vaccine_start_day: Day the vaccination campaign begins. 0 (the
                default) means pre-existing immunity at the start rather than
                a campaign. Requires vaccine_coverage.
            treatment_capacity: Daily treatment capacity; adds/updates the
                treatment intervention.
            seasonality_scale: Seasonal forcing amplitude 0-1; adds/updates
                the seasonality intervention.
        """
        base = state.params.model_dump() if state.params is not None else {"beta": _DEFAULT_BETA}
        direct = {
            "disease_type": disease_type, "n_agents": n_agents,
            "sim_dur_years": sim_dur_years, "dur_inf": dur_inf,
            "dur_exp": dur_exp, "dur_immune": dur_immune,
            "p_death": p_death, "p_asymp": p_asymp, "init_prev": init_prev,
        }
        applied = {k: v for k, v in direct.items() if v is not None}
        base.update(applied)
        if country_iso3 is not None:
            base["country"] = country_iso3
            applied["country"] = country_iso3

        interventions = list(base.get("interventions") or [])
        if vaccine_coverage is not None or vaccine_start_day is not None:
            current = next((i for i in interventions if i.get("type") == "vaccine"), {})
            coverage = (vaccine_coverage if vaccine_coverage is not None
                        else current.get("coverage"))
            start_day = (vaccine_start_day if vaccine_start_day is not None
                         else current.get("start_day", 0))
            if coverage is None:
                return ("CONFIG ERROR: a vaccination campaign needs a coverage "
                        "level — pass vaccine_coverage alongside vaccine_start_day.")
            interventions = _upsert_intervention(
                interventions, "vaccine", coverage=coverage, start_day=start_day)
            applied["vaccine_coverage"] = coverage
            applied["vaccine_start_day"] = start_day
        if treatment_capacity is not None:
            interventions = _upsert_intervention(
                interventions, "treatment", coverage=1.0, capacity=treatment_capacity)
            applied["treatment_capacity"] = treatment_capacity
        if seasonality_scale is not None:
            interventions = _upsert_intervention(
                interventions, "seasonality", scale=seasonality_scale)
            applied["seasonality_scale"] = seasonality_scale
        base["interventions"] = interventions

        try:
            params = SimParams.model_validate(base)
            if r0 is not None:
                from .parser import _calibrate_beta
                beta = max(0.001, min(1000.0, _calibrate_beta(params, r0)))
                params = SimParams.model_validate({**params.model_dump(), "beta": round(beta, 6)})
                applied["r0"] = r0
        except Exception as e:
            return f"CONFIG ERROR: {e}"

        if disease is not None:
            from .disease_db import detect_disease
            state.disease = detect_disease(disease) or disease.lower()
            applied["disease"] = state.disease

        state.params = params
        warnings = _param_warnings(state, params)
        return json.dumps({
            "applied": applied,
            "approx_r0": round(params.approx_r0(), 2),
            "config": {
                "disease": state.disease,
                "disease_type": params.disease_type,
                "country": params.country,
                "n_agents": params.n_agents,
                "sim_dur_years": params.sim_dur_years,
                "dur_inf": params.dur_inf,
                "dur_exp": params.dur_exp,
                "interventions": [i.type for i in params.interventions],
            },
            "warnings": warnings,
        })

    @beta_tool
    def lookup_disease(disease_name: str) -> str:
        """Look up a disease in the curated, citation-backed parameter database.

        Call this before configuring a known disease. Each parameter comes
        back with a status: "ok" (a usable consensus value, with
        estimate_range showing how far published estimates spread),
        "under_review" (held back — cite review_note, never invent a number),
        or "no_source" (nothing published in the database). Pass only "ok"
        values to configure_simulation. Covers 16 diseases.

        Args:
            disease_name: Disease name or alias (e.g. "whooping cough").
        """
        from .disease_db import detect_disease, load_db, lookup

        canonical = detect_disease(disease_name)
        entry = lookup(canonical) if canonical else lookup(disease_name)
        if entry is None:
            names = ", ".join(load_db()["diseases"].keys())
            return f"UNKNOWN DISEASE: '{disease_name}'. Known diseases: {names}"

        from .disease_db import parameter_summary

        out: dict = {"canonical_name": canonical or disease_name.lower(),
                     "display_name": entry.get("display_name")}
        parameters: dict = {}
        for p in ("r0", "incubation_days", "infectious_days", "fatality_rate",
                  "average_contacts_daily", "immunity_duration",
                  "asymptomatic_fraction"):
            summary = parameter_summary(entry, p)
            if summary is not None:
                parameters[p] = summary
        out["parameters"] = parameters
        return json.dumps(out)

    def _record(fields) -> list[str]:
        state.data_sources.extend(fields)
        return [f.citation for f in fields]

    def _adapter(name):
        from .parser import _resolver
        return _resolver._adapters.get(name)

    _NEEDS_CONFIG = ("Call configure_simulation first to establish the "
                     "simulation before fetching data.")

    @beta_tool
    def fetch_demographics(country_iso3: str) -> str:
        """Fetch real demographics for a country and apply them deterministically.

        Uses the UN World Population Prospects (live API, offline CSV
        fallback). Automatically applies age structure (switching to an
        age-structured contact network), birth/death rates, and records the
        total population for result scaling — you never copy these numbers
        yourself. Call after configure_simulation, before running.

        Args:
            country_iso3: ISO3 country code (e.g. "BRA", "KEN").
        """
        if state.params is None:
            return _NEEDS_CONFIG
        iso3 = country_iso3.strip().upper()
        try:
            fields = []
            adapter = _adapter("un_wpp")
            if adapter is not None:
                loc_id = adapter.location_id(iso3)
                if loc_id:
                    from .parser import fetch_query
                    from .resolver import DataQuery
                    fields = fetch_query(DataQuery(
                        source="un_wpp", indicators=[55, 59, 71, 49],
                        location_id=loc_id))
            if not fields:
                from .data_loaders.demographics import get_country_demographics
                from .resolver import ResolvedField
                demo = get_country_demographics(iso3)
                fields = [
                    ResolvedField(field="birth_rate", value=demo["birth_rate"],
                                  citation=demo["source"]),
                    ResolvedField(field="death_rate", value=demo["death_rate"],
                                  citation=demo["source"]),
                ]

            applied: dict = {}
            base = state.params.model_dump()
            for rf in fields:
                if rf.field == "age_distribution_pct" and isinstance(rf.value, dict):
                    base.update({
                        "network_type": "age_structured",
                        "age_pct_under18": rf.value.get("0-17"),
                        "age_pct_18_64": rf.value.get("18-64"),
                        "age_pct_over65": rf.value.get("65+"),
                    })
                    applied["age_structure_pct"] = rf.value
                elif rf.field == "total_population":
                    state.total_population = int(rf.value)
                    applied["total_population"] = state.total_population
                elif rf.field in ("birth_rate", "death_rate"):
                    base[rf.field] = rf.value
                    base["use_demographics"] = True
                    applied[rf.field] = rf.value
            base["country"] = iso3
            state.params = SimParams.model_validate(base)
            return json.dumps({"applied": applied, "citations": _record(fields)})
        except Exception as e:
            logger.exception("fetch_demographics failed for %s", iso3)
            return f"FETCH ERROR: {e}"

    @beta_tool
    def fetch_health_system(country_iso3: str) -> str:
        """Fetch health-system indicators (World Bank WDI) for a country.

        Returns hospital beds, physicians, nurses per 1,000, and UHC
        coverage. If the simulation has a treatment intervention, its daily
        capacity is set deterministically from hospital beds scaled to the
        simulated population. Call after configure_simulation.

        Args:
            country_iso3: ISO3 country code (e.g. "BRA").
        """
        if state.params is None:
            return _NEEDS_CONFIG
        iso3 = country_iso3.strip().upper()
        try:
            from .parser import fetch_query
            from .resolver import DataQuery
            fields = fetch_query(DataQuery(
                source="wb_data360",
                indicator_codes=["WB_WDI_SH_MED_BEDS_ZS", "WB_WDI_SH_MED_PHYS_ZS",
                                 "WB_WDI_SH_MED_NUMW_P3", "WB_WDI_SH_UHC_SRVS_CV_XD"],
                location_code=iso3))
            if not fields:
                return f"FETCH ERROR: no health-system data returned for {iso3}"
            applied: dict = {f.field: f.value for f in fields}
            cap = next((f for f in fields if f.field == "treatment_capacity"), None)
            if cap is not None and state.params.get_treatment() is not None:
                base = state.params.model_dump()
                treat = next(i for i in base["interventions"] if i["type"] == "treatment")
                treat["capacity"] = max(1, round(float(cap.value) * state.params.n_agents / 1000))
                state.params = SimParams.model_validate(base)
                applied["applied_treatment_capacity"] = treat["capacity"]
            return json.dumps({"applied": applied, "citations": _record(fields)})
        except Exception as e:
            logger.exception("fetch_health_system failed for %s", iso3)
            return f"FETCH ERROR: {e}"

    _GHO_CODES = {
        "measles": ["WHS8_110", "MCV2"],
        "rubella": ["WHS8_110"],
        "pertussis": ["WHS3_41"],
        "polio": ["WHS3_43"],
        "hepatitis_a": ["WHS3_45"],
        "tuberculosis": ["WHS3_40"],
        "meningococcal": ["MENGA"],
    }

    @beta_tool
    def fetch_vaccination_coverage(country_iso3: str, disease: str) -> str:
        """Fetch reported vaccination coverage (WHO GHO) for a disease/country.

        If no vaccine intervention is configured yet, one is added
        deterministically at the reported coverage. Only some diseases have
        routine-immunization indicators; the result says when none exists.

        Args:
            country_iso3: ISO3 country code (e.g. "BRA").
            disease: Disease name (e.g. "measles").
        """
        if state.params is None:
            return _NEEDS_CONFIG
        iso3 = country_iso3.strip().upper()
        try:
            from .disease_db import detect_disease
            canonical = detect_disease(disease) or disease.lower()
            codes = _GHO_CODES.get(canonical)
            if not codes:
                return (f"NO VACCINE INDICATOR: no routine-immunization coverage "
                        f"indicator is available for {canonical}.")
            from .parser import fetch_query
            from .resolver import DataQuery
            fields = fetch_query(DataQuery(
                source="who_gho", indicator_codes=codes, location_code=iso3))
            if not fields:
                return f"FETCH ERROR: no vaccination data returned for {iso3}"
            applied: dict = {f.field: f.value for f in fields}
            cov = next((f for f in fields if f.field.endswith("_coverage")), None)
            if cov is not None and state.params.get_vaccine() is None:
                base = state.params.model_dump()
                base["interventions"] = _upsert_intervention(
                    base["interventions"], "vaccine",
                    coverage=min(1.0, float(cov.value) / 100.0), start_day=0)
                state.params = SimParams.model_validate(base)
                applied["applied_vaccine_coverage"] = min(1.0, float(cov.value) / 100.0)
            return json.dumps({"applied": applied, "citations": _record(fields)})
        except Exception as e:
            logger.exception("fetch_vaccination_coverage failed for %s", iso3)
            return f"FETCH ERROR: {e}"

    @beta_tool
    def run_simulation() -> str:
        """Run the configured Starsim simulation and return the results.

        Only call this after the configuration is complete and the user has
        confirmed they want to run. Results are scaled to the real
        population when demographics were fetched. The result plot is shown
        to the user automatically.
        """
        if state.params is None:
            return _NEEDS_CONFIG.replace("fetching data", "running")
        if state.executor is None:
            return "SIMULATION ERROR: no executor is attached to this session"
        import datetime
        from pathlib import Path

        pop_scale = (
            state.total_population / state.params.n_agents
            if state.total_population and state.params.n_agents > 0 else 1.0
        )
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        plot_path = str(Path("results") / f"sim_{ts}.png")
        exec_result = state.executor._execute_with_retry(
            state.context_text, state.params, plot_path, pop_scale=pop_scale)
        if exec_result.get("error"):
            return f"SIMULATION ERROR: {exec_result['error']}"
        state.stats = exec_result.get("stats", {})
        state.plot_path = exec_result.get("plot_path")
        n = state.stats.get("n_agents", state.params.n_agents) or 1
        return json.dumps({
            "stats": state.stats,
            "attack_rate_pct": round(state.stats.get("total_infected", 0) / n * 100, 1),
            "pop_scale": round(pop_scale, 2),
        })

    return [configure_simulation, lookup_disease, fetch_demographics,
            fetch_health_system, fetch_vaccination_coverage, run_simulation]


def _system_blocks() -> list[dict]:
    """System prompt with a cache breakpoint — tools+system form the stable prefix."""
    return [{"type": "text", "text": _SYSTEM,
             "cache_control": {"type": "ephemeral"}}]


class EpiChatAgent:
    """One agent per chat conversation: history + state + the tool loop."""

    def __init__(self, executor: object | None = None) -> None:
        self.state = AgentState(executor=executor)
        self.history: list = []
        self.tools = [*build_tools(self.state), *_WEB_TOOLS]
        self.client = anthropic.Anthropic()

    def _consume(self, runner, on_event) -> tuple[str, int]:
        """Drive one runner to completion.

        Returns (outcome, messages appended to history). The outcome is
        "done" when the turn finished, "refused" when the model declined, or
        "paused" when the API's server-tool loop hit its per-turn iteration
        limit — the SDK runner does not resume by itself, so handle() starts
        a fresh runner over the accumulated history.
        """
        appended = 0
        for message in runner:
            if message.stop_reason == "refusal":
                on_event("text", {"text": _REFUSAL_MSG})
                return "refused", appended
            self._emit_message(message, on_event)
            self.history.append({"role": "assistant", "content": message.content})
            appended += 1
            if message.stop_reason == "pause_turn":
                return "paused", appended
            tool_response = runner.generate_tool_call_response()
            if tool_response is None:
                continue
            for tr in tool_response["content"]:
                on_event("tool_result", {
                    "tool_use_id": tr.get("tool_use_id"),
                    "content": tr.get("content"),
                    "is_error": tr.get("is_error", False),
                })
            self.history.append(tool_response)
            appended += 1
        return "done", appended

    def _emit_message(self, message, on_event) -> None:
        """Emit one message's blocks, coalescing consecutive text.

        With web-fetch citations enabled the model's prose arrives split at
        citation boundaries: one answer can be five text blocks, some starting
        mid-clause. Joining them keeps a reply one chat bubble, one paragraph
        in exported reports, and one block in evaluation transcripts.
        """
        buffer: list[str] = []

        def flush() -> None:
            text = "".join(buffer).strip()
            buffer.clear()
            if text:
                on_event("text", {"text": text})

        for block in message.content:
            if getattr(block, "type", None) == "text":
                buffer.append(block.text)
                continue
            flush()
            self._emit_block(block, on_event)
        flush()

    def _emit_block(self, block, on_event) -> None:
        """Turn one non-text response content block into a UI event.

        Text is handled by _emit_message, which coalesces it.
        """
        kind = getattr(block, "type", None)
        if kind == "tool_use" or (kind == "server_tool_use"
                                  and block.name in _VISIBLE_SERVER_TOOLS):
            on_event("tool_use", {"name": block.name, "input": block.input or {}})
        elif kind in ("web_search_tool_result", "web_fetch_tool_result"):
            self._emit_web_result(block, on_event)

    def _emit_web_result(self, block, on_event) -> None:
        """Report a server-tool result and cite the pages actually read.

        Server tools report failure as data: the result content is a list
        (search hits) or a result object (a fetched page) on success, and an
        object carrying error_code on failure. Branch before indexing.

        Only fetched pages become citations. Search hits are things the model
        looked at, not sources it relied on, and five searches of ten hits
        would swamp the sources block under the plot.
        """
        tool_use_id = getattr(block, "tool_use_id", None)
        content = getattr(block, "content", None)
        error_code = getattr(content, "error_code", None)
        if error_code:
            on_event("tool_result", {"tool_use_id": tool_use_id, "is_error": True,
                                     "content": f"WEB ERROR: {error_code}"})
            return

        pages: list[tuple[str, str]] = []
        if block.type == "web_fetch_tool_result" and content is not None:
            url = getattr(content, "url", None)
            if url:
                # BetaWebFetchBlock carries the url, but the page title lives on
                # the nested BetaDocumentBlock — so the obvious one-level
                # getattr(content, "title") silently always yields None and
                # every citation falls back to showing its own URL.
                document = getattr(content, "content", None)
                title = getattr(document, "title", None) or url
                pages.append((title, url))

        if pages:
            from .resolver import ResolvedField
            cited = {getattr(f, "citation", None) for f in self.state.data_sources}
            for title, url in pages:
                if url not in cited:
                    cited.add(url)
                    self.state.data_sources.append(ResolvedField(
                        field="web_source", value=title, citation=url,
                        description="Page the agent read during this conversation"))

        on_event("tool_result", {
            "tool_use_id": tool_use_id, "is_error": False,
            "content": json.dumps({"pages": [u for _, u in pages]}),
        })

    def handle(self, user_text: str, on_event: Callable[[str, dict], None]) -> None:
        """Run one conversational turn, emitting UI events as they happen.

        Event kinds: "text" {text}, "tool_use" {name, input},
        "tool_result" {tool_use_id, content, is_error}, "plot" {path, sources}.
        """
        self.state.context_text = (self.state.context_text + " " + user_text).strip()
        self.history.append({"role": "user", "content": user_text})
        appended_since_user = 0
        try:
            for _ in range(_MAX_CONTINUATIONS):
                runner = self.client.beta.messages.tool_runner(
                    model=_MODEL,
                    max_tokens=_MAX_TOKENS,
                    system=_system_blocks(),
                    tools=self.tools,
                    messages=self.history,
                )
                outcome, appended = self._consume(runner, on_event)
                appended_since_user += appended
                if outcome != "paused":
                    break
        except Exception:
            logger.exception("agent turn failed")
            if appended_since_user == 0:
                self.history.pop()  # roll back the unanswered user message
            on_event("text", {"text": _ERROR_MSG})
            return

        if self.state.plot_path:
            on_event("plot", {"path": self.state.plot_path,
                              "sources": list(self.state.data_sources)})
            self.state.plot_path = None
