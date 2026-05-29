from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

import anthropic
import numpy as np
from dotenv import load_dotenv

from .resolver import DataQuery, ResolvedField, Resolver, SourceAdapter
from .schema import OutbreakContext, SimParams

load_dotenv()

_PROMPT_PATH = Path(__file__).parent / "prompts" / "extraction.txt"
_REFINEMENT_PROMPT_PATH = Path(__file__).parent / "prompts" / "refinement.txt"
_MODEL = "claude-sonnet-4-6"


@dataclass
class IntentResult:
    preliminary_params: SimParams
    data_queries: list[DataQuery]


_resolver: Resolver = Resolver()
_LOCATION_TABLE: str = ""
_last_resolved: list[ResolvedField] = []
_last_location_queried: bool = False


def get_last_resolved() -> list[ResolvedField]:
    return list(_last_resolved)


def get_last_location_queried() -> bool:
    """True when LLM-1 recognised a geographic location in the query,
    even if the UN WPP API call subsequently failed or returned nothing."""
    return _last_location_queried


def configure_resolver(adapter: SourceAdapter) -> None:
    global _LOCATION_TABLE
    _resolver.register(adapter)
    from .adapters.un_wpp import UNWPPAdapter
    if isinstance(adapter, UNWPPAdapter):
        _LOCATION_TABLE = json.dumps(adapter.iso3_table(), separators=(",", ":"))


def _load_system_prompt() -> str:
    text = _PROMPT_PATH.read_text(encoding="utf-8")
    return text.replace("{location_table}", _LOCATION_TABLE or "{}")


def _parse_json(raw: str) -> dict:
    if "```" in raw:
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    brace = raw.find("{")
    if brace > 0:
        raw = raw[brace:]
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"LLM returned non-JSON response: {raw!r}") from e


def _format_context(context: OutbreakContext) -> str:
    lines = ["Outbreak context (extracted from source):"]
    for key, val in context.model_dump(exclude={"input_type", "confidence"}).items():
        if val is not None and val != []:
            lines.append(f"  {key}: {val}")
    if len(lines) == 1:
        return ""
    return "\n".join(lines)


def _llm_call_1(user_input: str, context: OutbreakContext | None = None) -> IntentResult:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    content = user_input
    if context is not None:
        ctx_block = _format_context(context)
        if ctx_block:
            content = ctx_block + "\n\nUser query: " + user_input
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

    # Legacy format: raw SimParams JSON
    data = {k: v for k, v in data.items() if v is not None or k in ("dur_exp", "dur_immune", "rand_seed", "capacity")}
    return IntentResult(preliminary_params=SimParams(**data), data_queries=[])


def _llm_call_2(user_input: str, prelim: SimParams, resolved: list[ResolvedField]) -> SimParams:
    if not resolved:
        return prelim

    resolved_text = "\n".join(
        f"- {rf.field}: {rf.value} — {rf.citation}" for rf in resolved
    )
    user_message = (
        _REFINEMENT_PROMPT_PATH.read_text(encoding="utf-8")
        .replace("{user_input}", user_input)
        .replace("{preliminary_params}", json.dumps(prelim.model_dump(), indent=2))
        .replace("{resolved_fields}", resolved_text)
    )

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    message = client.messages.create(
        model=_MODEL,
        max_tokens=1024,
        system="You are an epidemiological parameter assistant. Return only valid JSON.",
        messages=[{"role": "user", "content": user_message}],
    )
    raw = message.content[0].text.strip()
    data = _parse_json(raw)
    data = {k: v for k, v in data.items() if v is not None or k in ("dur_exp", "dur_immune", "rand_seed", "capacity")}
    return SimParams(**data)


def _run_resolver(queries: list[DataQuery]) -> list[ResolvedField]:
    if not queries:
        return []
    return _resolver.resolve(queries)


def _apply_age_distribution(params: SimParams, resolved: list[ResolvedField]) -> SimParams:
    age_field = next((rf for rf in resolved if rf.field == "age_distribution_pct"), None)
    if age_field is None:
        return params
    pct = age_field.value
    return SimParams.model_validate({
        **params.model_dump(),
        "network_type": "age_structured",
        "age_pct_under18": pct.get("0-17"),
        "age_pct_18_64":   pct.get("18-64"),
        "age_pct_over65":  pct.get("65+"),
    })


