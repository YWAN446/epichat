"""EpiChat — conversational epidemiological simulation assistant."""

from __future__ import annotations

import datetime
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
from epichat.parser import get_last_resolved, get_last_location_queried, parse_query

st.set_page_config(page_title="EpiChat", page_icon="🦠", layout="wide")

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

def _build_summary_with_description() -> str:
    s = st.session_state
    try:
        description = generate_sim_description(s.params, s.data_sources)
    except Exception:
        description = ""
    return build_summary(s.params, s.data_sources, description)


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
    try:
        st.session_state.outbreak_context = enrich_input(text)
    except Exception:
        st.session_state.outbreak_context = None


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

    narration = narrate(s.context, s.params, exec_result["stats"])
    stats = exec_result["stats"]
    n = stats.get("n_agents", 1)
    pct = stats.get("total_infected", 0) / n * 100 if n else 0

    result_text = (
        "✓ Simulation complete\n\n"
        f"**Peak infections:** {stats.get('peak_infections', 'N/A'):,} "
        f"(day {stats.get('peak_day', '?')})\n"
        f"**Total infected:** {stats.get('total_infected', 'N/A'):,} ({pct:.1f}%)\n"
        f"**Deaths:** {stats.get('total_deaths', 0):,}\n\n"
        f"{narration.get('summary', '')}"
    )
    findings = narration.get("key_findings", [])
    if findings:
        result_text += "\n\n**Key findings:**\n" + "\n".join(f"· {f}" for f in findings)
    result_text += "\n\n---\nWould you like to try a variation, or start a new simulation?"

    _add_msg("assistant", result_text, plot_path=exec_result["plot_path"])
    s.plot_path = exec_result["plot_path"]
    s.stage = "results"


def _handle_user_message(text: str) -> None:
    """Add user message immediately and queue processing for the next render cycle."""
    s = st.session_state
    if s.stage == "greeting":
        if not s.messages:
            _add_msg(
                "assistant",
                "What would you like to simulate today? You can describe a disease, "
                "a location, a population size, and any interventions — or just start "
                "with what you know.",
            )
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
        if detect_run_intent(text):
            return "Preparing simulation…"
        if detect_new_scenario(text):
            return "Parsing new scenario…"
        return "Updating parameters…"
    return "Thinking…"


def _process_pending() -> None:
    """Execute the queued user input. Called from the render loop under a spinner."""
    s = st.session_state
    text = s.pending_input
    s.pending_input = None

    if s.stage == "collecting":
        s.context = (s.context + " " + text).strip()
        if s.outbreak_context is None:
            _do_enrich(text)
            if DEV_MODE and s.outbreak_context is not None:
                _add_msg("assistant", _format_context_card(s.outbreak_context))
        _do_parse()
        s.collected = update_collected(
            s.collected, s.params, s.data_sources, text,
            outbreak_context=s.outbreak_context,
        )
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
        question = next_question(s.collected, s.params, s.data_sources)
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
    if DEV_MODE and s.outbreak_context is not None:
        _add_msg("assistant", _format_context_card(s.outbreak_context))
    _do_parse()
    s.collected = update_collected(
        s.collected, s.params, s.data_sources, text,
        outbreak_context=s.outbreak_context,
    )
    if st.session_state.get("_location_recognized"):
        s.collected["location"] = True
        s.collected["population"] = True
        st.session_state._location_recognized = False
    question = next_question(s.collected, s.params, s.data_sources)
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
    try:
        s.params = apply_modification(s.params, text)
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
    st.markdown(
        "<h2 style='font-size:2rem;margin:0;padding:4px 0;line-height:1.2'>🦠 EpiChat</h2>"
        "<p style='font-size:1rem;color:white;margin:6px 0 0 0;line-height:1.4'>"
        "Ask an epidemiological question. Get a validated simulation.</p>",
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
        if st.session_state.get("_export_cache_key") != st.session_state.plot_path:
            msgs = st.session_state.messages
            st.session_state["_export_pdf"] = to_pdf(msgs, st.session_state.plot_path)
            st.session_state["_export_docx"] = to_docx(msgs, st.session_state.plot_path)
            st.session_state["_export_cache_key"] = st.session_state.plot_path
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
_SUGGESTIONS = [
    "Simulate a generic SIR epidemic",
    "COVID-19 endemic with waning immunity",
    "Influenza outbreak",
    "Measles with 80% vaccination coverage",
    "Ebola outbreak",
]

messages = st.session_state.messages

if not messages:
    # ── Empty state: inline input + suggestion pills ──────────────────────────
    st.markdown(
        "<div style='text-align:center;padding-top:15vh'>"
        "<h1 style='font-size:3rem'>🦠 EpiChat</h1>"
        "<p style='color:white;font-size:1.5rem;margin:0 0 2rem 0'>"
        "What would you like to simulate today?"
        "</p></div>",
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
    avatar = "🦠" if msg["role"] == "assistant" else None
    with st.chat_message(msg["role"], avatar=avatar):
        st.markdown(msg["content"])
        if msg.get("plot_path") and Path(msg["plot_path"]).exists():
            st.image(msg["plot_path"], use_container_width=True)

# Show thinking indicator and process queued input
if st.session_state.pending_input:
    with st.chat_message("assistant", avatar="🦠"):
        with st.spinner(_thinking_text()):
            _process_pending()
    st.rerun()

if st.session_state.stage == "running":
    with st.chat_message("assistant", avatar="🦠"):
        st.markdown("Running simulation…")
    with st.spinner("Running simulation…"):
        _do_run_simulation()
    st.rerun()

if prompt := st.chat_input("Type your message…"):
    _handle_user_message(prompt)
    st.rerun()
