"""Follow-up spec 7.2: the diseases with a routine-immunization indicator live in one place."""
import ast
import json
from pathlib import Path

from epichat.params.indicators import VACCINE_INDICATORS, has_vaccine_indicator

ROOT = Path(__file__).resolve().parent.parent


def test_the_frozen_agent_and_the_web_read_the_same_list():
    tree = ast.parse((ROOT / "epichat" / "agent.py").read_text(encoding="utf-8"))
    frozen = next(ast.literal_eval(node.value) for node in ast.walk(tree)
                  if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "_GHO_CODES" for t in node.targets))
    assert frozen == VACCINE_INDICATORS
    exported = json.loads((ROOT / "web" / "data" / "vaccine_indicators.json").read_text(encoding="utf-8"))
    assert exported == {"indicators": VACCINE_INDICATORS}


def test_a_disease_is_matched_by_its_canonical_name():
    assert has_vaccine_indicator("measles") and has_vaccine_indicator("Measles")
    assert not has_vaccine_indicator("covid19") and not has_vaccine_indicator(None) and not has_vaccine_indicator("")