def _apply_vaccination_coverage(params: SimParams, resolved: list[ResolvedField]) -> SimParams:
    coverage_field = next((rf for rf in resolved if rf.field.endswith("_coverage")), None)
    if coverage_field is None:
        return params
    if params.get_vaccine() is not None:
        return params
    coverage = min(1.0, coverage_field.value / 100.0)
    from .schema import Intervention
    vaccine = Intervention(type="vaccine", coverage=coverage, start_day=0)
    return SimParams.model_validate({
        **params.model_dump(),
        "interventions": params.model_dump()["interventions"] + [vaccine.model_dump()],
    })


def _apply_population_scale(params: SimParams, resolved: list[ResolvedField]) -> SimParams:
    pop_field = next((rf for rf in resolved if rf.field == "total_population"), None)
    if pop_field is None:
        return params
    n_agents = max(1_000, min(100_000, pop_field.value))
    if n_agents == params.n_agents:
        return params
    return SimParams.model_validate({**params.model_dump(), "n_agents": n_agents})


def _apply_surveillance(params: SimParams, resolved: list[ResolvedField]) -> SimParams:
    cases_field = next((rf for rf in resolved if rf.field.endswith("_cases")), None)
    pop_field   = next((rf for rf in resolved if rf.field == "total_population"), None)
    if cases_field is None or pop_field is None or pop_field.value == 0 or cases_field.value <= 0:
        return params
    daily_incidence = cases_field.value / pop_field.value / 365
    init_prev = max(0.0001, min(0.5, daily_incidence * params.dur_inf))
    return SimParams.model_validate({**params.model_dump(), "init_prev": init_prev})


def _apply_wb_disease_prevalence(params: SimParams, resolved: list[ResolvedField]) -> SimParams:
    # WHO GHO surveillance takes precedence
    if any(rf.field.endswith("_cases") for rf in resolved):
        return params
    disease_field = next(
        (rf for rf in resolved if rf.field.endswith(("_prevalence", "_incidence"))),
        None,
    )
    if disease_field is None:
        return params
    from .adapters.wb_data360 import INCIDENCE_SCALE
    scale = INCIDENCE_SCALE.get(disease_field.field)
    if scale is None:
        return params
    if disease_field.field.endswith("_prevalence"):
        init_prev = disease_field.value / scale
    else:
        init_prev = disease_field.value / scale / 365 * params.dur_inf
    init_prev = max(0.0001, min(0.5, init_prev))
    return SimParams.model_validate({**params.model_dump(), "init_prev": init_prev})


def _apply_health_system(params: SimParams, resolved: list[ResolvedField]) -> SimParams:
    if params.get_treatment() is not None:
        return params
    capacity_field = next((rf for rf in resolved if rf.field == "treatment_capacity"), None)
    uhc_field = next((rf for rf in resolved if rf.field == "uhc_coverage"), None)
    if capacity_field is None and uhc_field is None:
        return params
    from .schema import Intervention
    capacity = max(1, round(capacity_field.value / 1000 * params.n_agents)) if capacity_field else None
    coverage = uhc_field.value / 100.0 if uhc_field else 1.0
    treatment = Intervention(type="treatment", capacity=capacity, coverage=coverage, start_day=0)
    return SimParams.model_validate({
        **params.model_dump(),
        "interventions": params.model_dump()["interventions"] + [treatment.model_dump()],
    })


def _calibrate_beta(params: SimParams, target_r0: float) -> float:
    """Back-solve beta so approx_r0() returns target_r0 for the current network.

    Mirrors the math in SimParams.approx_r0() exactly so the two stay in sync.
    """
    asymp_factor = 1.0
    if params.disease_type == "seiar":
        asymp_factor = 1 - params.p_asymp * (1 - params.rel_trans_asymp)

    denom_base = params.network_beta * asymp_factor * (params.dur_inf / 365.0)

    if params.network_type == "age_structured":
        C = np.array([[7.0, 2.5, 0.5],
                      [2.5, 9.0, 1.5],
                      [0.5, 1.5, 3.5]])
        if all(x is not None for x in [params.age_pct_under18, params.age_pct_18_64, params.age_pct_over65]):
            pop = np.array([params.age_pct_under18, params.age_pct_18_64, params.age_pct_over65]) / 100.0
            ngm_unit = C * pop[np.newaxis, :]
        else:
            ngm_unit = C
        spectral_radius = float(np.linalg.eigvals(ngm_unit).real.max())
        denom = denom_base * spectral_radius
    else:
        denom = denom_base * params.n_contacts

    return target_r0 / denom


