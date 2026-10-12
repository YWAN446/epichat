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
