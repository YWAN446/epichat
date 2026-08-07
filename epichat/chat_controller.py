"""Conversation state machine helpers for the EpiChat chat UI."""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .resolver import ResolvedField
    from .schema import OutbreakContext, SimParams

_SOURCE_FOOTNOTES: dict[str, str] = {
    "UN WPP": "UN World Population Prospects 2024. Official UN demographic projections for 237 countries. data.un.org",
    "WB WDI": "World Bank World Development Indicators. Annual country-level health & economic data from official national sources. datatopics.worldbank.org",
    "WHO GHO": "World Health Organization Global Health Observatory. Disease surveillance and health system indicators. who.int/data/gho",
}

_DISEASE_NAMES: dict[str, str] = {
    "hiv_prevalence": "HIV/AIDS",
    "tb_incidence": "Tuberculosis",
    "tb_cases": "Tuberculosis",
    "measles_coverage": "Measles",
    "malaria_cases": "Malaria",
    "flu_cases": "Influenza",
    "covid_cases": "COVID-19",
    "ebola_cases": "Ebola",
    "gonorrhea_cases": "Gonorrhea",
}

_DISEASE_INDICATOR_FIELDS = frozenset(_DISEASE_NAMES.keys())

_SKIP_WORDS = frozenset({
    "none", "no", "skip", "nothing", "nope", "n/a", "na",
    "no interventions", "no intervention", "not needed",
})

_NEW_SCENARIO_PATTERNS = [
    r"\bnow simulate\b",
    r"\bnow model\b",
    r"\binstead simulate\b",
    r"\binstead model\b",
    r"\bnew simulation\b",
    r"\bstart over\b",
    r"\bdifferent disease\b",
    r"\bdifferent country\b",
]

_SUMMARY_LABEL_WIDTH = 13


def _abbrev(citation: str) -> str:
    for key in ("UN WPP", "WB WDI", "WHO GHO"):
        if key in citation:
            return key
    return ""


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
        ask = "Anything to change, or shall I fetch the data?"
    else:
        ask = "Anything to change, or shall I set it up?"
    lines.append("")
    lines.append(ask)
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


def format_data_sources(data_sources: list, params=None, disease_name: str | None = None) -> str | None:
    """Markdown block attributing each fetched parameter to its data source.

    Included in the post-run results message (and therefore in PDF/DOCX
    exports, which render the conversation). Returns None when there is
    nothing to attribute.
    """
    lines = []
    for rf in data_sources:
        lines.append(
            f"- **{rf.field.replace('_', ' ')}** = {_fmt_value(rf.value)} — {rf.citation}"
        )
    if params is not None and getattr(params, "demographics_source", None):
        lines.append(f"- **birth/death rates** — {params.demographics_source}")
    if disease_name:
        from .disease_db import lookup
        entry = lookup(disease_name) or {}
        r0 = entry.get("r0") or {}
        if r0.get("source"):
            lines.append(f"- **R₀ calibration ({disease_name})** — {r0['source']}")
    if not lines:
        return None
    return "**Data sources used:**\n" + "\n".join(lines)


def detect_run_intent(message: str) -> bool:
    from .language import detect_run_intent_llm
    return detect_run_intent_llm(message)


def detect_new_scenario(message: str) -> bool:
    msg = message.lower()
    return any(re.search(p, msg) for p in _NEW_SCENARIO_PATTERNS)


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
            if result["disease"] and result["location"] and result["population"]:
                result["interventions"] = True

    if params is None:
        return result

    msg_lower = last_user_message.lower().strip().rstrip(".")

    # Generic SIR defaults (extraction.txt): dur_inf=10, n_contacts=4, p_death=0.
    # Any deviation means the LLM inferred disease-specific values → disease was named.
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


def next_question(
    collected: dict[str, bool],
    params,  # SimParams
    data_sources: list,
    lang: str = "English",
) -> str | None:
    if not collected["disease"]:
        q: str | None = "What disease or pathogen would you like to model?"
    elif not collected["location"]:
        q = (
            "Which country or region? "
            "I can pull real demographic and health data if available."
        )
    elif not collected["population"]:
        pop_field = next(
            (rf for rf in data_sources if rf.field == "total_population"), None
        )
        if pop_field:
            pop_m = pop_field.value / 1_000_000
            src = _abbrev(pop_field.citation)
            src_str = f" from {src} data" if src else ""
            q = (
                f"How large a population? I can use the real population of {pop_m:.1f}M"
                f"{src_str}, or you can specify a number."
            )
        else:
            q = "How large a population? Please specify (e.g. 100,000)."
    elif not collected["interventions"]:
        q = (
            "Are there any interventions to include — vaccination, treatment, or "
            "seasonal effects? (Type 'none' to skip)"
        )
    else:
        return None

    if q is not None and lang.lower() != "english":
        from .language import translate
        return translate(q, lang)
    return q


