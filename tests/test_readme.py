"""The README's web-agent section names what the code has (sim-parameters spec, phase 5)."""
from pathlib import Path

README = (Path(__file__).resolve().parent.parent / "README.md").read_text(encoding="utf-8")


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
