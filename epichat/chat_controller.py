"""Conversation state machine helpers for the EpiChat chat UI."""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .resolver import ResolvedField
    from .schema import SimParams

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

_RUN_PHRASES = frozenset({
    "yes", "run", "go", "ok", "okay", "sure", "yep", "yeah",
    "correct", "perfect", "great", "do it", "proceed", "start",
    "run it", "looks good", "go ahead", "let's go", "lets go",
    "run the simulation", "run simulation", "start simulation",
    # Common natural-language affirmations
    "sounds good", "all good", "good", "confirmed", "agreed",
    "go for it", "yes please", "please run", "run now", "run please",
    "ready", "ready to run", "let's run", "lets run",
    "let's do it", "lets do it", "do it now", "execute",
    "you can run", "can run", "go ahead and run",
})

_RUN_NEGATION = frozenset({"no", "not", "don't", "dont", "stop", "wait", "never",
                            "without", "change", "remove", "except", "but"})

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


def detect_run_intent(message: str) -> bool:
    msg = message.lower().strip().rstrip("!.").strip()
    if msg in _RUN_PHRASES:
        return True
    if any(p in msg for p in ("run the sim", "can run", "sounds good", "go for it")):
        return True
    # Short message (≤5 words) containing "run" with no negation/modification language
    words = msg.split()
    if len(words) <= 5 and "run" in words and not (set(words) & _RUN_NEGATION):
        return True
    return False


def detect_new_scenario(message: str) -> bool:
    msg = message.lower()
    return any(re.search(p, msg) for p in _NEW_SCENARIO_PATTERNS)


def update_collected(
    collected: dict[str, bool],
    params,  # SimParams | None
    data_sources: list,
    last_user_message: str,
) -> dict[str, bool]:
    if params is None:
        return dict(collected)
    result = dict(collected)
    msg_lower = last_user_message.lower().strip().rstrip(".")

    if params.disease_type != "sir" or any(
        rf.field in _DISEASE_INDICATOR_FIELDS for rf in data_sources
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
) -> str | None:
    if not collected["disease"]:
        return "What disease or pathogen would you like to model?"
    if not collected["location"]:
        return (
            "Which country or region? "
            "I can pull real demographic and health data if available."
        )
    if not collected["population"]:
        pop_field = next(
            (rf for rf in data_sources if rf.field == "total_population"), None
        )
        if pop_field:
            pop_m = pop_field.value / 1_000_000
            src = _abbrev(pop_field.citation)
            src_str = f" from {src} data" if src else ""
            return (
                f"How large a population? I can use the real population of {pop_m:.1f}M"
                f"{src_str}, or you can specify a number."
            )
        return "How large a population? Please specify (e.g. 100,000)."
    if not collected["interventions"]:
        return (
            "Are there any interventions to include — vaccination, treatment, or "
            "seasonal effects? (Type 'none' to skip)"
        )
    return None


def build_summary(params, data_sources: list, description: str = "") -> str:
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

    label_used = False
    for iv in params.interventions:
        lbl = "**Intervention:**" if not label_used else "↳"
        label_used = True
        if iv.type == "vaccine":
            cov = f"{iv.coverage * 100:.0f}%" if iv.coverage else "?"
            table.append(f"{lbl} Vaccination · {cov} coverage")
        elif iv.type == "treatment":
            cov = f"{iv.coverage * 100:.0f}% coverage" if iv.coverage else ""
            cap_field = next((rf for rf in data_sources if rf.field == "treatment_capacity"), None)
            table.append(f"{lbl} Treatment · {cov}")
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
    network_str = (
        "Age-structured network"
        if params.network_type == "age_structured"
        else f"Random network · {params.n_contacts} contacts/agent"
    )
    param_items.append(network_str)
    if params.use_demographics:
        param_items.append(
            f"Demographics on · birth {params.birth_rate:.1f}/1,000/yr"
            f" · death {params.death_rate:.1f}/1,000/yr"
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

    parts.append("Would you like to adjust anything, or shall I run the simulation?")
    return "\n\n".join(parts)
