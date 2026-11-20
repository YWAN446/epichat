from __future__ import annotations

import datetime
import os
import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from pydantic import ValidationError

from .adapters.un_wpp import UNWPPAdapter
from .adapters.who_gho import WHOGHOAdapter
from .adapters.wb_data360 import WorldBankData360Adapter
from .narrator import narrate
from .parser import configure_resolver, fix_params, get_last_resolved, parse_query
from .resolver import ResolvedField
from .schema import SimParams

_MAX_RETRIES = 3
_TIMEOUT_SECONDS = 90

# Compartment curves in plotting order; each keeps its color whichever model ran.
_COMPARTMENTS = (
    ("n_susceptible", "Susceptible", "#2a78d6"),
    ("n_exposed", "Exposed", "#eda100"),
    ("n_infectious", "Infectious", "#e34948"),
    ("n_asymptomatic", "Asymptomatic", "#eb6834"),
    ("n_recovered", "Recovered", "#008300"),
)


def plot_series(series: dict, path: str | Path, title: str) -> str:
    """Draw the epidemic curves from a run's daily series and save them as a PNG."""
    from matplotlib.figure import Figure  # no pyplot: no global state, safe in Streamlit's threads

    fig = Figure(figsize=(9, 7), layout="constrained")
    top, bottom = fig.subplots(2, 1, sharex=True)
    day = series["day"]
    for key, label, color in _COMPARTMENTS:
        if key in series:
            top.plot(day, series[key], color=color, linewidth=2, label=label)
    top.set_title("People in each compartment")
    top.legend(frameon=False)
    bottom.plot(day, series["new_infections"], color="#2a78d6", linewidth=2)
    bottom.set_title("New infections per day")
    bottom.set_xlabel("Day")
    for ax in (top, bottom):
        ax.grid(alpha=0.3)
        ax.spines[["top", "right"]].set_visible(False)
    fig.suptitle(title)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=150)
    return str(path)


@dataclass
class EpiChatResult:
    user_input: str
    params: SimParams
    stats: dict
    plot_path: str | None
    narration: dict  # {'summary': str, 'key_findings': list[str]}
    error: str | None = None
    data_sources: list[ResolvedField] = field(default_factory=list)
    param_warnings: list[str] = field(default_factory=list)

    def format_cli(self) -> str:
        """Return a formatted string for CLI display."""
        lines = []

        if self.error:
            lines.append(f"\n[ERROR] {self.error}\n")
            return "\n".join(lines)

        sep = "-" * 42
        lines.append("\nRESULTS")
        lines.append(sep)

        if self.param_warnings:
            lines.append("⚠️  Parameter notes")
            for w in self.param_warnings:
                lines.append(f"  • {w}")
            lines.append(sep)

        s = self.stats
        n = s.get("n_agents", 1)
        pct = s.get("total_infected", 0) / n * 100 if n else 0

        lines.append(f"Peak infections:  {s.get('peak_infections', 'N/A'):>10,}  (day {s.get('peak_day', '?')})")
        lines.append(f"Total infected:   {s.get('total_infected', 'N/A'):>10,}  ({pct:.1f}%)")
        lines.append(f"Total deaths:     {s.get('total_deaths', 0):>10,}")
        lines.append(sep)

        lines.append("")
        lines.append(self.narration.get("summary", ""))
        lines.append("")

        findings = self.narration.get("key_findings", [])
        if findings:
            lines.append("Key findings:")
            for f in findings:
                lines.append(f"  - {f}")
            lines.append("")

        p = self.params
        pop_field = next((rf for rf in self.data_sources if rf.field == "total_population"), None)
        lines.append("MODEL DETAILS")
        lines.append(f"  Disease type:     {p.disease_type.upper()}")
        if pop_field is not None:
            lines.append(f"  Population:       {int(pop_field.value):,}")
        lines.append(f"  Num of agents:    {p.n_agents:,}")
        lines.append(f"  Contacts/agent:   {p.n_contacts}")
        lines.append(f"  Network:          {p.network_type}")
        if p.network_type == "age_structured":
            lines.append(f"  Network beta:     {p.network_beta:.4f}")
        lines.append(f"  Beta:             {p.beta:.6f}")
        lines.append(f"  Approx R0:        {p.approx_r0():.1f}")
        lines.append(f"  Init prevalence:  {p.init_prev * 100:.2f}%")
        lines.append(f"  Inf. duration:    {p.dur_inf:.1f} days")
        if p.dur_exp is not None:
            lines.append(f"  Exp. duration:    {p.dur_exp:.1f} days")
        if p.dur_immune is not None:
            lines.append(f"  Immunity dur.:    {p.dur_immune:.1f} days")
        lines.append(f"  Case fatality:    {p.p_death * 100:.2f}%")
        if p.disease_type == "seiar":
            lines.append(f"  % asymptomatic:   {p.p_asymp * 100:.1f}%")
            lines.append(f"  Rel. trans (A):   {p.rel_trans_asymp:.2f}")
        lines.append(f"  Duration:         {p.sim_dur_years} year(s)")
        if p.rand_seed is not None:
            lines.append(f"  Random seed:      {p.rand_seed}")
        interv = [i.type for i in p.interventions]
        lines.append(f"  Interventions:    {', '.join(interv) if interv else 'None'}")
        if p.use_demographics:
            lines.append(f"  Birth rate:       {p.birth_rate:.2f} per 1,000/yr")
            lines.append(f"  Death rate:       {p.death_rate:.2f} per 1,000/yr")
        if p.age_pct_under18 is not None:
            lines.append(f"  Age dist. (0-17):  {p.age_pct_under18:.1f}%")
            lines.append(f"  Age dist. (18-64): {p.age_pct_18_64:.1f}%")
            lines.append(f"  Age dist. (65+):   {p.age_pct_over65:.1f}%")
        coverage_source = next(
            (rf for rf in self.data_sources if rf.field.endswith("_coverage")), None
        )
        vaccine = p.get_vaccine()
        if coverage_source is not None and vaccine is not None:
            label = coverage_source.field.removesuffix("_coverage").upper()
            lines.append(f"  Vaccine coverage: {vaccine.coverage * 100:.1f}%  (pre-existing, {label})")

        if self.data_sources:
            lines.append("")
            lines.append("DATA SOURCES")
            max_field_len = max(len(rf.field) for rf in self.data_sources)
            for rf in self.data_sources:
                if isinstance(rf.value, dict):
                    val_str = ", ".join(f"{k}: {v}%" for k, v in rf.value.items())
                else:
                    val_str = str(rf.value)
                desc = f"  ({rf.description})" if rf.description else ""
                used_marker = "  ★ used" if rf.alternatives else ""
                lines.append(
                    f"  {rf.field:<{max_field_len}}  {val_str}  — {rf.citation}{desc}{used_marker}"
                )
                for alt in rf.alternatives:
                    if isinstance(alt.value, dict):
                        alt_val = ", ".join(f"{k}: {v}%" for k, v in alt.value.items())
                    else:
                        alt_val = str(alt.value)
                    alt_desc = f"  ({alt.description})" if alt.description else ""
                    lines.append(f"    ↳ {alt_val}  — {alt.citation}{alt_desc}")

        if self.plot_path:
            lines.append(f"\n[Plot saved to: {self.plot_path}]")

        return "\n".join(lines)


