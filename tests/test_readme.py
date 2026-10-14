"""The README's web-agent section names what the code has (sim-parameters spec, phase 5)."""
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
README = (ROOT / "README.md").read_text(encoding="utf-8")


def source(*parts: str) -> str:
    return ROOT.joinpath(*parts).read_text(encoding="utf-8")


def test_the_readme_describes_the_web_agents_parameters_and_diagnostics():
    assert "## Web agent: parameters, diagnostics and options (2026)" in README
    for phrase in ("epichat/params/registry.py", "web/data/param_registry.json", "schema v2", "describe_parameters", "advanced",
                   "dur_inf_days", "seed_count", "epichat/sim/diagnostics.py", "early_fadeout", "cfr_out_of_range",
                   "diagnostic_shown", "option_chosen", "0007_run_diagnostics.sql", "web/docs/DEPLOY.md",
                   "docs/superpowers/specs/2026-10-09-sim-parameters-disease-design.md"):
        assert phrase in README, phrase
    assert README.index("## Web agent: parameters") < README.index("## Input Types")
    assert "the v1 flat shape" in README.split("## Parameters Reference")[1]


def test_the_readme_describes_part_2_from_the_codes_own_names():
    import typing

    from epichat.schema import Intervention

    web = README.split("## Web agent: parameters")[1].split("## Input Types")[0]
    for phrase in ("docs/superpowers/specs/2026-10-12-sim-parameters-modules-design.md", "hybrid", "Prem 2021", "UN WPP 2024",
                   "household", "measured R0", "beta_calibrated_by_measurement", "well_mixed", "r0_gap", "run.fit", "attack rate",
                   "docs/data-review-requests.md", "scripts/review_requests.py", "rel_sus_age", "p_death_age", "rel_trans_exposed"):
        assert phrase in web, phrase
    # every bundled table and every intervention type is named where the reader looks for it
    data = Path(__file__).resolve().parent.parent / "epichat" / "data"
    for csv in sorted(p.name for p in data.glob("*.csv")):
        assert csv in README, csv
    types = typing.get_args(Intervention.model_fields["type"].annotation)
    assert {"contact_reduction", "transmission_reduction"} <= set(types)
    interventions = README.split("## Interventions")[1].split("## Natural Language Query Tips")[0]
    for kind in types:
        assert f"`{kind}`" in interventions, kind
    for field in ("efficacy", "end_day", "protection_days", "delay_days", "rel_trans_treated", "symptomatic_only", "layer", "peak_day"):
        assert f"`{field}`" in interventions, field


def test_the_runbook_verifies_part_2_through_the_shipped_fields():
    runbook = source("web", "docs", "DEPLOY.md")
    section = runbook.split("## 6j.")[1].split("## 6k.")[0]
    # every string the section quotes from the product exists in the file that produces it (2D review, Important 7)
    quoted = {
        "contacts reduced by": ("web", "lib", "client", "format.ts"),
        "Fitted to": ("web", "lib", "client", "parameters.ts"),
        "Household size": ("web", "lib", "client", "format.ts"),
        "households, schools, workplaces, community": ("web", "lib", "client", "format.ts"),
        "R₀ measured": ("web", "lib", "report", "compose.ts"),
        "What was modelled": ("web", "lib", "report", "document.ts"),
        "beta_calibrated_by_measurement": ("web", "lib", "tools", "runSimulation.ts"),
        "r0_calibration": ("epichat", "sim", "replicates.py"),
        "r0_measured": ("epichat", "sim", "outputs.py"),
        "contact_reduction": ("epichat", "schema.py"),
        "attack_rate": ("epichat", "sim", "fit.py"),
    }
    for phrase, where in quoted.items():
        assert phrase in section, phrase
        assert phrase in source(*where), (phrase, where)
    for phrase in ("hybrid", "layer", "School contacts reduced by 100%", "Why were so many infected", "stats->'fit'"):
        assert phrase in section, phrase
    # Important 1: the measured R0 is a report row; the runs panel has none, so the runbook must not send the owner there
    assert "R₀ measured" not in source("web", "components", "panel", "RunsSection.tsx")
    assert "runs panel and the report" not in section and "Create a report" in section
    # Important 2: the fit replaces the pilot, so the fitted run carries no calibration
    assert "the hybrid runs carry" not in section and "no `calibration`" in section
    # Important 3: a fitted hybrid run at 50,000 agents does not fit the service's timeout on Vercel
    assert "with 10,000 agents" in section and "50,000" not in section
    # Important 4: a country brings a fetch that moves the scenario off the random network
    assert "Kenya" not in section and "a city of 20,000 people" in section
    tail = runbook.split("## 7.")[1]
    assert "at most eight" in tail
    fitted = tail.split("A fitted run")[1].split("\n\n")[0]
    assert "hybrid" in fitted and "120 s" in fitted and "one case to keep" not in fitted
    assert str(int(float(__import__("re").search(r'SIM_TIMEOUT_SECONDS", "(\d+)"', source("sim", "settings.py")).group(1)))) == "120"


