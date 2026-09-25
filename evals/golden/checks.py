"""Deterministic checks over a Trace. Each returns failure strings; [] is a pass.

These grade what the agent *did* — which tools it called, in what order, and
what configuration it ended up with. Wording is the judge's job.
"""
from __future__ import annotations

from typing import Any

_FETCH_TOOLS = ("fetch_demographics", "fetch_health_system",
                "fetch_vaccination_coverage")


def _resolve(expected: Any, disease: str | None) -> Any:
    """Resolve a 'db.<param>.<slot>' reference against the live database.

    Lets a case say r0: db.r0.typical instead of hardcoding 15, so Annie's
    data updates do not require editing cases.
    """
    if not isinstance(expected, str) or not expected.startswith("db."):
        return expected
    parts = expected.split(".")
    if len(parts) != 3:
        raise ValueError(f"bad db reference {expected!r}; expected db.<param>.<slot>")
    _, param, slot = parts
    if not disease:
        raise ValueError(f"{expected!r} needs the case's config to name a disease")
    from epichat.disease_db import lookup

    entry = lookup(disease)
    block = (entry or {}).get(param)
    if not isinstance(block, dict) or slot not in block:
        raise ValueError(f"{expected!r} is not in the database for {disease!r}")
    return block[slot]


def check_tool_called(trace, names) -> list[str]:
    called = {c["name"] for c in trace.tool_calls}
    return [f"{n} was never called (called: {sorted(called) or 'nothing'})"
            for n in names if n not in called]


def check_no_tool(trace, names) -> list[str]:
    called = {c["name"] for c in trace.tool_calls}
    return [f"{n} was called but should not have been" for n in names if n in called]


def check_config(trace, expected: dict) -> list[str]:
    if trace.final_config is None:
        return [f"no configuration was produced (expected {sorted(expected)})"]
    failures = []
    disease = trace.final_config.get("disease")
    for key, want in expected.items():
        want = _resolve(want, disease)
        got = trace.final_config.get(key)
        if isinstance(want, (int, float)) and isinstance(got, (int, float)):
            if abs(got - want) > max(0.01, abs(want) * 0.02):
                failures.append(f"{key}: expected ~{want}, got {got}")
        elif got != want:
            failures.append(f"{key}: expected {want!r}, got {got!r}")
    return failures


def check_no_fetch_before_confirmation(trace) -> list[str]:
    """Data must not be fetched on the opening turn, before the user agrees."""
    return [f"{c['name']} ran on the first turn, before the user confirmed"
            for c in trace.tool_calls
            if c["turn"] == 0 and c["name"] in _FETCH_TOOLS]


def check_ran_simulation(trace, expected: bool) -> list[str]:
    if trace.ran_simulation != expected:
        return ["the simulation ran but should not have" if trace.ran_simulation
                else "the simulation never ran"]
    return []


def check_cites_a_web_source(trace, expected: bool) -> list[str]:
    cited = [s for s in trace.data_sources if str(s).startswith("http")]
    if expected and not cited:
        return ["no web source was cited"]
    if not expected and cited:
        return [f"web sources were cited unexpectedly: {cited}"]
    return []


_CHECKS = {
    "tool_called": check_tool_called,
    "no_tool": check_no_tool,
    "config": check_config,
    "ran_simulation": check_ran_simulation,
    "cites_web_source": check_cites_a_web_source,
}


def run_checks(trace, checks: dict) -> list[str]:
    """Run every deterministic check in a case. Returns failure strings."""
    failures: list[str] = []
    if trace.error:
        failures.append(f"harness error: {trace.error}")
    for name, argument in checks.items():
        if name == "judge":
            continue
        if name == "no_fetch_before_confirmation":
            if argument:
                failures.extend(check_no_fetch_before_confirmation(trace))
            continue
        checker = _CHECKS.get(name)
        if checker is None:
            failures.append(f"unknown check {name!r}")
            continue
        try:
            failures.extend(checker(trace, argument))
        except Exception as exc:
            failures.append(f"check {name!r} could not run: {exc}")
    return failures
