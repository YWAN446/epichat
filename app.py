"""EpiChat Streamlit web interface — two-step: Parse → Review/Edit → Run."""

import os
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

load_dotenv()

from epichat.epichat import EpiChat, EpiChatResult
from epichat.parser import parse_query
from epichat.schema import Intervention, SimParams

st.set_page_config(
    page_title="EpiChat",
    page_icon="🦠",
    layout="wide",
)

# ── Session state ──────────────────────────────────────────────────────────────
for key, default in [
    ("step", "input"),          # "input" | "review" | "results"
    ("parsed_params", None),    # SimParams after LLM parsing
    ("last_result", None),      # EpiChatResult after running
    ("history", []),
    ("last_query", ""),
]:
    if key not in st.session_state:
        st.session_state[key] = default


def _init_review_state(p: SimParams) -> None:
    """Copy parsed SimParams into individual session-state keys for the review form."""
    vax = p.get_vaccine()
    seas = p.get_seasonality()
    treat = p.get_treatment()
    st.session_state.update({
        "f_disease_type":   p.disease_type,
        "f_n_agents":       p.n_agents,
        "f_n_contacts":     p.n_contacts,
        "f_network_type":   p.network_type,
        "f_network_beta":   float(p.network_beta),
        "f_beta":           float(p.beta),
        "f_init_prev":      float(p.init_prev),
        "f_dur_inf":        float(p.dur_inf),
        "f_dur_exp":        float(p.dur_exp) if p.dur_exp else 5.0,
        "f_dur_immune":     float(p.dur_immune) if p.dur_immune else 180.0,
        "f_p_asymp":        float(p.p_asymp),
        "f_rel_trans_asymp":float(p.rel_trans_asymp),
        "f_p_death":        float(p.p_death),
        "f_sim_dur_years":  float(p.sim_dur_years),
        "f_rand_seed_str":  str(p.rand_seed) if p.rand_seed is not None else "",
        # vaccine
        "f_has_vaccine":    vax is not None,
        "f_vax_coverage":   float(vax.coverage) if vax else 0.7,
        "f_vax_start_day":  int(vax.start_day) if vax else 0,
        # seasonality
        "f_has_seasonality": seas is not None,
        "f_seas_scale":     float(seas.scale) if seas else 0.2,
        "f_seas_shift":     float(seas.shift) if seas else 0.0,
        # treatment
        "f_has_treatment":  treat is not None,
        "f_treat_coverage": float(treat.coverage) if (treat and treat.coverage) else 0.5,
        "f_treat_capacity_str": str(treat.capacity) if (treat and treat.capacity) else "",
        # demographics
        "f_use_demographics": p.use_demographics,
        "f_birth_rate":     float(p.birth_rate),
        "f_death_rate":     float(p.death_rate),
    })


def _build_params_from_form() -> SimParams:
    """Construct SimParams from the current review form session-state values."""
    s = st.session_state
    interventions = []
    if s.f_has_vaccine:
        interventions.append(Intervention(
            type="vaccine",
            coverage=s.f_vax_coverage,
            start_day=s.f_vax_start_day,
        ))
    if s.f_has_seasonality:
        interventions.append(Intervention(
            type="seasonality",
            scale=s.f_seas_scale,
            shift=s.f_seas_shift,
        ))
    if s.f_has_treatment:
        cap_str = s.f_treat_capacity_str.strip()
        cap = int(cap_str) if cap_str.isdigit() else None
        interventions.append(Intervention(
            type="treatment",
            coverage=s.f_treat_coverage,
            capacity=cap,
        ))
    seed_str = s.f_rand_seed_str.strip()
    rand_seed = int(seed_str) if seed_str.isdigit() else None
    dt = s.f_disease_type
    dur_exp    = float(s.f_dur_exp)    if dt in ("seir", "seiar") else None
    dur_immune = float(s.f_dur_immune) if dt == "sirs"            else None
    return SimParams(
        disease_type=dt,
        n_agents=int(s.f_n_agents),
        n_contacts=int(s.f_n_contacts),
        network_type=s.f_network_type,
        network_beta=float(s.f_network_beta),
        beta=float(s.f_beta),
        init_prev=float(s.f_init_prev),
        dur_inf=float(s.f_dur_inf),
        dur_exp=dur_exp,
        dur_immune=dur_immune,
        p_asymp=float(s.f_p_asymp),
        rel_trans_asymp=float(s.f_rel_trans_asymp),
        p_death=float(s.f_p_death),
        sim_dur_years=float(s.f_sim_dur_years),
        interventions=interventions,
        rand_seed=rand_seed,
        use_demographics=bool(s.f_use_demographics),
        birth_rate=float(s.f_birth_rate),
        death_rate=float(s.f_death_rate),
    )


