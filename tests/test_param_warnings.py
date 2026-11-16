"""Tests for param_warnings integration in EpiChatResult."""
from dataclasses import fields


class TestEpiChatResultHasWarningsField:
    def test_param_warnings_field_exists(self):
        from epichat import EpiChatResult
        field_names = [f.name for f in fields(EpiChatResult)]
        assert "param_warnings" in field_names

    def test_param_warnings_defaults_to_empty_list(self):
        from epichat import EpiChatResult
        from epichat.schema import SimParams
        result = EpiChatResult(
            user_input="test",
            params=SimParams(beta=10.0, disease_type="sir"),
            stats={},
            plot_path=None,
            narration={},
        )
        assert result.param_warnings == []

    def test_param_warnings_can_be_set(self):
        from epichat import EpiChatResult
        from epichat.schema import SimParams
        result = EpiChatResult(
            user_input="test",
            params=SimParams(beta=10.0, disease_type="sir"),
            stats={},
            plot_path=None,
            narration={},
            param_warnings=["R₀ too high"],
        )
        assert result.param_warnings == ["R₀ too high"]


class TestFormatCliShowsWarnings:
    def _make_result(self, warnings):
        from epichat import EpiChatResult
        from epichat.schema import SimParams
        return EpiChatResult(
            user_input="test",
            params=SimParams(beta=10.0, disease_type="sir"),
            stats={"peak_infections": 0, "total_infected": 0, "total_deaths": 0, "n_agents": 100},
            plot_path=None,
            narration={"summary": "test summary", "key_findings": []},
            param_warnings=warnings,
        )

    def test_no_warning_block_when_empty(self):
        result = self._make_result([])
        output = result.format_cli()
        assert "Parameter notes" not in output

    def test_warning_block_appears_when_non_empty(self):
        result = self._make_result(["R₀ ≈ 100 is outside the literature range for measles (12–18)."])
        output = result.format_cli()
        assert "Parameter notes" in output

    def test_warning_text_appears_in_output(self):
        result = self._make_result(["R₀ ≈ 100 is outside the literature range for measles (12–18)."])
        output = result.format_cli()
        assert "100" in output
        assert "measles" in output

    def test_multiple_warnings_all_appear(self):
        result = self._make_result(["Warning one", "Warning two"])
        output = result.format_cli()
        assert "Warning one" in output
        assert "Warning two" in output
