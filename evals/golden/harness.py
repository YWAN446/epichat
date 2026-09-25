"""Drive EpiChatAgent through a scripted conversation and record what it did.

In-process rather than through the browser: the agent already reports every
text block and tool call, so a check can ask "was fetch_demographics called
before the user confirmed?" instead of inferring it from screen text.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# No load_dotenv() here: importing this module must not pull in credentials.
# Callers that need them load them explicitly (evals/golden/run.py does).
# Note this does NOT make "no key means no network" true on its own - several
# epichat modules still call load_dotenv() at import, so importing the agent
# can repopulate the key. CI is safe because it has no .env; locally the real
# guarantee is that every test building an agent patches anthropic.Anthropic.

_STUB_STATS = {"n_agents": 10_000, "total_infected": 4_200, "peak_infected": 850,
               "peak_day": 96, "deaths": 63, "total_vaccinated": 0}


class StubExecutor:
    """Stands in for EpiChat: canned results, no Starsim run, no plot file.

    A real run takes 1-2 minutes, which is too slow for most cases. Cases
    that need the real thing set real_sim: true and get an EpiChat instance.
    """

    def __init__(self, stats: dict | None = None) -> None:
        self.stats = dict(stats or _STUB_STATS)
        self.calls: list[dict] = []

    def _execute_with_retry(self, user_input, params, plot_path, pop_scale=1.0) -> dict:
        self.calls.append({"user_input": user_input, "params": params.model_dump(),
                           "plot_path": plot_path, "pop_scale": pop_scale})
        return {"stats": dict(self.stats), "plot_path": plot_path, "error": None}


@dataclass
class Trace:
    """Everything one graded case did."""

    case_id: str
    replies: list[str] = field(default_factory=list)
    tool_calls: list[dict] = field(default_factory=list)
    final_config: dict | None = None
    data_sources: list[str] = field(default_factory=list)
    ran_simulation: bool = False
    error: str | None = None
    events: list[dict] = field(default_factory=list)

    def transcript(self, turns: list[str]) -> str:
        """Readable rendering for the judge and the report."""
        lines: list[str] = []
        for i, user_text in enumerate(turns):
            lines.append(f"USER: {user_text}")
            for call in [c for c in self.tool_calls if c["turn"] == i]:
                lines.append(f"  [tool] {call['name']}({call['input']})")
            if i < len(self.replies):
                lines.append(f"ASSISTANT: {self.replies[i]}")
        return "\n".join(lines)


def _executor_for(case: dict):
    if case.get("real_sim"):
        from epichat.epichat import EpiChat
        return EpiChat(output_dir="results")
    return StubExecutor(case.get("stub_stats"))


def run_case(case: dict, executor: Any | None = None) -> Trace:
    """Run one case's turns against a fresh agent and return its trace."""
    from epichat.agent import EpiChatAgent

    trace = Trace(case_id=case["id"])
    agent = EpiChatAgent(executor=executor or _executor_for(case))

    for turn_index, user_text in enumerate(case["turns"]):
        parts: list[str] = []

        def on_event(kind: str, payload: dict, _i=turn_index, _parts=parts) -> None:
            trace.events.append({"turn": _i, "kind": kind, "payload": _summarize(payload)})
            if kind == "text":
                _parts.append(payload["text"])
            elif kind == "tool_use":
                trace.tool_calls.append({"turn": _i, "name": payload["name"],
                                         "input": payload.get("input") or {}})
                if payload["name"] == "run_simulation":
                    trace.ran_simulation = True

        try:
            agent.handle(user_text, on_event)
        except Exception as exc:  # the agent catches its own; this is the harness failing
            trace.error = f"{type(exc).__name__}: {exc}"
            trace.replies.append("")
            break
        trace.replies.append("\n\n".join(parts).strip())

    if agent.state.params is not None:
        trace.final_config = agent.state.params.model_dump()
        trace.final_config["disease"] = agent.state.disease
        # SimParams has no r0 field — only beta, which configure_simulation
        # calibrates from a requested r0. Expose the derived value so cases
        # can assert on R0 without duplicating that calibration math.
        trace.final_config["approx_r0"] = round(agent.state.params.approx_r0(), 2)
    trace.data_sources = [getattr(f, "citation", str(f)) for f in agent.state.data_sources]
    return trace


def _summarize(payload: dict) -> dict:
    """Trim event payloads so a trace file stays readable."""
    out = {}
    for key, value in payload.items():
        if isinstance(value, str) and len(value) > 2000:
            out[key] = value[:2000] + "…"
        elif key == "sources":
            out[key] = [getattr(v, "citation", str(v)) for v in value]
        else:
            out[key] = value
    return out
