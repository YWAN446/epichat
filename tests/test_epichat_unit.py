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

    with patch("epichat.parser.anthropic.Anthropic", return_value=mock_client):
        result = chat.run("run a model")

    assert result.error is not None


def test_format_cli_shows_age_distribution_when_set():
    result = _base_result(
        params=SimParams(
            beta=22.8125,
            age_pct_under18=42.1,
            age_pct_18_64=54.8,
            age_pct_over65=3.1,
        )
    )
    output = result.format_cli()
    assert "Age dist. (0-17)" in output
    assert "42.1%" in output
    assert "Age dist. (18-64)" in output
    assert "54.8%" in output
    assert "Age dist. (65+)" in output
    assert "3.1%" in output


def test_format_cli_omits_age_distribution_when_not_set():
    result = _base_result()
    output = result.format_cli()
    assert "Age dist." not in output


# ---------------------------------------------------------------------------
# Vaccine coverage line tests
# ---------------------------------------------------------------------------

def test_format_cli_no_vaccine_coverage_line_when_no_coverage_source():
    result = _base_result()
    cli = result.format_cli()
    assert "Vaccine coverage" not in cli


def test_format_cli_no_vaccine_coverage_line_when_no_vaccine_intervention():
    resolved = [ResolvedField(field="mcv1_coverage", value=76.0, citation="WHO GHO, KEN, 2022")]
    result = _base_result(data_sources=resolved)
    cli = result.format_cli()
    assert "Vaccine coverage" not in cli


def test_format_cli_shows_vaccine_coverage_line():
    from epichat.schema import Intervention
    vaccine = Intervention(type="vaccine", coverage=0.76, start_day=0)
    params = SimParams(beta=22.8125, interventions=[vaccine])
    resolved = [ResolvedField(field="mcv1_coverage", value=76.0, citation="WHO GHO, KEN, 2022")]
    result = _base_result(params=params, data_sources=resolved)
    cli = result.format_cli()
    assert "Vaccine coverage: 76.0%" in cli
    assert "MCV1" in cli
    assert "pre-existing" in cli


def test_format_cli_vaccine_label_derived_from_field_name():
    from epichat.schema import Intervention
    vaccine = Intervention(type="vaccine", coverage=0.85, start_day=0)
    params = SimParams(beta=22.8125, interventions=[vaccine])
    resolved = [ResolvedField(field="dtp3_coverage", value=85.0, citation="WHO GHO, KEN, 2022")]
    result = _base_result(params=params, data_sources=resolved)
    cli = result.format_cli()
    assert "DTP3" in cli


def test_who_gho_adapter_can_be_instantiated():
    """WHOGHOAdapter requires no API key."""
    from epichat.adapters.who_gho import WHOGHOAdapter
    adapter = WHOGHOAdapter()
    assert adapter.source_name == "who_gho"


# ── alternatives rendering ────────────────────────────────────────────────────

def test_format_cli_single_value_no_star_marker():
    result = _base_result(data_sources=[
        ResolvedField(field="birth_rate", value=28.5, citation="UN WPP, KEN, 2023"),
    ])
    cli = result.format_cli()
    assert "★" not in cli


def test_format_cli_field_with_alternatives_shows_star_used():
    alt = ResolvedField(field="treatment_capacity", value=0.2, citation="WB WDI, KEN, 2021",
                        description="physicians/1,000")
    primary = ResolvedField(field="treatment_capacity", value=2.3, citation="WB WDI, KEN, 2021",
                            description="hospital beds/1,000", alternatives=[alt])
    result = _base_result(data_sources=[primary])
    cli = result.format_cli()
    assert "★ used" in cli


def test_format_cli_alternatives_shown_with_arrow():
    alt = ResolvedField(field="treatment_capacity", value=0.2, citation="WB WDI, KEN, 2021",
                        description="physicians/1,000")
    primary = ResolvedField(field="treatment_capacity", value=2.3, citation="WB WDI, KEN, 2021",
                            description="hospital beds/1,000", alternatives=[alt])
    result = _base_result(data_sources=[primary])
    cli = result.format_cli()
    assert "↳" in cli
    assert "0.2" in cli
    assert "physicians/1,000" in cli


def test_format_cli_description_shown_in_parentheses():
    primary = ResolvedField(field="uhc_coverage", value=56.0, citation="WB WDI, KEN, 2022",
                            description="UHC service coverage index 0–100")
    result = _base_result(data_sources=[primary])
    cli = result.format_cli()
    assert "(UHC service coverage index 0–100)" in cli


def test_format_cli_no_description_no_parentheses():
    primary = ResolvedField(field="birth_rate", value=28.5, citation="UN WPP, KEN, 2023")
    result = _base_result(data_sources=[primary])
    cli = result.format_cli()
    assert "()" not in cli
