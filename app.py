"""EpiChat — conversational epidemiological simulation assistant."""

from __future__ import annotations

import datetime
import uuid
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

load_dotenv()

from epichat.chat_controller import (
    build_summary,
    detect_new_scenario,
    detect_run_intent,
    next_question,
    update_collected,
)
from epichat.epichat import EpiChat
from epichat.exporter import to_docx, to_pdf
from epichat.modifier import apply_modification
from epichat.narrator import narrate
from epichat.parser import get_last_resolved, parse_query

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


def _restore_conversation(conv_id: str) -> None:
    conv = next((c for c in st.session_state.conversations if c["id"] == conv_id), None)
    if conv is None:
        return
    _reset_conversation()
    st.session_state.messages = list(conv["messages"])
    st.session_state.stage = "results"


def _export_filename(ext: str) -> str:
    msgs = st.session_state.messages
    first_user = next((m["content"] for m in msgs if m["role"] == "user"), "chat")
    slug = first_user[:30].lower().replace(" ", "_").replace("/", "_")
    date = datetime.datetime.now().strftime("%Y%m%d")
    return f"epichat_{slug}_{date}.{ext}"


# ── Core conversation logic ───────────────────────────────────────────────────

def _do_parse() -> None:
    try:
        st.session_state.params = parse_query(st.session_state.context)
        st.session_state.data_sources = get_last_resolved()
    except Exception:
        pass


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

    if s.stage == "collecting":
        s.context = (s.context + " " + text).strip()
        _do_parse()
        s.collected = update_collected(s.collected, s.params, s.data_sources, text)
        if s.params is None:
            _add_msg(
                "assistant",
                "I had trouble understanding that. Could you rephrase? "
                "For example: 'Simulate HIV in Kenya'.",
            )
            return
        question = next_question(s.collected, s.params, s.data_sources)
        if question is None:
            _add_msg("assistant", build_summary(s.params, s.data_sources))
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
    _do_parse()
    s.collected = update_collected(s.collected, s.params, s.data_sources, text)
    question = next_question(s.collected, s.params, s.data_sources)
    if question is None:
        _add_msg("assistant", build_summary(s.params, s.data_sources))
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
    _add_msg(
        "assistant",
        "Updated. Here's the revised summary:\n\n" + build_summary(s.params, s.data_sources),
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
    "Simulate HIV in Kenya",
    "Model measles, 80% vaccinated",
    "COVID with seasonality",
    "Ebola outbreak, R0=2",
    "TB in South Africa",
    "Malaria in Nigeria with 50% treatment",
]

messages = st.session_state.messages

if not messages:
    st.markdown(
        "<div style='text-align:center;padding-top:15vh'>"
        "<h1 style='font-size:3rem'>🦠 EpiChat</h1>"
        "<p style='color:white;font-size:1.5rem;margin:0'>"
        "What would you like to simulate today?"
        "</p></div>",
        unsafe_allow_html=True,
    )
else:
    for msg in messages:
        avatar = "🦠" if msg["role"] == "assistant" else None
        with st.chat_message(msg["role"], avatar=avatar):
            st.markdown(msg["content"])
            if msg.get("plot_path") and Path(msg["plot_path"]).exists():
                st.image(msg["plot_path"], use_container_width=True)

    if st.session_state.stage == "running":
        with st.chat_message("assistant", avatar="🦠"):
            st.markdown("Running simulation…")
        with st.spinner("Running simulation…"):
            _do_run_simulation()
        st.rerun()

# ── Chat input (always visible) ───────────────────────────────────────────────
if prompt := st.chat_input("Type your message…"):
    _handle_user_message(prompt)
    st.rerun()

# ── Suggestion chips (empty state only, just above chat input bar) ────────────
if not messages:
    st.markdown(
        "<div style='height:calc(100vh - 350px)'></div>",
        unsafe_allow_html=True,
    )
    cols = st.columns(len(_SUGGESTIONS))
    for i, suggestion in enumerate(_SUGGESTIONS):
        if cols[i].button(suggestion, use_container_width=True):
            _handle_user_message(suggestion)
            st.rerun()