def build_summary(params, data_sources: list, description: str = "", lang: str = "English", param_warnings: list[str] | None = None) -> str:
    """Build a markdown-formatted parameter summary with optional LLM description."""
    parts: list[str] = []
    used_sources: set[str] = set()

    parts.append("Got it. Here's what I've put together:")

    if description:
        parts.append(description)

    # ── Key parameter table (hard line breaks keep items on separate lines) ───
    table: list[str] = []

    disease_name = next(
        (_DISEASE_NAMES[rf.field] for rf in data_sources if rf.field in _DISEASE_NAMES),
        params.disease_type.upper(),
    )
    dur = int(params.sim_dur_years) if params.sim_dur_years == int(params.sim_dur_years) else params.sim_dur_years
    table.append(f"**Disease:** {disease_name} · {params.disease_type.upper()} model · {dur}-year simulation")

    pop_field = next((rf for rf in data_sources if rf.field == "total_population"), None)
    if pop_field:
        abbrev = _abbrev(pop_field.citation)
        if abbrev:
            used_sources.add(abbrev)
        pop_m = pop_field.value / 1_000_000
        cite = f" [{abbrev}]" if abbrev else ""
        m = re.search(r",\s*([^,()]+)\s*\(", pop_field.citation)
        country = m.group(1).strip() if m else ""
        prefix = f"{country} " if country else ""
        table.append(f"**Location:** {prefix}(pop. {pop_m:.1f}M){cite}")

    table.append(f"**Agents:** {params.n_agents:,}")

    prev_field = next(
        (rf for rf in data_sources if rf.field.endswith(("_prevalence", "_incidence", "_cases"))),
        None,
    )
    if prev_field:
        abbrev = _abbrev(prev_field.citation)
        if abbrev:
            used_sources.add(abbrev)
        cite = f" [{abbrev}]" if abbrev else ""
        used_marker = " ★" if prev_field.alternatives else ""
        if prev_field.field.endswith("_cases"):
            table.append(f"**Cases (annual):** {int(prev_field.value):,}{cite}{used_marker}")
            table.append(f"↳ Initial prevalence: {params.init_prev * 100:.4f}%")
        elif prev_field.field.endswith("_incidence"):
            units = prev_field.description or "per 100,000/yr"
            table.append(f"**Incidence:** {prev_field.value:.4g} {units}{cite}{used_marker}")
            table.append(f"↳ Initial prevalence: {params.init_prev * 100:.4f}%")
        else:  # _prevalence
            table.append(f"**Prevalence:** {prev_field.value}%{cite}{used_marker}")
        for alt in prev_field.alternatives:
            alt_abbrev = _abbrev(alt.citation)
            if alt_abbrev:
                used_sources.add(alt_abbrev)
            alt_cite = f" [{alt_abbrev}]" if alt_abbrev else ""
            alt_desc = f" ({alt.description})" if alt.description else ""
            table.append(f"↳ {alt.value}{alt_cite}{alt_desc}")
    else:
        table.append(f"**Prevalence:** {params.init_prev * 100:.2f}%")

    # All vaccination-coverage data sources (e.g. mcv1_coverage, mcv2_coverage from WHO GHO)
    _vax_cov_fields = [
        rf for rf in data_sources
        if rf.field.endswith("_coverage") and rf.field != "uhc_coverage"
    ]
    # UHC coverage drives treatment coverage %
    _uhc_field = next((rf for rf in data_sources if rf.field == "uhc_coverage"), None)

    label_used = False
    for iv in params.interventions:
        lbl = "**Intervention:**" if not label_used else "↳"
        label_used = True
        if iv.type == "vaccine":
            cov_pct = round(iv.coverage * 100) if iv.coverage is not None else None
            cov = f"{cov_pct}%" if cov_pct is not None else "?"
            # Match data source by value first, then fall back to first available
            cov_field = next(
                (rf for rf in _vax_cov_fields if cov_pct is not None and round(rf.value) == cov_pct),
                _vax_cov_fields[0] if _vax_cov_fields else None,
            )
            cite = ""
            if cov_field:
                abbrev = _abbrev(cov_field.citation)
                if abbrev:
                    used_sources.add(abbrev)
                    cite = f" [{abbrev}]"
            table.append(f"{lbl} Vaccination · {cov} coverage{cite}")
        elif iv.type == "treatment":
            cov = f"{iv.coverage * 100:.0f}% coverage" if iv.coverage else ""
            cap_field = next((rf for rf in data_sources if rf.field == "treatment_capacity"), None)
            # Cite UHC coverage when it set the treatment coverage %
            treat_cite = ""
            if _uhc_field:
                abbrev = _abbrev(_uhc_field.citation)
                if abbrev:
                    used_sources.add(abbrev)
                    treat_cite = f" [{abbrev}]"
            table.append(f"{lbl} Treatment · {cov}{treat_cite}")
            if cap_field:
                abbrev = _abbrev(cap_field.citation)
                if abbrev:
                    used_sources.add(abbrev)
                cite = f" [{abbrev}]" if abbrev else ""
                used_marker = " ★" if cap_field.alternatives else ""
                table.append(f"Capacity: {cap_field.value} beds/1,000{cite}{used_marker}")
                for alt in cap_field.alternatives:
                    alt_abbrev = _abbrev(alt.citation)
                    if alt_abbrev:
                        used_sources.add(alt_abbrev)
                    alt_cite = f" [{alt_abbrev}]" if alt_abbrev else ""
                    alt_desc = f" ({alt.description})" if alt.description else ""
                    table.append(f"↳ {alt.value}{alt_cite}{alt_desc}")
        elif iv.type == "seasonality":
            table.append(f"{lbl} Seasonality · strength {iv.scale:.0%}")
    if not params.interventions:
        table.append("**Intervention:** None")

    table.append(f"**R₀ (approx):** {params.approx_r0():.1f}")
    table.append(f"**Mortality:** {params.p_death * 100:.1f}%")

    parts.append("  \n".join(table))

    # ── Detailed model parameters ─────────────────────────────────────────────
    param_items: list[str] = [
        f"Beta: {params.beta:.4g}",
        f"Infectious period: {params.dur_inf:.4g} days",
    ]
    if params.dur_exp is not None:
        param_items.append(f"Exposed period: {params.dur_exp:.4g} days")
    if params.dur_immune is not None:
        param_items.append(f"Immunity duration: {params.dur_immune:.4g} days")
    if params.disease_type == "seiar":
        param_items.append(f"Asymptomatic fraction: {params.p_asymp:.0%}")
        param_items.append(f"Asymp. transmissibility: {params.rel_trans_asymp:.0%}")

    if params.network_type == "age_structured":
        age_rf = next((rf for rf in data_sources if rf.field == "age_distribution_pct"), None)
        age_cite = ""
        if age_rf:
            abbrev = _abbrev(age_rf.citation)
            if abbrev:
                used_sources.add(abbrev)
                age_cite = f" [{abbrev}]"
        if all(x is not None for x in (params.age_pct_under18, params.age_pct_18_64, params.age_pct_over65)):
            param_items.append(
                f"Age-structured network · <18: {params.age_pct_under18:.0f}%"
                f" · 18–64: {params.age_pct_18_64:.0f}%"
                f" · 65+: {params.age_pct_over65:.0f}%{age_cite}"
            )
        else:
            param_items.append(f"Age-structured network{age_cite}")
    else:
        param_items.append(f"Random network · {params.n_contacts} contacts/agent")

    if params.use_demographics:
        br_rf = next((rf for rf in data_sources if rf.field == "birth_rate"), None)
        dr_rf = next((rf for rf in data_sources if rf.field == "death_rate"), None)
        demo_cites: set[str] = set()
        for rf in (br_rf, dr_rf):
            if rf:
                abbrev = _abbrev(rf.citation)
                if abbrev:
                    used_sources.add(abbrev)
                    demo_cites.add(abbrev)
        demo_cite = (" [" + ", ".join(sorted(demo_cites)) + "]") if demo_cites else ""
        param_items.append(
            f"Demographics on · birth {params.birth_rate:.1f}/1,000/yr"
            f" · death {params.death_rate:.1f}/1,000/yr{demo_cite}"
        )
    parts.append("**Model parameters**  \n" + " · ".join(param_items))

    # ── References (each source on its own paragraph below the rule) ─────────
    if used_sources:
        ref_blocks: list[str] = ["---", "**References**"]
        for src in ("UN WPP", "WB WDI", "WHO GHO"):
            if src in used_sources:
                ref_blocks.append(f"**{src}** — {_SOURCE_FOOTNOTES[src]}")
        ref_blocks.append("---")
        parts.append("\n\n".join(ref_blocks))

    if param_warnings:
        warn_lines = ["⚠️ **Parameter notes**"]
        for w in param_warnings:
            warn_lines.append(f"- {w}")
        parts.append("  \n".join(warn_lines))

    _RUN_QUESTION = "Would you like to adjust anything, or shall I run the simulation?"
    result = "\n\n".join(parts)
    if lang.lower() != "english":
        from .language import translate
        result = translate(result, lang)
        run_q = translate(_RUN_QUESTION, lang)
    else:
        run_q = _RUN_QUESTION
    return result + "\n\n" + run_q
