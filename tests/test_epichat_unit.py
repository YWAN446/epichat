from epichat.epichat import EpiChatResult
from epichat.resolver import ResolvedField
from epichat.schema import SimParams


def _base_result(**kwargs) -> EpiChatResult:
    defaults = dict(
        user_input="test",
        params=SimParams(beta=22.8125),
        stats={"n_agents": 10000, "peak_infections": 3000, "peak_day": 45, "total_infected": 6000, "total_deaths": 0},
        plot_path=None,
        narration={"summary": "A test.", "key_findings": []},
        data_sources=[],
    )
    defaults.update(kwargs)
    return EpiChatResult(**defaults)


def test_format_cli_no_data_sources_omits_section():
    result = _base_result()
    output = result.format_cli()
    assert "DATA SOURCES" not in output


def test_format_cli_with_data_sources_shows_section():
    result = _base_result(data_sources=[
        ResolvedField(field="birth_rate", value=28.5, citation="UN WPP 2024, Kenya (KEN), 2023"),
        ResolvedField(field="death_rate", value=6.2, citation="UN WPP 2024, Kenya (KEN), 2023"),
    ])
    output = result.format_cli()
    assert "DATA SOURCES" in output
    assert "birth_rate" in output
    assert "28.5" in output
    assert "UN WPP 2024, Kenya (KEN), 2023" in output


def test_format_cli_data_sources_includes_all_fields():
    result = _base_result(data_sources=[
        ResolvedField(field="birth_rate", value=10.5, citation="src A"),
        ResolvedField(field="death_rate", value=8.1, citation="src B"),
        ResolvedField(
            field="age_distribution_pct",
            value={"0-17": 21.6, "18-64": 61.0, "65+": 17.4},
            citation="src C",
        ),
    ])
    output = result.format_cli()
    assert "birth_rate" in output
    assert "src A" in output
    assert "death_rate" in output
    assert "age_distribution_pct" in output
    assert "src C" in output
    assert "0-17: 21.6%" in output


from unittest.mock import MagicMock, patch
from pydantic import ValidationError


def test_epichat_run_handles_validation_error_gracefully():
    """If LLM returns bad params, run() returns an error result instead of crashing."""
    from epichat.epichat import EpiChat
    from epichat.adapters.un_wpp import UNWPPAdapter

    with patch("epichat.adapters.un_wpp._fetch_text", return_value="sep =|\nid|name|iso3|iso2|longitude|latitude\n840|USA|USA|US|0|0\n"):
        chat = EpiChat()

    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text='{"disease_type": "invalid_type_xyz", "beta": -999}')]
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_msg

    with patch("epichat.parser.anthropic.Anthropic", return_value=mock_client), \
         patch("epichat.executor.SimExecutor.run", return_value={"stats": {}, "plot_path": None}):
        result = chat.run("run a model")

    assert result.error is not None