def test_the_readme_states_part_2_as_the_code_runs_it():
    """The 2D review's findings: each statement is checked against the code it describes."""
    import pydantic

    from epichat.params.r0 import r0_is_approximate
    from epichat.params.schema_v2 import SimParamsV2
    from epichat.schema import Intervention, SimParams

    web = README.split("## Web agent: parameters")[1].split("## Input Types")[0]
    # Important 6: the measured R0 is null on the age-structured network, and lasting contacts make the formula approximate too
    assert "every run reports the measured R0" not in web and "null on the age-structured network" in web
    assert r0_is_approximate(SimParamsV2.model_validate({"network": {"contact_duration_days": 3}}))
    assert "`contact_duration_days` above 0" in web
    # re-graded minor 4: a country alone does not bring the pyramid; fetch_demographics sets the age source
    assert "With a country, the agents' ages follow" not in web and "`demographics.age_source`" in web
    # Important 5: the v1 shape has no hybrid network
    with pytest.raises(pydantic.ValidationError):
        SimParams(network_type="hybrid")
    row = next(line for line in README.splitlines() if line.startswith("| `network_type` |"))
    assert "`hybrid` (web agent and `/simulate` only)" in row
    interventions = README.split("## Interventions")[1].split("## Natural Language Query Tips")[0]
    # re-graded minor 2: the delay counts from becoming infectious; the waiting factor applies while queued behind the capacity
    assert "days from infection to treatment" not in interventions and "from becoming infectious" in interventions
    waiting = next(line for line in interventions.splitlines() if line.startswith("| `rel_trans_treated` |"))
    assert "while queued" in waiting and "`capacity`" in waiting
    # re-graded minor 3: only the plain (v1-shaped) day-0 vaccine is pre-existing immunity
    assert Intervention(type="vaccine", coverage=0.5, start_day=0).is_day0_immunity()
    assert not Intervention(type="vaccine", coverage=0.5, start_day=0, age_min=5, age_max=18).is_day0_immunity()
    assert not Intervention(type="vaccine", coverage=0.5, start_day=0, protection_days=90).is_day0_immunity()
    assert "ages, a protection duration or all-or-nothing protection" in interventions


def test_the_readme_describes_the_limits_on_spread():
    web = README.split("## Web agent: parameters")[1].split("## Input Types")[0]
    for phrase in ("Limits on spread", "rel_sus_cv", "behavior_response", "herd immunity threshold", "off by default",
                   "docs/superpowers/specs/2026-10-13-limits-suggestions-parameters-design.md"):
        assert phrase in web, phrase
    # the README's own claim about what limits an epidemic matches the diagnostics' closed form
    from epichat.sim.diagnostics import final_size
    assert round(final_size(2.5) * 100) == 89 and round(final_size(2.5, 1.0) * 100) == 60
    assert "89%" in web and "60%" in web


def test_the_readme_describes_the_suggested_interventions():
    web = README.split("## Web agent: parameters")[1].split("## Input Types")[0]
    for phrase in ("what_if", "Try next", "epichat/params/indicators.py", "interventions field", "on every network"):
        assert phrase in web, phrase
    assert "a random-network run that a" not in web                 # well_mixed no longer blames the random network


def test_the_readme_describes_the_parameters_section():
    web = README.split("## Web agent: parameters")[1].split("## Input Types")[0]
    for phrase in ("Parameters section", "Show all", "web/lib/client/parameters.ts", "where each value came from", "by network"):
        assert phrase in web, phrase


