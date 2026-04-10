"""EpiChat Streamlit web interface."""

import os
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

load_dotenv()

from epichat.epichat import EpiChat, EpiChatResult

st.set_page_config(
    page_title="EpiChat",
    page_icon="🦠",
    layout="wide",
)

# ── Session state ──────────────────────────────────────────────────────────────
if "history" not in st.session_state:
    st.session_state.history: list[EpiChatResult] = []

# ── Sidebar ────────────────────────────────────────────────────────────────────
with st.sidebar:
    st.title("🦠 EpiChat")
    st.caption("Natural language → Starsim simulation")
    st.divider()

    api_key = st.text_input(
        "Anthropic API key",
        type="password",
        value=os.environ.get("ANTHROPIC_API_KEY", ""),
        help="Your Anthropic API key (stored in session only)",
    )
    if api_key:
        os.environ["ANTHROPIC_API_KEY"] = api_key

    st.divider()
    st.subheader("Example queries")
    examples = [
        "Run a default SIR model",
        "Simulate COVID spread in 50,000 people with R0=2.5 over 2 years",
        "Model measles in 100K people, 80% vaccinated, R0=15",
        "SEIR epidemic with 5-day latent period and R0=3 in 20,000 people",
    ]
    for ex in examples:
        if st.button(ex, use_container_width=True):
            st.session_state["prefill"] = ex

    st.divider()
    if st.session_state.history:
        st.subheader("Recent queries")
        for i, h in enumerate(reversed(st.session_state.history[-5:])):
            st.caption(f"{i+1}. {h.user_input[:60]}{'…' if len(h.user_input) > 60 else ''}")

# ── Main area ──────────────────────────────────────────────────────────────────
st.title("EpiChat — Epidemiological Simulation Assistant")
st.markdown(
    "Describe an epidemic scenario in plain English and EpiChat will run a "
    "[Starsim](https://starsim.org) simulation and explain the results."
)

prefill = st.session_state.pop("prefill", "")
query = st.text_area(
    "Your query",
    value=prefill,
    height=80,
    placeholder="e.g. Simulate measles in a city of 100,000 with 70% vaccination coverage",
)

col1, col2 = st.columns([1, 5])
run_clicked = col1.button("▶ Run Simulation", type="primary", use_container_width=True)
col2.markdown("")  # spacer

if run_clicked:
    if not query.strip():
        st.warning("Please enter a query.")
    elif not os.environ.get("ANTHROPIC_API_KEY"):
        st.error("Please enter your Anthropic API key in the sidebar.")
    else:
        with st.spinner("Running simulation…"):
            chat = EpiChat(output_dir="results")
            result = chat.run(query.strip())
            st.session_state.history.append(result)

        if result.error:
            st.error(f"**Error:** {result.error}")
        else:
            # ── Results ────────────────────────────────────────────────────────
            st.success("Simulation complete!")

            col_plot, col_text = st.columns([1, 1])

            with col_plot:
                st.subheader("Epidemic curve")
                if result.plot_path and Path(result.plot_path).exists():
                    st.image(result.plot_path, use_column_width=True)
                else:
                    st.info("Plot not available.")

            with col_text:
                st.subheader("Results summary")
                s = result.stats
                n = s.get("n_agents", 1)
                pct = s.get("total_infected", 0) / n * 100 if n else 0

                mcol1, mcol2, mcol3 = st.columns(3)
                mcol1.metric("Peak infections", f"{s.get('peak_infections', '?'):,}", f"day {s.get('peak_day', '?')}")
                mcol2.metric("Total infected", f"{s.get('total_infected', '?'):,}", f"{pct:.1f}%")
                mcol3.metric("Deaths", f"{s.get('total_deaths', 0):,}")

                st.markdown("---")
                st.markdown(result.narration.get("summary", ""))

                findings = result.narration.get("key_findings", [])
                if findings:
                    st.markdown("**Key findings:**")
                    for f in findings:
                        st.markdown(f"- {f}")

            with st.expander("Model details"):
                p = result.params
                st.json({
                    "disease_type": p.disease_type,
                    "n_agents": p.n_agents,
                    "beta": p.beta,
                    "approx_R0": round(p.approx_r0(), 2),
                    "init_prev": p.init_prev,
                    "dur_inf_days": p.dur_inf,
                    "dur_exp_days": p.dur_exp,
                    "p_death": p.p_death,
                    "sim_dur_years": p.sim_dur_years,
                    "interventions": [i.model_dump() for i in p.interventions],
                })
