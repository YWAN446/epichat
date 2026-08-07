"""EpiChat — conversational epidemiological simulation assistant."""

from __future__ import annotations

import base64
import datetime
import functools
import os
import uuid
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

load_dotenv()

DEV_MODE = os.environ.get("EPICHAT_DEV_MODE", "false").lower() == "true"

from epichat.chat_controller import (
    build_summary,
    detect_new_scenario,
    detect_run_intent,
    next_question,
    update_collected,
)
from epichat.epichat import EpiChat
from epichat.exporter import to_docx, to_pdf
from epichat.modifier import apply_modification, generate_sim_description
from epichat.narrator import narrate
from epichat.enricher import enrich_input
from epichat.language import detect_language, detect_location_correction
from epichat.parser import get_last_resolved, get_last_location_queried, parse_query

# Logo assets. The Streamlit theme is dark, so the dark variants are the ones in use;
# paths resolve against this file rather than the working directory.
_ASSETS = Path(__file__).parent / "assets"
_LOGO = _ASSETS / "epichat-logo-dark.png"
_ICON = _ASSETS / "epichat-icon-dark.png"


@functools.lru_cache(maxsize=8)
def _data_uri(path: Path) -> str:
    """Inline an image for the HTML blocks, which can't reach the filesystem."""
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()


st.set_page_config(page_title="EpiChat", page_icon=str(_ICON), layout="wide")
# Streamlit renders the chrome logo at roughly 24px either way, so both slots get the
# simplified icon; the full mark is illegible at that size.
st.logo(
    str(_ICON),
    size="large",
    icon_image=str(_ICON),
    link="https://ywan446.github.io/epichat/",
)
# st.logo caps out around 32px even at size="large"; scale the mark up past the
# cap and let the sidebar header grow to hold it (it is fixed at 60px otherwise).
st.markdown(
    "<style>"
    "img[data-testid='stSidebarLogo'], .stLogo { height: 4.5rem; width: auto; }"
    "[data-testid='stSidebarHeader'] { height: auto; }"
    "</style>",
    unsafe_allow_html=True,
)

Path("results").mkdir(exist_ok=True)

# ── Singleton EpiChat (registers adapters once per session) ───────────────────
if "chat" not in st.session_state:
    st.session_state.chat = EpiChat(output_dir="results")

# ── Session state defaults ────────────────────────────────────────────────────
_CONV_DEFAULTS: dict = {
    "active_conv_id": None,
    "stage": "greeting",
    "context": "",
    "params": None,
    "data_sources": [],
    "plot_path": None,
    "collected": {
        "disease": False,
        "location": False,
        "population": False,
        "interventions": False,
    },
    "messages": [],
    "pending_input": None,
    "outbreak_context": None,
    "user_language": None,
}

for key, val in [
    ("conversations", []),
    *_CONV_DEFAULTS.items(),
]:
    if key not in st.session_state:
        st.session_state[key] = val


# ── Helper: message list manipulation ────────────────────────────────────────

def _add_msg(role: str, content: str, plot_path: str | None = None) -> None:
    st.session_state.messages.append(
        {"role": role, "content": content, "plot_path": plot_path}
    )


def _save_current_conversation() -> None:
    msgs = st.session_state.messages
    if not msgs:
        return
    # Already in history — don't create a duplicate
    if st.session_state.active_conv_id is not None:
        return
    first_user = next((m["content"] for m in msgs if m["role"] == "user"), "Conversation")
    st.session_state.conversations.append({
        "id": str(uuid.uuid4()),
        "title": first_user,
        "messages": list(msgs),
    })


def _reset_conversation() -> None:
    for key, val in _CONV_DEFAULTS.items():
        if isinstance(val, dict):
            st.session_state[key] = dict(val)
        elif isinstance(val, list):
            st.session_state[key] = list(val)
        else:
            st.session_state[key] = val
    # Clear empty-state widget state so pills don't re-fire after New Chat
    for wkey in ("suggestion_pills", "initial_input"):
        st.session_state.pop(wkey, None)