def _apply_disease_db_r0(user_input: str, params: SimParams) -> SimParams:
    """Calibrate beta so approx_r0() matches the disease database typical R0.

    Only applies when the LLM used disease defaults (intended R0 within 2× of
    the DB typical). Skips silently if user specified an explicit non-default R0,
    letting the warning system flag that case instead.
    """
    from .disease_db import detect_disease, lookup

    disease = detect_disease(user_input)
    if disease is None:
        return params

    entry = lookup(disease)
    if entry is None or "r0" not in entry:
        return params

    target_r0 = float(entry["r0"]["typical"])

    # Estimate what R0 the LLM intended (computed as if random network)
    asymp_factor = 1.0
    if params.disease_type == "seiar":
        asymp_factor = 1 - params.p_asymp * (1 - params.rel_trans_asymp)
    r0_llm = params.beta * params.network_beta * asymp_factor * (params.dur_inf / 365.0) * params.n_contacts

    # Only apply correction when LLM used disease defaults, not an explicit user R0
    if not (target_r0 * 0.5 <= r0_llm <= target_r0 * 2.0):
        return params

    corrected_beta = _calibrate_beta(params, target_r0)
    corrected_beta = max(0.001, min(1000.0, corrected_beta))
    return SimParams.model_validate({**params.model_dump(), "beta": round(corrected_beta, 6)})


def parse_query(user_input: str, context: OutbreakContext | None = None) -> SimParams:
    """
    Translate a natural language epidemiological query into validated SimParams.

    Four-step process:
      1. LLM-1 extracts intent (preliminary params + optional data queries).
      2. If data queries exist, the resolver fetches real-world values.
      3. LLM-2 refines preliminary params using resolved data (skipped when no queries).
      4. Deterministic post-processing applies age distribution, vaccination coverage,
         and disease surveillance if resolved.

    Raises:
        ValueError: if the LLM requests clarification or returns invalid JSON/schema.
    """
    global _last_resolved, _last_location_queried
    _last_resolved = []
    _last_location_queried = False
    intent = _llm_call_1(user_input, context)
    _last_location_queried = any(
        q.source == "un_wpp" and q.location_id != 0
        for q in intent.data_queries
    )
    resolved = _run_resolver(intent.data_queries)
    _last_resolved = resolved
    params = _llm_call_2(user_input, intent.preliminary_params, resolved)
    params = _apply_age_distribution(params, resolved)
    params = _apply_vaccination_coverage(params, resolved)
    params = _apply_surveillance(params, resolved)
    params = _apply_wb_disease_prevalence(params, resolved)
    params = _apply_health_system(params, resolved)
    params = _apply_population_scale(params, resolved)
    params = _apply_disease_db_r0(user_input, params)
    return params


def fix_params(user_input: str, params: SimParams, error_message: str) -> SimParams:
    """
    Ask the LLM to fix parameters given a Starsim execution error.
    Used by the error recovery loop in the orchestrator.
    """
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    recovery_prompt = (
        f"Original query: {user_input}\n\n"
        f"Parameters used:\n{json.dumps(params.model_dump(), indent=2)}\n\n"
        f"Starsim produced this error:\n{error_message}\n\n"
        "Please return a corrected JSON parameter object that will fix the error. "
        "Return ONLY the JSON object."
    )

    message = client.messages.create(
        model=_MODEL,
        max_tokens=1024,
        system="You are an epidemiological parameter assistant. Return only valid JSON matching the SimParams schema.",
        messages=[{"role": "user", "content": recovery_prompt}],
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    data = json.loads(raw)
    data = {k: v for k, v in data.items() if v is not None or k in ("dur_exp", "dur_immune", "rand_seed", "capacity")}
    return SimParams(**data)