# ── Sidebar ────────────────────────────────────────────────────────────────────
with st.sidebar:
    st.title("🦠 EpiChat")
    st.caption("Natural language → Starsim simulation")
    st.divider()

    st.subheader("Example queries")
    examples = [
        "Run a default SIR model",
        "Simulate COVID spread in 50,000 people with R0=2.5 over 2 years",
        "Model measles in 100K people, 80% vaccinated, R0=15",
        "SEIR epidemic with 5-day latent period and R0=3 in 20,000 people",
        "Influenza with seasonal transmission in 30,000 people over 3 years",
    ]
    for ex in examples:
        if st.button(ex, use_container_width=True):
            st.session_state["prefill"] = ex
            st.session_state.step = "input"

    st.divider()
    if st.session_state.history:
        st.subheader("Recent queries")
        for i, h in enumerate(reversed(st.session_state.history[-5:])):
            st.caption(f"{i+1}. {h.user_input[:60]}{'…' if len(h.user_input) > 60 else ''}")


# ── Step routing ───────────────────────────────────────────────────────────────
step = st.session_state.step

# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — Input
# ══════════════════════════════════════════════════════════════════════════════
if step == "input":
    st.title("EpiChat — Epidemiological Simulation Assistant")
    st.markdown(
        "Describe an epidemic scenario in plain English. "
        "EpiChat will extract the parameters, let you review and edit them, "
        "then run the [Starsim](https://starsim.org) simulation."
    )

    prefill = st.session_state.pop("prefill", "")
    if prefill:
        st.session_state["query_input"] = prefill

    query = st.text_area(
        "Your query",
        key="query_input",
        height=80,
        placeholder="e.g. Simulate measles in a city of 100,000 with 70% vaccination coverage",
    )

    if st.button("Extract Parameters", type="primary"):
        if not query.strip():
            st.warning("Please enter a query.")
        else:
            with st.spinner("Parsing query with LLM…"):
                try:
                    params = parse_query(query.strip())
                    st.session_state.parsed_params = params
                    st.session_state.last_query = query.strip()
                    _init_review_state(params)
                    st.session_state.step = "review"
                    st.rerun()
                except ValueError as e:
                    st.error(f"**Parse error:** {e}")


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — Review & Edit Parameters
# ══════════════════════════════════════════════════════════════════════════════
elif step == "review":
    st.title("Review & Edit Parameters")
    st.caption(f'Query: *"{st.session_state.last_query}"*')
    st.markdown("The LLM extracted the parameters below. Edit any value, then click **Run Simulation**.")
    st.divider()

    s = st.session_state

    # ── Disease model ──────────────────────────────────────────────────────────
    st.subheader("Disease Model")
    c1, c2, c3 = st.columns(3)
    s.f_disease_type = c1.selectbox(
        "Disease type",
        ["sir", "seir", "sis", "sirs", "seiar"],
        index=["sir", "seir", "sis", "sirs", "seiar"].index(s.f_disease_type),
        help="SIR: permanent immunity | SEIR: + latent period | SIS: no immunity | "
             "SIRS: waning immunity | SEIAR: + asymptomatic track",
    )
    s.f_n_agents = c2.number_input("Population size", min_value=10, max_value=1_000_000,
                                    value=s.f_n_agents, step=1000)
    s.f_init_prev = c3.number_input("Initial prevalence", min_value=0.0001, max_value=0.5,
                                     value=s.f_init_prev, format="%.4f")

    c4, c5, c6 = st.columns(3)
    s.f_p_death = c4.number_input("Infection fatality rate", min_value=0.0, max_value=1.0,
                                   value=s.f_p_death, format="%.4f")
    s.f_dur_inf = c5.number_input("Infectious period (days)", min_value=1.0, max_value=365.0,
                                   value=s.f_dur_inf)
    if s.f_disease_type in ("seir", "seiar"):
        s.f_dur_exp = c6.number_input("Latent period (days)", min_value=1.0, max_value=365.0,
                                       value=s.f_dur_exp)
    elif s.f_disease_type == "sirs":
        s.f_dur_immune = c6.number_input("Immunity duration (days)", min_value=1.0, max_value=3650.0,
                                          value=s.f_dur_immune,
                                          help="Days before recovered agents become susceptible again")
    else:
        c6.markdown("")

    if s.f_disease_type == "seiar":
        a1, a2 = st.columns(2)
        s.f_p_asymp = a1.slider(
            "Fraction asymptomatic", 0.0, 1.0, value=s.f_p_asymp, step=0.05,
            help="Proportion of infections that are asymptomatic (e.g. 0.4 for COVID-19)")
        s.f_rel_trans_asymp = a2.slider(
            "Asymptomatic relative transmissibility", 0.0, 1.0, value=s.f_rel_trans_asymp, step=0.05,
            help="Transmissibility of asymptomatic cases relative to symptomatic (e.g. 0.5 = half as infectious)")

    # ── Network ───────────────────────────────────────────────────────────────
    st.subheader("Network")
    _net_options = ["random", "age_structured"]
    _net_labels  = ["Random (Erdős–Rényi)", "Age-structured (POLYMOD)"]
    n1, n2, n3 = st.columns(3)
    _net_idx = _net_options.index(s.get("f_network_type", "random"))
    _net_sel = n1.selectbox(
        "Network type", _net_labels, index=_net_idx,
        help="Random: every agent contacts n random others each day.\n"
             "Age-structured: POLYMOD contact matrix — children/adults/elderly mix at realistic rates.")
    s.f_network_type = _net_options[_net_labels.index(_net_sel)]

    if s.f_network_type == "random":
        s.f_n_contacts = n2.number_input(
            "Avg contacts per person/day", min_value=1, max_value=100, value=s.f_n_contacts,
            help="Typical values: household-only ≈ 3–5, community ≈ 8–15, high-contact ≈ 15–30")
    else:
        n2.info("Contact rates from POLYMOD matrix:\n"
                "children↔children: 7/day · adults↔adults: 9/day · elderly↔elderly: 3.5/day")

    s.f_network_beta = n3.number_input(
        "Transmission multiplier", min_value=0.01, max_value=10.0,
        value=s.f_network_beta, format="%.2f",
        help="Scales all contact-level transmission. 1.0 = default. "
             "0.5 = 50% reduction (e.g. masks + distancing).")

    # ── Transmission ──────────────────────────────────────────────────────────
    st.subheader("Transmission")
    t1, t2, t3 = st.columns(3)
    s.f_beta = t1.number_input("Beta (per-year rate)", min_value=0.001, max_value=1000.0,
                                value=s.f_beta, format="%.4f",
                                help="Per-year transmission rate. Derived from R0 via: beta = R0 × 365 / (n_contacts × dur_inf_days)")
    approx_r0 = s.f_beta * s.f_network_beta * (s.f_dur_inf / 365.0) * s.f_n_contacts
    t2.metric("Effective R0", f"{approx_r0:.2f}",
              help="R0 = beta × network_multiplier × (dur_inf/365) × n_contacts")
    t3.markdown("")

    # ── Simulation settings ───────────────────────────────────────────────────
    st.subheader("Simulation Settings")
    s1, s2, s3 = st.columns(3)
    s.f_sim_dur_years = s1.number_input("Duration (years)", min_value=0.1, max_value=20.0,
                                         value=s.f_sim_dur_years)
    s.f_rand_seed_str = s2.text_input("Random seed (blank = random)", value=s.f_rand_seed_str,
                                       placeholder="e.g. 42")
    s3.markdown("")

    # ── Interventions ─────────────────────────────────────────────────────────
    st.subheader("Interventions")
    iv1, iv2, iv3 = st.columns(3)

    with iv1:
        s.f_has_vaccine = st.checkbox("Vaccination", value=s.f_has_vaccine)
        if s.f_has_vaccine:
            s.f_vax_coverage = st.slider("Coverage", 0.0, 1.0, value=s.f_vax_coverage, step=0.01)
            s.f_vax_start_day = st.number_input("Start day (0 = pre-existing)", min_value=0,
                                                  value=s.f_vax_start_day)

    with iv2:
        s.f_has_seasonality = st.checkbox("Seasonality", value=s.f_has_seasonality)
        if s.f_has_seasonality:
            s.f_seas_scale = st.slider("Strength (±%)", 0.0, 1.0, value=s.f_seas_scale, step=0.05)
            s.f_seas_shift = st.slider("Phase shift (0=Jan peak, 0.5=Jul peak)", 0.0, 1.0,
                                        value=s.f_seas_shift, step=0.05)

    with iv3:
        s.f_has_treatment = st.checkbox("Treatment", value=s.f_has_treatment)
        if s.f_has_treatment:
            s.f_treat_coverage = st.slider("Uptake probability", 0.0, 1.0,
                                            value=s.f_treat_coverage, step=0.01)
            s.f_treat_capacity_str = st.text_input("Max capacity/day (blank = unlimited)",
                                                    value=s.f_treat_capacity_str)

    # ── Demographics (optional) ───────────────────────────────────────────────
    with st.expander("Demographics (births & deaths)"):
        s.f_use_demographics = st.checkbox("Enable demographics", value=s.f_use_demographics)
        if s.f_use_demographics:
            d1, d2 = st.columns(2)
            s.f_birth_rate = d1.number_input("Birth rate (per 1000/year)", min_value=0.1,
                                              max_value=100.0, value=s.f_birth_rate)
            s.f_death_rate = d2.number_input("Death rate (per 1000/year)", min_value=0.1,
                                              max_value=100.0, value=s.f_death_rate)

    st.divider()
    col_back, col_run, _ = st.columns([1, 1, 4])
    if col_back.button("← Modify Query"):
        st.session_state.step = "input"
        st.rerun()

    if col_run.button("▶ Run Simulation", type="primary"):
        try:
            final_params = _build_params_from_form()
        except Exception as e:
            st.error(f"Parameter error: {e}")
            st.stop()

        with st.spinner("Running Starsim simulation…"):
            chat = EpiChat(output_dir="results")
            # Use the reviewed params directly (skip re-parsing)
            from epichat.epichat import EpiChatResult
            exec_result = chat._execute_with_retry(
                st.session_state.last_query, final_params,
                str(Path("results") / "sim_latest.png")
            )

        if exec_result["error"]:
            st.error(f"**Simulation error:** {exec_result['error']}")
        else:
            from epichat.narrator import narrate
            narration = narrate(st.session_state.last_query, final_params, exec_result["stats"])
            result = EpiChatResult(
                user_input=st.session_state.last_query,
                params=final_params,
                stats=exec_result["stats"],
                plot_path=exec_result["plot_path"],
                narration=narration,
            )
            st.session_state.history.append(result)
            st.session_state.last_result = result
            st.session_state.step = "results"
            st.rerun()