def _restore_conversation(conv_id: str) -> None:
    conv = next((c for c in st.session_state.conversations if c["id"] == conv_id), None)
    if conv is None:
        return
    _reset_conversation()
    st.session_state.messages = list(conv["messages"])
    st.session_state.active_conv_id = conv_id
    st.session_state.stage = "results"
    last_plot = next(
        (m["plot_path"] for m in reversed(conv["messages"]) if m.get("plot_path")),
        None,
    )
    st.session_state.plot_path = last_plot


def _export_filename(ext: str) -> str:
    msgs = st.session_state.messages
    first_user = next((m["content"] for m in msgs if m["role"] == "user"), "chat")
    slug = first_user[:30].lower().replace(" ", "_").replace("/", "_")
    date = datetime.datetime.now().strftime("%Y%m%d")
    return f"epichat_{slug}_{date}.{ext}"


# ── Core conversation logic ───────────────────────────────────────────────────

def _lang() -> str:
    return st.session_state.get("user_language") or "English"


def _build_summary_with_description() -> str:
    s = st.session_state
    lang = _lang()
    try:
        description = generate_sim_description(s.params, s.data_sources, lang=lang)
    except Exception:
        description = ""
    from epichat.disease_db import detect_disease, check_params as _db_check
    _disease = detect_disease(s.context or "")
    _warnings = (
        _db_check(
            _disease, s.params.approx_r0(), s.params.dur_inf, s.params.dur_exp,
            p_death=s.params.p_death or None,
            n_contacts=s.params.n_contacts,
            dur_immune=s.params.dur_immune,
            p_asymp=s.params.p_asymp if s.params.disease_type == "seiar" else None,
        )
        if _disease else []
    )
    return build_summary(s.params, s.data_sources, description, lang=lang, param_warnings=_warnings)


def _do_parse() -> None:
    try:
        ctx = st.session_state.get("outbreak_context")
        st.session_state.params = parse_query(st.session_state.context, context=ctx)
        st.session_state.data_sources = get_last_resolved()
        if get_last_location_queried():
            st.session_state._location_recognized = True
    except Exception:
        pass


def _do_enrich(text: str) -> None:
    st.session_state.outbreak_context = enrich_input(text)


def _format_context_card(ctx) -> str:
    lines = ["**🔬 Extracted context (dev mode)**\n", "| Field | Value |", "|-------|-------|"]
    for k, v in ctx.model_dump().items():
        display_v = str(v) if v not in (None, []) else "*unknown*"
        lines.append(f"| {k} | {display_v} |")
    return "\n".join(lines)


def _do_run_simulation() -> None:
    s = st.session_state
    pop_field = next(
        (rf for rf in s.data_sources if rf.field == "total_population"), None
    )
    pop_scale = (
        pop_field.value / s.params.n_agents
        if pop_field and s.params.n_agents > 0
        else 1.0
    )
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    plot_path = str(Path("results") / f"sim_{ts}.png")

    exec_result = s.chat._execute_with_retry(
        s.context, s.params, plot_path, pop_scale=pop_scale
    )

    if exec_result["error"]:
        _add_msg(
            "assistant",
            f"The simulation encountered an error: {exec_result['error']}\n\n"
            "Would you like to adjust the parameters or try again?",
        )
        s.stage = "ready"
        return

    lang = _lang()
    narration = narrate(s.context, s.params, exec_result["stats"], lang=lang)
    stats = exec_result["stats"]
    n = stats.get("n_agents", 1)
    pct = stats.get("total_infected", 0) / n * 100 if n else 0

    # Narration text — already in the user's language
    summary = narration.get("summary", "")
    if narration.get("summary_continued"):
        summary += "\n\n" + narration["summary_continued"]
    findings = narration.get("key_findings", [])

    # UI template strings — translate if needed
    stats_text = (
        "✓ Simulation complete\n\n"
        f"**Peak infections:** {stats.get('peak_infections', 'N/A'):,} "
        f"(day {stats.get('peak_day', '?')})\n"
        f"**Total infected:** {stats.get('total_infected', 'N/A'):,} ({pct:.1f}%)\n"
        f"**Deaths:** {stats.get('total_deaths', 0):,}"
    )
    findings_label = "**Key findings:**"
    footer = "Would you like to try a variation, or start a new simulation?"
    if lang.lower() != "english":
        from epichat.language import translate
        # One call: batch all template strings separated by a marker translators preserve
        combined = stats_text + "{{SEP}}" + findings_label + "{{SEP}}" + footer
        parts = translate(combined, lang).split("{{SEP}}")
        stats_text = parts[0].strip()
        findings_label = parts[1].strip() if len(parts) > 1 else findings_label
        footer = parts[2].strip() if len(parts) > 2 else footer

    result_text = stats_text + "\n\n" + summary
    if findings:
        result_text += "\n\n" + findings_label + "\n" + "\n".join(f"· {f}" for f in findings)
    result_text += "\n\n---\n" + footer

    _add_msg("assistant", result_text, plot_path=exec_result["plot_path"])
    s.plot_path = exec_result["plot_path"]
    s.stage = "results"


