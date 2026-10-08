"""The attempt loop: resolve demographics, render, run, and on failure ask the
model to repair the parameters, up to the configured number of times.

Runner and Repairer are injected so the loop is tested without Starsim or the
model. A timed-out attempt is final. Scaling and thinning are not done here;
main.py applies them to the raw outcome."""
from __future__ import annotations

import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from epichat.generator import CodeGenerator, resolve_demographics
from epichat.schema import SimParams
from runner import RunResult, run_script
from series import stats_from
from settings import Settings

if TYPE_CHECKING:  # the Anthropic SDK is imported only when a repair actually happens
    from epichat.parser import RepairResult

Runner = Callable[[str, Path, float], RunResult]
Repairer = Callable[[str, SimParams, str, str], "RepairResult"]


def agent_years(params: SimParams) -> float:
    return params.n_agents * params.sim_dur_years


def exceeds_cap(params: SimParams, settings: Settings) -> bool:
    return agent_years(params) > settings.max_agent_years


def _default_repairer() -> Repairer:
    from epichat.parser import repair_params
    return repair_params


@dataclass
class Outcome:
    ok: bool
    status: int
    effective_params: SimParams
    stats: dict = field(default_factory=dict)
    series: dict = field(default_factory=dict)
    repairs: list[dict] = field(default_factory=list)
    attempts: int = 0
    error: str | None = None
    timed_out: bool = False


def diff_params(before: SimParams, after: SimParams) -> list[dict]:
    old, new = before.model_dump(), after.model_dump()
    return [{"field": key, "from": old[key], "to": new[key]} for key in old if old[key] != new[key]]


def _output_path() -> Path:
    return Path(tempfile.gettempdir()) / f"epichat-{uuid.uuid4().hex}.json"


def simulate(params: SimParams, context_text: str, settings: Settings,
             run: Runner = run_script, repair: Repairer | None = None) -> Outcome:
    params = resolve_demographics(params)
    repairs: list[dict] = []
    attempts = 0
    last_error: str | None = None

    while attempts <= settings.max_repairs:
        attempts += 1
        output_path = _output_path()
        try:
            code = CodeGenerator().generate(params, str(output_path), output_mode="json")
        except Exception as e:  # a template that cannot render is a failed run, not a crash
            return Outcome(False, 500, params, repairs=repairs, attempts=attempts,
                           error=f"template error: {type(e).__name__}: {e}")
        result = run(code, output_path, settings.timeout_seconds)
        if result.ok:
            return Outcome(True, 200, params, stats=stats_from(result.series, params.n_agents),
                           series=result.series, repairs=repairs, attempts=attempts)
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
                                             f"agent-years ({agent_years(repaired.params):,.0f})")})
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