# ══════════════════════════════════════════════════════════════════════════════
# STEP 3 — Results
# ══════════════════════════════════════════════════════════════════════════════
elif step == "results":
    result = st.session_state.last_result
    if result is None:
        st.session_state.step = "input"
        st.rerun()

    st.title("Simulation Results")
    st.caption(f'Query: *"{result.user_input}"*')
    st.success("Simulation complete!")

    col_plot, col_text = st.columns([1, 1])

    with col_plot:
        st.subheader("Epidemic curve")
        if result.plot_path and Path(result.plot_path).exists():
            st.image(result.plot_path, use_container_width=True)
        else:
            st.info("Plot not available.")

    with col_text:
        st.subheader("Results summary")
        s = result.stats
        n = s.get("n_agents", 1)
        pct = s.get("total_infected", 0) / n * 100 if n else 0

        mc1, mc2, mc3 = st.columns(3)
        mc1.metric("Peak infections", f"{s.get('peak_infections', '?'):,}",
                   f"day {s.get('peak_day', '?')}")
        mc2.metric("Total infected", f"{s.get('total_infected', '?'):,}", f"{pct:.1f}%")
        mc3.metric("Deaths", f"{s.get('total_deaths', 0):,}")

        st.markdown("---")
        st.markdown(result.narration.get("summary", ""))

        findings = result.narration.get("key_findings", [])
        if findings:
            st.markdown("**Key findings:**")
            for f in findings:
                st.markdown(f"- {f}")

    with st.expander("Model details"):
        p = result.params
        interventions_display = []
        for i in p.interventions:
            d = {"type": i.type}
            if i.type == "vaccine":
                d.update({"coverage": i.coverage, "start_day": i.start_day})
            elif i.type == "seasonality":
                d.update({"scale": i.scale, "shift": i.shift})
            elif i.type == "treatment":
                d.update({"coverage": i.coverage, "capacity": i.capacity})
            interventions_display.append(d)

        st.json({
            "disease_type":         p.disease_type,
            "n_agents":             p.n_agents,
            "network_type":         p.network_type,
            "n_contacts":           p.n_contacts,
            "network_beta":         p.network_beta,
            "beta":                 p.beta,
            "effective_R0":         round(p.approx_r0(), 2),
            "init_prev":            p.init_prev,
            "dur_inf_days":         p.dur_inf,
            "dur_exp_days":         p.dur_exp,
            "p_death":              p.p_death,
            "sim_dur_years":        p.sim_dur_years,
            "rand_seed":            p.rand_seed,
            "use_demographics":     p.use_demographics,
            "interventions":        interventions_display,
        })

    st.divider()
    c1, c2 = st.columns([1, 5])
    if c1.button("New Simulation", type="primary"):
        st.session_state.step = "input"
        st.rerun()
    if c2.button("Edit Parameters"):
        # Re-init the form with the params that were used
        _init_review_state(result.params)
        st.session_state.step = "review"
        st.rerun()
