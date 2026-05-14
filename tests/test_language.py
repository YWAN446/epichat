from unittest.mock import MagicMock, patch


def _mock_response(text: str):
    block = MagicMock()
    block.type = "text"
    block.text = text
    resp = MagicMock()
    resp.content = [block]
    return resp


# ── detect_language ────────────────────────────────────────────────────────────

def test_detect_language_returns_english_for_empty_string():
    from epichat.language import detect_language
    assert detect_language("") == "English"


def test_detect_language_returns_english_for_whitespace():
    from epichat.language import detect_language
    assert detect_language("   ") == "English"


def test_detect_language_calls_llm_and_returns_result():
    with patch("epichat.language.anthropic.Anthropic") as mock_cls:
        mock_cls.return_value.messages.create.return_value = _mock_response("French")
        from epichat.language import detect_language
        result = detect_language("Simuler la rougeole en France")
    assert result == "French"
    mock_cls.return_value.messages.create.assert_called_once()


def test_detect_language_falls_back_on_api_error():
    with patch("epichat.language.anthropic.Anthropic") as mock_cls:
        mock_cls.return_value.messages.create.side_effect = Exception("API error")
        from epichat.language import detect_language
        result = detect_language("Hola mundo")
    assert result == "English"


# ── translate ─────────────────────────────────────────────────────────────────

def test_translate_noop_for_english():
    with patch("epichat.language.anthropic.Anthropic") as mock_cls:
        from epichat.language import translate
        result = translate("Hello world", "English")
    mock_cls.assert_not_called()
    assert result == "Hello world"


def test_translate_noop_for_empty_text():
    with patch("epichat.language.anthropic.Anthropic") as mock_cls:
        from epichat.language import translate
        result = translate("", "French")
    mock_cls.assert_not_called()
    assert result == ""


def test_translate_calls_llm_for_non_english():
    with patch("epichat.language.anthropic.Anthropic") as mock_cls:
        mock_cls.return_value.messages.create.return_value = _mock_response(
            "Quelle maladie souhaitez-vous modéliser?"
        )
        from epichat.language import translate
        result = translate("What disease would you like to model?", "French")
    assert result == "Quelle maladie souhaitez-vous modéliser?"


def test_translate_falls_back_to_original_on_error():
    with patch("epichat.language.anthropic.Anthropic") as mock_cls:
        mock_cls.return_value.messages.create.side_effect = Exception("timeout")
        from epichat.language import translate
        result = translate("What disease would you like to model?", "Spanish")
    assert result == "What disease would you like to model?"


# ── next_question with lang ────────────────────────────────────────────────────

def test_next_question_english_no_translate_call():
    """When lang='English', translate() must NOT be called."""
    with patch("epichat.language.translate") as mock_translate:
        from epichat.chat_controller import next_question
        collected = {"disease": False, "location": False, "population": False, "interventions": False}
        q = next_question(collected, None, [], lang="English")
    mock_translate.assert_not_called()
    assert "disease" in q.lower()


def test_next_question_non_english_calls_translate():
    """When lang is not English, translate() should be called with the English question."""
    with patch("epichat.language.translate", return_value="Quelle maladie?") as mock_t:
        from epichat.chat_controller import next_question
        collected = {"disease": False, "location": False, "population": False, "interventions": False}
        q = next_question(collected, None, [], lang="French")
    mock_t.assert_called_once()
    assert q == "Quelle maladie?"


def test_next_question_none_when_all_collected_no_translate():
    with patch("epichat.language.translate") as mock_t:
        from epichat.chat_controller import next_question
        collected = {"disease": True, "location": True, "population": True, "interventions": True}
        q = next_question(collected, None, [], lang="Spanish")
    mock_t.assert_not_called()
    assert q is None


# ── build_summary with lang ────────────────────────────────────────────────────

def test_build_summary_english_no_translate_call():
    with patch("epichat.language.translate") as mock_t:
        from epichat.chat_controller import build_summary
        from epichat.schema import SimParams
        params = SimParams(disease_type="sir", n_agents=1000, beta=10.0,
                           n_contacts=4, init_prev=0.01, dur_inf=10.0,
                           p_death=0.0, sim_dur_years=1.0)
        build_summary(params, [], lang="English")
    mock_t.assert_not_called()


def test_build_summary_non_english_calls_translate():
    with patch("epichat.language.translate", return_value="TRANSLATED") as mock_t:
        from epichat.chat_controller import build_summary
        from epichat.schema import SimParams
        params = SimParams(disease_type="sir", n_agents=1000, beta=10.0,
                           n_contacts=4, init_prev=0.01, dur_inf=10.0,
                           p_death=0.0, sim_dur_years=1.0)
        result = build_summary(params, [], lang="Spanish")
    # Two calls: one for the main body, one for the run question
    assert mock_t.call_count == 2
    assert result == "TRANSLATED\n\nTRANSLATED"
