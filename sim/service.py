"""The attempt loop: resolve demographics, run the builder in a child process,
and on failure ask the model to repair the parameters, up to the configured
number of times.

Runner and Repairer are injected so the loop is tested without Starsim or the
model. Parameters are schema v2 throughout (main.py coerces a v1 body first).
A timed-out attempt is final. The child computes the stats from the full
series; scaling and thinning are not done here, main.py applies them."""
from __future__ import annotations

import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from epichat.params.paths import diff as diff_paths
from epichat.params.resolve import resolve_demographics
from epichat.params.schema_v2 import SimParamsV2
from runner import RunResult, run_params
from settings import Settings

if TYPE_CHECKING:  # the Anthropic SDK is imported only when a repair actually happens
    from epichat.params.repair import RepairResult

Runner = Callable[[SimParamsV2, Path, float], RunResult]
Repairer = Callable[[str, SimParamsV2, str, str], "RepairResult"]


def agent_years(params: SimParamsV2) -> float:
    return params.run.n_agents * params.run.sim_dur_years * params.run.n_replicates


def exceeds_cap(params: SimParamsV2, settings: Settings) -> bool:
    return agent_years(params) > settings.max_agent_years


def _default_repairer() -> Repairer:
    from epichat.params.repair import repair_params
    return repair_params


@dataclass
class Outcome:
    ok: bool
    status: int
    effective_params: SimParamsV2
    stats: dict = field(default_factory=dict)
    series: dict = field(default_factory=dict)
    repairs: list[dict] = field(default_factory=list)
    attempts: int = 0
    error: str | None = None
    timed_out: bool = False
    replicates: dict | None = None


def diff_params(before: SimParamsV2, after: SimParamsV2) -> list[dict]:
    """Changes by dotted v2 path, for the repair record."""
    return diff_paths(before.model_dump(), after.model_dump())


def _output_path() -> Path:
    return Path(tempfile.gettempdir()) / f"epichat-{uuid.uuid4().hex}.json"


def simulate(params: SimParamsV2, context_text: str, settings: Settings,
             run: Runner = run_params, repair: Repairer | None = None) -> Outcome:
    params = resolve_demographics(params)
    repairs: list[dict] = []
    attempts = 0
    last_error: str | None = None

    while attempts <= settings.max_repairs:
        attempts += 1
        output_path = _output_path()
        result = run(params, output_path, settings.timeout_seconds)
        if result.ok:
            return Outcome(True, 200, params, stats=result.stats, series=result.series, replicates=result.replicates,
                           repairs=repairs, attempts=attempts)
        last_error = result.error or "unknown execution error"
        if result.timed_out:
            return Outcome(False, 504, params, repairs=repairs, attempts=attempts,
                           error=last_error, timed_out=True)
        if attempts > settings.max_repairs:
            break
        try:
            repaired = (repair or _default_repairer())(context_text, params, last_error, settings.repair_model)
        except Exception as e:
            repairs.append({"attempt": attempts, "error": last_error,
                            "repair_error": f"{type(e).__name__}: {e}"})
            return Outcome(False, 500, params, repairs=repairs, attempts=attempts, error=last_error)
        if exceeds_cap(repaired.params, settings):
            repairs.append({"attempt": attempts, "error": last_error,
                            "repair_error": (f"repaired params exceed the cap of {settings.max_agent_years:,.0f} "
                                             f"agent-years (n_agents × sim_dur_years × n_replicates = {agent_years(repaired.params):,.0f})")})
            return Outcome(False, 500, params, repairs=repairs, attempts=attempts, error=last_error)
        after = resolve_demographics(repaired.params)   # diff what will actually run, not the model's raw echo
        repairs.append({
            "attempt": attempts, "error": last_error,
            "changes": diff_params(params, after),
            "usage": {"model": repaired.model, "input_tokens": repaired.input_tokens,
                      "output_tokens": repaired.output_tokens},
        })
        params = after

    return Outcome(False, 500, params, repairs=repairs, attempts=attempts, error=last_error)
