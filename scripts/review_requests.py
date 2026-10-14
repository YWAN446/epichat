"""The review-request list for the database team (sim-parameters Part 2, section 11).

    py -3.12 scripts/review_requests.py                       # print the Markdown
    py -3.12 scripts/review_requests.py --write docs/data-review-requests.md

For every disease and every database field the registry names, existing and requested, the status
and what a reviewer should find, then the entries the script itself finds worth a second look.
Regenerate whenever the database or the registry changes.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from epichat.disease_db import _num, _rich_param, listed_estimates, load_db, parameter_summary  # noqa: E402
from epichat.params.registry import DB_FIELDS  # noqa: E402

REQUESTED_FIELDS = {
    "fatality_rate_by_age": "Case fatality ratio for children (under 18), adults (18 to 64) and the elderly (65 and over), as fractions, with the surveillance or cohort source; the registry's disease.p_death_age.",
    "vaccine_efficacy": "Protection against infection of the routine vaccine, as a fraction, naming the product and the dose schedule; the registry's interventions[].efficacy.",
    "treatment_efficacy": "Share of treated cases cured and the usual delay from symptoms to treatment, naming the treatment; the registry's interventions[].efficacy and delay_days.",
    "presymptomatic_transmission": "Share of transmission that happens before symptoms, or the latent-period infectiousness as a fraction of the symptomatic one; the registry's disease.rel_trans_exposed.",
    "school_closure_effect": "The reduction in school-age contacts or transmission while schools are closed, as a cited range (a systematic review or a modelling study with data), seeding the illustrative default of a full closure; the registry's interventions[].scale on the school layer.",
    "distancing_effect": "The reduction in community contacts under distancing measures, as a cited range, seeding the illustrative default; the registry's interventions[].scale on the community layer.",
    "mask_effect": "The reduction in per-contact transmission from mask use, as a cited range, seeding the illustrative default of a transmission reduction; the registry's interventions[].scale.",
    "susceptibility_variation": "The coefficient of variation of susceptibility or exposure between people, as a cited range with the population and the method (a household study, a serosurvey, a fitted model), seeding the illustrative value of 1 the agent offers (the default is 0, no variation); the registry's disease.rel_sus_cv.",
    "behaviour_response_effect": "The reduction in contacts or transmission observed as prevalence or deaths rose, without or before formal measures, as a cited range with the prevalence at which it was observed and the delay before people responded (mobility data, contact surveys), seeding the illustrative values the agent offers (up to 50%, half of it at 1% infectious, a 7-day memory); the registry's interventions[].scale, half_prevalence and memory_days of a behavior_response entry.",
}

EXISTING_NOTES = {
    "r0": "The basic reproduction number in a susceptible population.",
    "incubation_days": "Days from infection to symptoms (the latent period for the models).",
    "infectious_days": "Days a case transmits.",
    "fatality_rate": "Case fatality ratio of symptomatic cases, as a percentage or fraction with the unit stated.",
    "average_contacts_daily": "Contacts per person per day in the setting the estimate comes from.",
    "immunity_duration": "Duration of immunity after infection, in days.",
    "asymptomatic_fraction": "Share of infections that never show symptoms.",
}

BUNDLED_CHECKS = [
    ("contact matrices (Prem et al. 2021)", "the aggregation from 16 age bands to three against the published matrix for two countries"),
    ("UN WPP 2024 population by age", "the vintage, and a spot check of five countries against the UN site"),
    ("UN WPP 2024 crude birth rates", "the vintage and the projection variant"),
    ("UN household size", "the vintage and the definition of a household"),
]


def review_table() -> list[dict]:
    db = load_db()
    rows = []
    for disease in sorted(db["diseases"]):
        entry = db["diseases"][disease]
        for field in DB_FIELDS:
            summary = parameter_summary(entry, field) or {}
            rows.append({"disease": disease, "field": field, "status": summary.get("status", "no_source"), "note": EXISTING_NOTES[field]})
        for field, note in REQUESTED_FIELDS.items():
            rows.append({"disease": disease, "field": field, "status": "requested", "note": note})
    return rows


def entries_to_check(db: dict | None = None) -> list[dict]:
    """Entries worth a second look: an estimate outside its own range, a consensus range none of its estimates is in.

    An estimate outside the consensus is not one: the consensus leaves out narrow populations and single outbreaks on
    purpose. `estimate` is the place in the app's reference list (the estimates with a title, as the export writes
    them); None for an estimate the app does not list and for a consensus row.
    """
    db = load_db() if db is None else db
    checks = []
    for disease in sorted(db["diseases"]):
        for field in DB_FIELDS:
            rich = _rich_param(db["diseases"][disease], field)
            if not isinstance(rich, dict):
                continue
            unit = f" ({rich['unit']})" if isinstance(rich.get("unit"), str) else ""
            estimates = [e for e in rich.get("estimates") or [] if isinstance(e, dict)]
            places = {id(e): place for place, e in enumerate(listed_estimates(rich), start=1)}
            for estimate in estimates:
                value, bounds = _num(estimate.get("value")), estimate.get("range")
                if value is None or not isinstance(bounds, list) or len(bounds) != 2 or any(_num(b) is None for b in bounds):
                    continue
                if not min(bounds) <= value <= max(bounds):
                    checks.append({"disease": disease, "field": field, "kind": "estimate", "estimate": places.get(id(estimate)),
                                   "title": estimate.get("title") or None, "year": estimate.get("year"), "value": value,
                                   "problem": f"the value {value:g} lies outside its own range, {min(bounds):g} to {max(bounds):g}{unit}."})
            consensus = rich.get("consensus") if isinstance(rich.get("consensus"), dict) else {}
            low, high = _num(consensus.get("min")), _num(consensus.get("max"))
            values = [v for v in (_num(e.get("value")) for e in estimates) if v is not None]
            if values and low is not None and high is not None and not any(low <= v <= high for v in values):
                listed = ", ".join(f"{v:g}" for v in values)
                held = f"does not hold its only estimate ({listed})" if len(values) == 1 else f"holds none of its {len(values)} estimates ({listed})"
                checks.append({"disease": disease, "field": field, "kind": "consensus", "estimate": None,
                               "problem": f"the consensus range, {low:g} to {high:g}{unit}, {held}."})
    return checks


def _check_line(check: dict) -> str:
    where, cited = f"{check['disease']}, {check['field']}", ""
    if check["kind"] == "estimate" and check["estimate"] is None:
        where, cited = where + ", an estimate without a title", " (not in the app's list)"
    elif check["kind"] == "estimate":
        title = check["title"] if len(check["title"]) <= 80 else check["title"][:79].rstrip() + "…"
        where, cited = where + f", estimate {check['estimate']}", f" ({title}{', ' + str(check['year']) if check.get('year') else ''})"
    return f"- **{where}**{cited}: {check['problem']}"


def render(rows: list[dict], checks: list[dict] | None = None) -> str:
    checks = entries_to_check() if checks is None else checks
    fields = list(dict.fromkeys(r["field"] for r in rows))
    lines = ["# Data review requests", "", "Generated by `scripts/review_requests.py` from the parameter database and the registry.", ""]
    lines += ["## Requested fields", ""]
    lines += [f"- **{field}**: {note}" for field, note in REQUESTED_FIELDS.items()]
    lines += ["", "## Coverage by disease", "", "| disease | " + " | ".join(fields) + " |", "|---|" + "---|" * len(fields)]
    for disease in dict.fromkeys(r["disease"] for r in rows):
        mine = {r["field"]: r["status"] for r in rows if r["disease"] == disease}
        lines.append(f"| {disease} | " + " | ".join(mine[f] for f in fields) + " |")
    lines += ["", "What each existing field should hold:", ""]
    lines += [f"- **{field}**: {note}" for field, note in EXISTING_NOTES.items()]
    lines += ["", "## Entries to check", "", "Found by the script: an estimate whose value lies outside its own range, and a consensus range that holds none of its parameter's estimates. The number is the estimate's place in the app's reference list for that parameter.", ""]
    lines += [_check_line(c) for c in checks] or ["None today."]
    lines += ["", "## Bundled tables", ""]
    lines += [f"- **{name}**: check {check}." for name, check in BUNDLED_CHECKS]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", type=Path)
    args = parser.parse_args()
    text = render(review_table())
    if args.write:
        args.write.write_text(text, encoding="utf-8", newline="\n")
        print(f"wrote {args.write}")
    else:
        print(text)


if __name__ == "__main__":
    main()
