from __future__ import annotations

import datetime
import os
from dataclasses import dataclass, field
from pathlib import Path

from pydantic import ValidationError

from .adapters.un_wpp import UNWPPAdapter
from .adapters.who_gho import WHOGHOAdapter
from .executor import SimExecutor
from .generator import CodeGenerator
from .narrator import narrate
from .parser import configure_resolver, fix_params, get_last_resolved, parse_query
from .resolver import ResolvedField
from .schema import SimParams

_MAX_RETRIES = 3


@dataclass
class EpiChatResult:
    user_input: str
    params: SimParams
    stats: dict
    plot_path: str | None
    narration: dict  # {'summary': str, 'key_findings': list[str]}
    error: str | None = None
    data_sources: list[ResolvedField] = field(default_factory=list)

    def format_cli(self) -> str:
        """Return a formatted string for CLI display."""
        lines = []

        if self.error:
            lines.append(f"\n[ERROR] {self.error}\n")
            return "\n".join(lines)

        sep = "-" * 42
        lines.append("\nRESULTS")
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
        lines.append("MODEL DETAILS")
        lines.append(f"  Disease type:     {p.disease_type.upper()}")
        lines.append(f"  Population:       {p.n_agents:,}")
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
        if coverage_source is not None and p.get_vaccine() is not None:
            label = coverage_source.field.replace("_coverage", "").upper()
            lines.append(f"  Vaccine coverage: {p.get_vaccine().coverage * 100:.1f}%  (pre-existing, {label})")

        if self.data_sources:
            lines.append("")
            lines.append("DATA SOURCES")
            max_field_len = max(len(rf.field) for rf in self.data_sources)
            for rf in self.data_sources:
                if isinstance(rf.value, dict):
                    val_str = ", ".join(f"{k}: {v}%" for k, v in rf.value.items())
                else:
                    val_str = str(rf.value)
                lines.append(f"  {rf.field:<{max_field_len}}  {val_str}  — {rf.citation}")

        if self.plot_path:
            lines.append(f"\n[Plot saved to: {self.plot_path}]")

        return "\n".join(lines)


class EpiChat:
    def __init__(self, output_dir: str | Path = "results") -> None:
        self.output_dir = Path(output_dir)
        self.generator = CodeGenerator()
        self.executor = SimExecutor()
        configure_resolver(UNWPPAdapter(api_key=os.environ.get("UN_API_KEY")))
        configure_resolver(WHOGHOAdapter())

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
        )

    def _execute_with_retry(
        self, user_input: str, params: SimParams, plot_path: str
    ) -> dict:
        current_params = params
        last_error = None

        for attempt in range(_MAX_RETRIES):
            code = self.generator.generate(current_params, plot_path)
            result = self.executor.run(code, self.output_dir)

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

        return {"plot_path": None, "stats": {}, "error": last_error}
