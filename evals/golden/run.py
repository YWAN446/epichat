"""Run the golden set and write a report.

Run as a module — this package uses relative imports:

    py -3.10 -m evals.golden.run                     # 1 repeat, all cases
    py -3.10 -m evals.golden.run --repeats 3         # before a pilot release
    py -3.10 -m evals.golden.run --category guardrail
    py -3.10 -m evals.golden.run --case uncertainty-hepa-r0
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
from pathlib import Path

import yaml
from dotenv import load_dotenv

from .checks import run_checks
from .harness import run_case
from .judge import DEFAULT_JUDGE_MODEL, judge_case

HERE = Path(__file__).resolve().parent
CASES_DIR = HERE / "cases"
RESULTS_DIR = HERE / "results"
BASELINE = HERE / "baseline.json"

# Claude API list prices, USD per million tokens. Update alongside the model.
_PRICES = {"claude-opus-5": (5.0, 25.0), "claude-sonnet-5": (2.0, 10.0)}


def load_cases(directory: Path) -> list[dict]:
    cases: list[dict] = []
    seen: set[str] = set()
    for path in sorted(Path(directory).glob("*.yaml")):
        for case in yaml.safe_load(path.read_text(encoding="utf-8")) or []:
            if case["id"] in seen:
                raise ValueError(f"duplicate case id {case['id']!r} in {path.name}")
            seen.add(case["id"])
            case.setdefault("critical", False)
            case.setdefault("checks", {})
            case["_file"] = path.name
            cases.append(case)
    return cases


def run_once(case: dict, judge_model: str) -> dict:
    """One repeat of one case: deterministic checks, then the judge."""
    trace = run_case(case)
    failures = run_checks(trace, case["checks"])
    criteria = case["checks"].get("judge") or []
    verdicts = judge_case(trace.transcript(case["turns"]), criteria, model=judge_model)
    declined = []
    for verdict in verdicts:
        if not verdict["passed"]:
            failures.append(f"judge: {verdict['criterion']} — {verdict['evidence']}")
        if verdict.get("declined"):
            declined.append(verdict["criterion"])
    usage = next((v["_usage"] for v in verdicts if "_usage" in v), None)
    return {"passed": not failures, "failures": failures,
            "transcript": trace.transcript(case["turns"]),
            "tool_calls": [c["name"] for c in trace.tool_calls],
            "judge_usage": usage, "judge_declined": declined}


def score_case(case: dict, repeats: list[dict]) -> dict:
    """Critical cases must pass every repeat; others need a majority."""
    passes = sum(1 for r in repeats if r["passed"])
    rate = passes / len(repeats) if repeats else 0.0
    passed = passes == len(repeats) if case["critical"] else rate > 0.5
    return {"id": case["id"], "category": case["category"],
            "critical": case["critical"], "passed": passed, "pass_rate": rate,
            "failures": sorted({f for r in repeats for f in r["failures"]})}


def _cost(usage: dict) -> float:
    total = 0.0
    for model, counts in usage.items():
        price_in, price_out = _PRICES.get(model, (0.0, 0.0))
        total += counts.get("input_tokens", 0) / 1e6 * price_in
        total += counts.get("output_tokens", 0) / 1e6 * price_out
    return total


def write_report(out_dir: Path, scored: list[dict], baseline: dict,
                 usage: dict, declined: dict | None = None) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    lines = [f"# Golden set — {_dt.datetime.now():%Y-%m-%d %H:%M}", ""]
    total, passing = len(scored), sum(1 for s in scored if s["passed"])
    lines += [f"**{passing}/{total} cases passing**", ""]
    if usage:
        lines += [f"Judge tokens: {usage}", f"Estimated judge cost: ${_cost(usage):.2f}", ""]

    lines += ["## By category", "", "| category | passing | of |", "|---|---|---|"]
    for category in sorted({s["category"] for s in scored}):
        rows = [s for s in scored if s["category"] == category]
        lines.append(f"| {category} | {sum(1 for r in rows if r['passed'])} | {len(rows)} |")

    if declined:
        lines += ["", "## Judge declined", "",
                  "The judge's own safety classifier refused to grade these transcripts. "
                  "This is not a verdict on the agent — it counts toward the case's "
                  "failures below, but it means the criterion was never actually checked."]
        lines += [f"- **{case_id}** — {', '.join(criteria)}"
                  for case_id, criteria in sorted(declined.items())]

    regressions = [s for s in scored if not s["passed"] and baseline.get(s["id"]) is True]
    if regressions:
        lines += ["", "## Regression — passed last run, failing now", ""]
        lines += [f"- **{s['id']}** — {'; '.join(s['failures'][:3])}" for s in regressions]

    fixed = [s for s in scored if s["passed"] and baseline.get(s["id"]) is False]
    if fixed:
        lines += ["", "## Newly passing", ""] + [f"- {s['id']}" for s in fixed]

    failing = [s for s in scored if not s["passed"]]
    if failing:
        lines += ["", "## Failures", ""]
        for s in failing:
            flag = " **(critical)**" if s["critical"] else ""
            lines.append(f"### {s['id']}{flag} — pass rate {s['pass_rate']:.0%}")
            lines += [f"- {f}" for f in s["failures"]] + [""]

    path = out_dir / "report.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def main() -> None:
    # run.py is the entry point: neither harness.py nor judge.py loads
    # credentials on import, so this is the one place that must.
    load_dotenv()

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--category")
    parser.add_argument("--case")
    parser.add_argument("--judge-model", default=DEFAULT_JUDGE_MODEL)
    parser.add_argument("--update-baseline", action="store_true")
    args = parser.parse_args()

    cases = load_cases(CASES_DIR)
    if args.category:
        cases = [c for c in cases if c["category"] == args.category]
    if args.case:
        cases = [c for c in cases if c["id"] == args.case]
    if not cases:
        raise SystemExit("no cases matched")

    baseline = json.loads(BASELINE.read_text(encoding="utf-8")) if BASELINE.exists() else {}
    out_dir = RESULTS_DIR / _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir.mkdir(parents=True, exist_ok=True)
    usage: dict = {}
    scored: list[dict] = []
    declined_by_case: dict[str, list[str]] = {}

    with (out_dir / "traces.jsonl").open("w", encoding="utf-8") as handle:
        for index, case in enumerate(cases, 1):
            print(f"[{index}/{len(cases)}] {case['id']}", flush=True)
            repeats = []
            for _ in range(args.repeats):
                result = run_once(case, args.judge_model)
                repeats.append(result)
                counts = result.get("judge_usage")
                if counts:
                    bucket = usage.setdefault(counts["model"],
                                              {"input_tokens": 0, "output_tokens": 0})
                    bucket["input_tokens"] += counts["input_tokens"]
                    bucket["output_tokens"] += counts["output_tokens"]
            outcome = score_case(case, repeats)
            scored.append(outcome)
            declined = sorted({c for r in repeats for c in r.get("judge_declined") or []})
            if declined:
                declined_by_case[case["id"]] = declined
            handle.write(json.dumps({"case": case, "repeats": repeats,
                                     "score": outcome}, ensure_ascii=False) + "\n")
            print(f"    {'PASS' if outcome['passed'] else 'FAIL'} "
                  f"({outcome['pass_rate']:.0%})", flush=True)

    report = write_report(out_dir, scored, baseline, usage, declined_by_case)
    print(f"\n{report}")
    if args.update_baseline:
        # Merge into the existing baseline rather than overwriting it: a
        # --category or --case run only scores a subset of cases, and
        # overwriting would silently drop every other case's entry.
        merged = {**baseline, **{s["id"]: s["passed"] for s in scored}}
        BASELINE.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
        print(f"baseline updated: {BASELINE}")


if __name__ == "__main__":
    main()
