"""Plot mode must keep rendering exactly what the CLI and Streamlit app have
always run (fixtures captured before the JSON mode was added); json mode must
write a result file and never touch matplotlib."""
import re
from pathlib import Path

import pytest

from epichat.generator import CodeGenerator
from template_cases import OUTPUT_PATH, cases

FIXTURES = Path(__file__).parent / "fixtures" / "templates_plot"
CASES = cases()


@pytest.mark.parametrize("name", sorted(CASES))
def test_plot_mode_is_unchanged(name):
    rendered = CodeGenerator().generate(CASES[name], OUTPUT_PATH)
    expected = (FIXTURES / f"{name}.py").read_text(encoding="utf-8")
    assert rendered.rstrip("\n") == expected.rstrip("\n")


@pytest.mark.parametrize("name", sorted(CASES))
def test_plot_mode_is_the_default_and_explicit_plot_matches(name):
    generator = CodeGenerator()
    assert generator.generate(CASES[name], OUTPUT_PATH) == generator.generate(
        CASES[name], OUTPUT_PATH, output_mode="plot"
    )


@pytest.mark.parametrize("name", sorted(CASES))
def test_json_mode_never_imports_matplotlib(name):
    rendered = CodeGenerator().generate(CASES[name], "/tmp/out.json", output_mode="json")
    assert "matplotlib" not in rendered
    assert "plt." not in rendered


@pytest.mark.parametrize("name", sorted(CASES))
def test_json_mode_writes_stats_and_series_to_the_output_path(name):
    rendered = CodeGenerator().generate(CASES[name], "/tmp/out.json", output_mode="json")
    assert "json.dump({'stats': _stats, 'series': _series}, _f)" in rendered
    assert "open(r'/tmp/out.json', 'w', encoding='utf-8')" in rendered
    for key in ("n_susceptible", "n_infected", "n_recovered", "new_infections", "cum_infections",
                "new_deaths", "cum_deaths", "n_exposed", "n_asymptomatic"):
        assert f"'{key}'" in rendered
    assert "'day': list(range(len(_rs['timevec'])))" in rendered
    # the stats line the executor reads from stdout is still printed in json mode
    assert re.search(r"^print\(json\.dumps\(\{", rendered, re.MULTILINE)


def test_unknown_output_mode_is_rejected():
    with pytest.raises(ValueError, match="output_mode"):
        CodeGenerator().generate(CASES["sir"], OUTPUT_PATH, output_mode="pdf")


@pytest.mark.parametrize("name", sorted(CASES))
def test_both_modes_compile(name):
    for mode in ("plot", "json"):
        compile(CodeGenerator().generate(CASES[name], "/tmp/out", output_mode=mode), f"{name}-{mode}", "exec")
