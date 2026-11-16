import json
import pytest
from unittest.mock import MagicMock, patch
from epichat.modifier import apply_modification
from epichat.schema import SimParams


def _base_params(**kwargs):
    defaults = dict(disease_type="sir", n_agents=10000, beta=0.5, dur_inf=10.0, p_death=0.0, sim_dur_years=1.0)
    defaults.update(kwargs)
    return SimParams(**defaults)


def _mock_llm_response(updated: dict):
    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text=json.dumps(updated))]
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_msg
    return mock_client


def test_apply_modification_changes_duration():
    params = _base_params(sim_dur_years=1.0)
    updated = params.model_dump()
    updated["sim_dur_years"] = 5.0
    mock_client = _mock_llm_response(updated)
    with patch("epichat.modifier.anthropic.Anthropic", return_value=mock_client):
        result = apply_modification(params, "change duration to 5 years")
    assert result.sim_dur_years == 5.0


def test_apply_modification_adds_vaccination():
    params = _base_params()
    updated = params.model_dump()
    updated["interventions"] = [{"type": "vaccine", "coverage": 0.7, "start_day": 0}]
    mock_client = _mock_llm_response(updated)
    with patch("epichat.modifier.anthropic.Anthropic", return_value=mock_client):
        result = apply_modification(params, "add vaccination at 70%")
    assert len(result.interventions) == 1
    assert result.interventions[0].type == "vaccine"
    assert result.interventions[0].coverage == pytest.approx(0.7)


def test_apply_modification_preserves_unchanged_fields():
    params = _base_params(n_agents=50000, beta=2.5)
    updated = params.model_dump()
    updated["sim_dur_years"] = 3.0
    mock_client = _mock_llm_response(updated)
    with patch("epichat.modifier.anthropic.Anthropic", return_value=mock_client):
        result = apply_modification(params, "change duration to 3 years")
    assert result.n_agents == 50000
    assert result.beta == pytest.approx(2.5)


def test_apply_modification_raises_on_invalid_json():
    params = _base_params()
    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text="not json at all")]
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_msg
    with patch("epichat.modifier.anthropic.Anthropic", return_value=mock_client):
        with pytest.raises(Exception):
            apply_modification(params, "break everything")