class EpiChat:
    def __init__(self, output_dir: str | Path = "results") -> None:
        self.output_dir = Path(output_dir)
        configure_resolver(UNWPPAdapter(api_key=os.environ.get("UN_API_KEY")))
        configure_resolver(WHOGHOAdapter())
        configure_resolver(WorldBankData360Adapter())

    def run(self, user_input: str) -> EpiChatResult:
        """Full pipeline: NL query → simulation → narration."""
        print("[EpiChat] Parsing query...")

        try:
            params = parse_query(user_input)
        except (ValueError, ValidationError) as e:
            return EpiChatResult(
                user_input=user_input,
                params=None,  # type: ignore[arg-type]
                stats={},
                plot_path=None,
                narration={},
                error=str(e),
            )

        from .disease_db import detect_disease, check_params as _db_check
        _disease = detect_disease(user_input)
        _param_warnings = (
            _db_check(
                _disease, params.approx_r0(), params.dur_inf, params.dur_exp,
                p_death=params.p_death or None,
                n_contacts=params.n_contacts,
                dur_immune=params.dur_immune,
                p_asymp=params.p_asymp if params.disease_type == "seiar" else None,
            )
            if _disease else []
        )

        # Unique output path for this run
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        plot_path = str(self.output_dir / f"sim_{ts}.png")

        print(f"[EpiChat] Running Starsim simulation ({params.disease_type.upper()}, n={params.n_agents:,}, beta={params.beta:.4f})...")

        exec_result = self._execute_with_retry(user_input, params, plot_path)

        if exec_result["error"]:
            return EpiChatResult(
                user_input=user_input,
                params=params,
                stats={},
                plot_path=None,
                narration={},
                error=exec_result["error"],
                param_warnings=_param_warnings,
            )

        print("[EpiChat] Generating plain-language summary...")
        narration = narrate(user_input, params, exec_result["stats"])

        return EpiChatResult(
            user_input=user_input,
            params=params,
            stats=exec_result["stats"],
            plot_path=exec_result["plot_path"],
            narration=narration,
            data_sources=get_last_resolved(),
            param_warnings=_param_warnings,
        )

    def simulate(self, params: SimParams, plot_path: str) -> dict:
        """Run one simulation through epichat.sim in a child process (with a
        timeout) and plot its curves. Returns {"stats", "series", "plot_path",
        "error"}; error is None on success."""
        from epichat.params.migrate import coerce_params
        from epichat.params.resolve import resolve_demographics
        from sim.runner import run_params  # the simulation service's child-process runner

        failed = {"stats": {}, "series": {}, "plot_path": None}
        try:
            v2 = resolve_demographics(coerce_params(params.model_dump()))
        except (ValueError, ValidationError) as e:
            return {**failed, "error": f"Invalid parameters: {e}"}
        output_path = Path(tempfile.gettempdir()) / f"epichat-{uuid.uuid4().hex}.json"
        result = run_params(v2, output_path, _TIMEOUT_SECONDS)
        if not result.ok:
            return {**failed, "error": result.error}
        title = f"{params.disease_type.upper()} simulation"
        return {"stats": result.stats, "series": result.series,
                "plot_path": plot_series(result.series, plot_path, title), "error": None}

    def _execute_with_retry(
        self, user_input: str, params: SimParams, plot_path: str, pop_scale: float = 1.0
    ) -> dict:
        """simulate(), asking the model to fix the parameters after a failure.

        pop_scale is accepted because the agent (epichat/agent.py) passes it;
        the results stay per agent, as they always have on this path."""
        current_params = params
        last_error = None

        for attempt in range(_MAX_RETRIES):
            result = self.simulate(current_params, plot_path)

            if result["error"] is None:
                return result

            last_error = result["error"]
            print(f"  [!] Attempt {attempt + 1} failed: {last_error[:120]}")

            if attempt < _MAX_RETRIES - 1:
                print("  [~] Asking LLM to fix parameters...")
                try:
                    current_params = fix_params(user_input, current_params, last_error)
                except Exception as e:
                    last_error = f"Parameter fix failed: {e}"
                    break

        return {"stats": {}, "series": {}, "plot_path": None, "error": last_error}