def _handle_user_message(text: str) -> None:
    """Add user message immediately and queue processing for the next render cycle."""
    s = st.session_state
    if s.stage == "greeting":
        s.stage = "collecting"
    _add_msg("user", text)
    s.pending_input = text


def _thinking_text() -> str:
    """Return an appropriate status label for the current stage and pending input."""
    stage = st.session_state.stage
    text = st.session_state.pending_input or ""
    if stage == "collecting":
        return "Searching available data…"
    if stage in ("ready", "results"):
        if detect_new_scenario(text):
            return "Parsing new scenario…"
        return "Thinking…"
    return "Thinking…"


def _process_pending() -> None:
    """Execute the queued user input. Called from the render loop under a spinner."""
    s = st.session_state
    text = s.pending_input
    s.pending_input = None

    # One-time language detection per conversation (skipped for English)
    if s.user_language is None:
        s.user_language = detect_language(text)
    lang = _lang()

    if s.stage == "collecting":
        s.context = (s.context + " " + text).strip()
        if s.outbreak_context is None:
            _do_enrich(text)
            if DEV_MODE and s.outbreak_context is not None and s.outbreak_context.disease_name is not None:
                _add_msg("assistant", _format_context_card(s.outbreak_context))
        _do_parse()
        s.collected = update_collected(
            s.collected, s.params, s.data_sources, text,
            outbreak_context=s.outbreak_context,
        )
        # Accept location even when the UN WPP API failed — the LLM still recognised it
        if st.session_state.get("_location_recognized"):
            s.collected["location"] = True
            s.collected["population"] = True
            st.session_state._location_recognized = False
        if s.params is None:
            _add_msg(
                "assistant",
                "I had trouble understanding that. Could you rephrase? "
                "For example: 'Simulate HIV in Kenya'.",
            )
            return
        question = next_question(s.collected, s.params, s.data_sources, lang=lang)
        if question is None:
            _add_msg("assistant", _build_summary_with_description())
            s.stage = "ready"
        else:
            _add_msg("assistant", question)

    elif s.stage == "ready":
        if detect_new_scenario(text):
            _start_new_scenario(text)
        elif detect_run_intent(text):
            s.stage = "running"
        else:
            _apply_modification_and_summarize(text)

    elif s.stage == "results":
        if "new simulation" in text.lower() or "new chat" in text.lower():
            _save_current_conversation()
            _reset_conversation()
        elif detect_new_scenario(text):
            _start_new_scenario(text)
        else:
            _apply_modification_and_summarize(text)
            s.stage = "ready"


def _start_new_scenario(text: str) -> None:
    s = st.session_state
    s.context = text
    s.params = None
    s.collected = {k: False for k in s.collected}
    s.outbreak_context = None
    _do_enrich(text)
    if DEV_MODE and s.outbreak_context is not None and s.outbreak_context.disease_name is not None:
        _add_msg("assistant", _format_context_card(s.outbreak_context))
    _do_parse()
    s.collected = update_collected(
        s.collected, s.params, s.data_sources, text,
        outbreak_context=s.outbreak_context,
    )
    # Accept location even when the UN WPP API failed — the LLM still recognised it
    if st.session_state.get("_location_recognized"):
        s.collected["location"] = True
        s.collected["population"] = True
        st.session_state._location_recognized = False
    question = next_question(s.collected, s.params, s.data_sources, lang=_lang())
    if question is None:
        _add_msg("assistant", _build_summary_with_description())
        s.stage = "ready"
    else:
        _add_msg("assistant", question)
        s.stage = "collecting"


