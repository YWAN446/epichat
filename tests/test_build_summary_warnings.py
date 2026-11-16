"""Tests for param_warnings display in build_summary."""


def _make_params(**kwargs):
    from epichat.schema import SimParams
    defaults = dict(beta=10.0, disease_type="sir")
    defaults.update(kwargs)
    return SimParams(**defaults)


class TestBuildSummaryWarnings:
    def test_no_warning_section_when_empty(self):
        from epichat.chat_controller import build_summary
        params = _make_params()
        output = build_summary(params, data_sources=[], param_warnings=[])
        assert "Parameter notes" not in output

    def test_warning_section_appears_when_warnings_present(self):
        from epichat.chat_controller import build_summary
        params = _make_params()
        output = build_summary(
            params,
            data_sources=[],
            param_warnings=["R₀ ≈ 50.0 is outside the literature range for measles (12–18)."],
        )
        assert "Parameter notes" in output

    def test_warning_text_in_output(self):
        from epichat.chat_controller import build_summary
        params = _make_params()
        output = build_summary(
            params,
            data_sources=[],
            param_warnings=["R₀ ≈ 50.0 is outside the literature range for measles (12–18)."],
        )
        assert "50.0" in output
        assert "measles" in output

    def test_warning_appears_before_run_question(self):
        from epichat.chat_controller import build_summary
        params = _make_params()
        output = build_summary(
            params,
            data_sources=[],
            param_warnings=["Some warning here"],
        )
        warning_pos = output.index("Some warning here")
        run_q_pos = output.index("Would you like to adjust")
        assert warning_pos < run_q_pos

    def test_default_param_warnings_is_empty(self):
        """build_summary() still works when param_warnings not passed."""
        from epichat.chat_controller import build_summary
        params = _make_params()
        output = build_summary(params, data_sources=[])
        assert "Parameter notes" not in output

    def test_multiple_warnings_all_in_output(self):
        from epichat.chat_controller import build_summary
        params = _make_params()
        output = build_summary(
            params,
            data_sources=[],
            param_warnings=["First warning", "Second warning"],
        )
        assert "First warning" in output
        assert "Second warning" in output