def test_the_readme_describes_the_chosen_references():
    web = README.split("## Web agent: parameters")[1].split("## Input Types")[0]
    for phrase in ("Use this value", "use_reference", "ref:", "web/lib/tools/chosenReference.ts"):
        assert phrase in web, phrase


def test_the_runbook_verifies_the_follow_up_through_the_shipped_strings():
    runbook = source("web", "docs", "DEPLOY.md")
    section = " ".join(runbook.split("## 6k.")[1].split("## 7.")[0].split())      # a quoted string may wrap
    quoted = {
        "Try next": ("web", "components", "RunSummary.tsx"),
        "Interventions to try": ("epichat", "sim", "diagnostics.py"),
        "Let people become careful as cases rise and rerun": ("epichat", "sim", "diagnostics.py"),
        "Add variation between people (CV": ("epichat", "sim", "diagnostics.py"),
        "Variation in susceptibility": ("web", "lib", "client", "parameters.ts"),
        "Behaviour response: transmission falls by up to": ("web", "lib", "client", "format.ts"),
        "by moving": ("web", "lib", "client", "parameters.ts"),
        "the variation in susceptibility": ("web", "lib", "client", "format.ts"),
        "ended the fit": ("web", "lib", "tools", "configureSimulation.ts"),
        "Show all (": ("web", "components", "panel", "ParametersSection.tsx"),
        "set in chat": ("web", "lib", "client", "parameters.ts"),
        "set by the run": ("web", "lib", "client", "parameters.ts"),
        "assumption": ("web", "lib", "client", "parameters.ts"),
        "Transmission rate (β)": ("web", "lib", "client", "parameters.ts"),
        "Use this value": ("web", "components", "panel", "ReferenceList.tsx"),
        "R0 moved from": ("web", "lib", "tools", "configureSimulation.ts"),
        "use_reference": ("web", "lib", "tools", "configureSimulation.ts"),
        "Literature": ("web", "lib", "report", "compose.ts"),
        "what_if": ("epichat", "sim", "diagnostics.py"),
        "suggestion_used": ("web", "lib", "enums.ts"),
        "option_chosen": ("web", "lib", "enums.ts"),
    }
    for phrase, path in quoted.items():
        assert phrase in section, phrase
        assert phrase in source(*path), (phrase, path)
    # the five groups, under the titles the section renders
    groups = source("web", "lib", "client", "parameters.ts")
    for title in ("Disease", "Contact network", "Demographics", "Interventions", "Run"):
        assert f'title: "{title}"' in groups and title in section, title
    # the message of the button, in the form the panel sends it
    assert "Use Measles reference" in section and "Use ${disease" in source("web", "lib", "client", "references.ts")
    # the sources of a pressed button and of a chosen reference
    enums = source("web", "lib", "enums.ts")
    assert '"option", "reference"' in enums and '{"source": "option"}' in section and '{"source": "reference"}' in section
    # the earlier sections say nothing the round made untrue
    earlier = " ".join(runbook.split("## 6h.")[1].split("## 6k.")[0].split())
    for stale in ("explains the random network (fresh contacts every day)", "offers the hybrid network as an option", "the initial prevalence",
                  "Interventions section reads", '"Replicates:'):
        assert stale not in earlier, stale
    step_4 = " ".join(runbook.split("## 6j.")[1].split("## 6k.")[0].split("\n4. ")[1].split("\n5. ")[0].split())
    # a known attack rate with a database R0 is now fitted with the variation (follow-up spec 6): the beta fit needs the R0 said to be unknown
    assert "R0 is not known" in step_4 and "by moving the transmission rate" in step_4
    assert "R0 itself is unknown" in source("web", "lib", "chat", "prompt.ts")
    step_5 = " ".join(runbook.split("## 6j.")[1].split("## 6k.")[0].split("\n5. ")[1].split("\n6. ")[0].split())
    assert "depletion of susceptibles" in step_5 and "depletion of susceptibles" in source("epichat", "sim", "diagnostics.py")
    # what a fit that keeps R0 costs, beside the beta fit's numbers
    keeps = runbook.split("## 7.")[1].split("A fit that keeps R0")[1].split("\n\n")[0]
    assert "disease.rel_sus_cv" in keeps and "every trial" in keeps and "PILOT_LEVERS" in source("epichat", "sim", "fit.py")