def _apply_modification_and_summarize(text: str) -> None:
    s = st.session_state
    if s.params is None:
        _add_msg("assistant", "I don't have parameters yet. Please describe what you'd like to simulate.")
        return

    # Check if the user is correcting the location before treating as a param modification
    current_location = s.outbreak_context.location if s.outbreak_context else None
    new_location = detect_location_correction(text, current_location)
    if new_location is not None:
        s.context = (s.context + " " + text).strip()
        if s.outbreak_context is not None:
            s.outbreak_context = s.outbreak_context.model_copy(update={"location": new_location})
        _do_parse()
        if st.session_state.get("_location_recognized"):
            s.collected["location"] = True
            s.collected["population"] = True
            st.session_state._location_recognized = False
        s.collected = update_collected(
            s.collected, s.params, s.data_sources, text,
            outbreak_context=s.outbreak_context,
        )
        _add_msg(
            "assistant",
            "Updated. Here's the revised summary:\n\n" + _build_summary_with_description(),
        )
        return

    try:
        r0_before = s.params.approx_r0()
        params_before = s.params
        s.params = apply_modification(s.params, text)
        from epichat.parser import recalibrate_beta
        s.params = recalibrate_beta(s.params, r0_before, params_before)
    except Exception as e:
        _add_msg("assistant", f"I couldn't apply that modification: {e}. Please try again.")
        return
    s.context = (s.context + " " + text).strip()
    _add_msg(
        "assistant",
        "Updated. Here's the revised summary:\n\n" + _build_summary_with_description(),
    )


# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    # The mark already sits directly above this via st.logo — wordmark only here.
    st.markdown(
        "<h2 style='font-size:2rem;margin:0;padding:4px 0;line-height:1.2'>EpiChat</h2>"
        "<p style='font-size:1rem;color:white;margin:6px 0 0 0;line-height:1.4'>"
        "Ask an epidemiological question. Get a validated simulation.</p>"
        "<p style='font-size:0.75rem;color:rgba(255,255,255,0.5);margin:4px 0 0 0'>v0.3</p>",
        unsafe_allow_html=True,
    )
    st.divider()

    if st.button("+ New Chat", use_container_width=True, type="primary"):
        _save_current_conversation()
        _reset_conversation()
        st.rerun()

    if st.session_state.conversations:
        st.divider()
        st.caption("RECENT")
        for conv in reversed(st.session_state.conversations):
            title = conv["title"][:50] + ("…" if len(conv["title"]) > 50 else "")
            if st.button(title, key=f"conv_{conv['id']}", use_container_width=True):
                _save_current_conversation()
                _restore_conversation(conv["id"])
                st.rerun()

    if st.session_state.plot_path:
        st.divider()
        st.caption("Export conversation")
        msgs = st.session_state.messages
        _cache_key = (st.session_state.plot_path, len(msgs))
        if st.session_state.get("_export_cache_key") != _cache_key:
            st.session_state["_export_pdf"] = to_pdf(msgs, st.session_state.plot_path)
            st.session_state["_export_docx"] = to_docx(msgs, st.session_state.plot_path)
            st.session_state["_export_cache_key"] = _cache_key
        st.download_button(
            "↓ Download PDF",
            data=st.session_state["_export_pdf"],
            file_name=_export_filename("pdf"),
            mime="application/pdf",
            use_container_width=True,
        )
        st.download_button(
            "↓ Download Word",
            data=st.session_state["_export_docx"],
            file_name=_export_filename("docx"),
            mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            use_container_width=True,
        )


# ── Main area ─────────────────────────────────────────────────────────────────
_TYPEWRITER_PHRASES = [
    "What would you like to simulate today?",
    "¿Qué le gustaría simular hoy?",
    "Que souhaitez-vous simuler aujourd'hui?",
    "O que gostaria de simular hoje?",
    "今天您想模拟什么？",
    "ماذا تريد أن تحاكي اليوم؟",
    "Was möchten Sie heute simulieren?",
    "आज आप क्या सिमुलेट करना चाहेंगे?",
    "今日は何をシミュレートしますか？",
    "Unataka kuiga nini leo?",
]

