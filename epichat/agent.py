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

from anthropic import beta_tool

from .schema import SimParams

logger = logging.getLogger(__name__)

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
        if vaccine_coverage is not None:
            interventions = _upsert_intervention(
                interventions, "vaccine", coverage=vaccine_coverage, start_day=0)
            applied["vaccine_coverage"] = vaccine_coverage
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

        Call this before configuring a known disease to get its literature
        R0, incubation and infectious periods, and fatality rate — then pass
        the chosen values to configure_simulation. Covers 16 diseases.

        Args:
            disease_name: Disease name or alias (e.g. "whooping cough").
        """
        from .disease_db import detect_disease, load_db, lookup

        canonical = detect_disease(disease_name)
        entry = lookup(canonical) if canonical else lookup(disease_name)
        if entry is None:
            names = ", ".join(load_db()["diseases"].keys())
            return f"UNKNOWN DISEASE: '{disease_name}'. Known diseases: {names}"
        out: dict = {"canonical_name": canonical or disease_name.lower(),
                     "display_name": entry.get("display_name")}
        for p in ("r0", "incubation_days", "infectious_days", "fatality_rate"):
            if isinstance(entry.get(p), dict):
                out[p] = entry[p]
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

    return [configure_simulation, lookup_disease, fetch_demographics,
            fetch_health_system, fetch_vaccination_coverage]
