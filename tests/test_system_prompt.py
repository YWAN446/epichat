"""The system prompt states the rules the golden set grades behaviourally."""
import pytest

from epichat.agent import _SYSTEM, _WEB_TOOLS, build_tools
from epichat.agent import AgentState


@pytest.mark.parametrize("phrase", [
    "under_review",
    "no_source",
    "estimate_range",
    "illustrative assumption",
    "not a forecast",
    "web_search",
    "web_fetch",
])
def test_prompt_states_the_rule(phrase):
    assert phrase in _SYSTEM, f"the system prompt no longer mentions {phrase!r}"


def test_prompt_names_only_tools_that_exist():
    """A prompt that names a tool the agent does not have invites invention."""
    available = {t.name for t in build_tools(AgentState())}
    available |= {t["name"] for t in _WEB_TOOLS}
    for name in ("lookup_disease", "configure_simulation", "run_simulation",
                 "fetch_demographics", "fetch_health_system",
                 "fetch_vaccination_coverage", "web_search", "web_fetch"):
        assert name in available, f"prompt references {name}, which is not a tool"


def test_prompt_covers_both_guardrail_classes():
    lowered = _SYSTEM.lower()
    assert "medical advice" in lowered
    assert "transmissib" in lowered or "virulen" in lowered