_TYPEWRITER_HTML = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  html, body {{ background:transparent; height:56px; overflow:hidden; }}
  #tw {{
    font-family: "Source Sans Pro", "Helvetica Neue", Arial, sans-serif;
    font-size: 1.5rem;
    font-weight: 400;
    color: white;
    text-align: center;
    line-height: 56px;
    height: 56px;
    white-space: nowrap;
  }}
  #cursor {{
    display: inline-block;
    width: 2px;
    height: 1.15em;
    background: white;
    vertical-align: middle;
    margin-left: 1px;
    animation: blink 0.65s step-end infinite;
  }}
  @keyframes blink {{ 0%,100%{{opacity:1}} 50%{{opacity:0}} }}
</style>
</head>
<body>
<div id="tw"><span id="text"></span><span id="cursor"></span></div>
<script>
const phrases = {phrases_json};
let pi = 0, ci = 0, deleting = false;
const textEl = document.getElementById("text");
function tick() {{
  const p = phrases[pi];
  if (!deleting) {{
    ci++;
    textEl.textContent = p.slice(0, ci);
    if (ci === p.length) {{ deleting = true; setTimeout(tick, 2400); return; }}
    setTimeout(tick, 65);
  }} else {{
    ci--;
    textEl.textContent = p.slice(0, ci);
    if (ci === 0) {{
      deleting = false;
      pi = (pi + 1) % phrases.length;
      setTimeout(tick, 450);
      return;
    }}
    setTimeout(tick, 32);
  }}
}}
setTimeout(tick, 900);
</script>
</body>
</html>"""

_SUGGESTIONS = [
    "Simulate a generic SIR epidemic",
    "COVID-19 endemic with waning immunity",
    "Measles with 80% vaccination coverage",
    "Ebola outbreak in DRC",
    "Search for the latest Mpox outbreak news",
]

messages = st.session_state.messages

if not messages:
    # ── Empty state: inline input + suggestion pills ──────────────────────────
    import json as _json
    st.markdown(
        "<div style='text-align:center;padding-top:7vh'>"
        f"<img src='{_data_uri(_LOGO)}' alt='EpiChat' "
        "style='width:132px;height:132px;object-fit:contain;margin-bottom:0.4rem'>"
        "<h1 style='font-size:3rem;margin:0'>EpiChat</h1>"
        "</div>",
        unsafe_allow_html=True,
    )
    st.components.v1.html(
        _TYPEWRITER_HTML.format(phrases_json=_json.dumps(_TYPEWRITER_PHRASES)),
        height=56,
    )
    st.markdown(
        "<p style='color:#aac4e0;font-size:1rem;margin:-8px 0 2rem 0;text-align:center'>"
        "Describe a disease &nbsp;·&nbsp; paste an epidemiological report "
        "&nbsp;·&nbsp; share a URL &nbsp;·&nbsp; ask me to search for outbreak news"
        "</p>",
        unsafe_allow_html=True,
    )
    with st.container():
        initial_prompt = st.chat_input("Type your message…", key="initial_input")
        selected = st.pills(
            label="Suggestions",
            label_visibility="collapsed",
            options=_SUGGESTIONS,
            key="suggestion_pills",
        )
    if initial_prompt:
        _handle_user_message(initial_prompt)
        st.rerun()
    if selected:
        _handle_user_message(selected)
        st.rerun()
    st.stop()

# ── Active state: chat thread + fixed input at bottom ────────────────────────
for msg in messages:
    avatar = str(_ICON) if msg["role"] == "assistant" else None
    with st.chat_message(msg["role"], avatar=avatar):
        st.markdown(msg["content"])
        if msg.get("plot_path") and Path(msg["plot_path"]).exists():
            st.image(msg["plot_path"], use_container_width=True)

# Show thinking indicator and process queued input
if st.session_state.pending_input:
    with st.chat_message("assistant", avatar=str(_ICON)):
        with st.spinner(_thinking_text()):
            _process_pending()
    st.rerun()

if st.session_state.stage == "running":
    with st.chat_message("assistant", avatar=str(_ICON)):
        st.markdown("Running simulation…")
    with st.spinner("Running simulation…"):
        _do_run_simulation()
    st.rerun()

if prompt := st.chat_input("Type your message…"):
    _handle_user_message(prompt)
    st.rerun()
