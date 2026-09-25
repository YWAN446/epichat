# Golden set

Automated regression tests for EpiChat's *behaviour* — what it says and
which tools it calls — as opposed to `tests/`, which covers its code.

    py -3.10 -m pip install -r evals/requirements.txt

Run as a module — the package uses relative imports:

    py -3.10 -m evals.golden.run                    # 1 repeat, all cases
    py -3.10 -m evals.golden.run --repeats 3        # before a pilot release
    py -3.10 -m evals.golden.run --category guardrail
    py -3.10 -m evals.golden.run --case uncertainty-hepa-r0

Both the agent and the judge make real API calls, so every run costs money.
Results land in `evals/golden/results/<timestamp>/` (gitignored);
`baseline.json` is committed so the report can flag regressions.

## Adding a case

Cases are YAML, grouped by category in `cases/`. Two kinds of check:

- **Deterministic** — `tool_called`, `no_tool`, `config`, `refused`,
  `no_fetch_before_confirmation`, `ran_simulation`, `cites_web_source`.
  These grade what the agent did. A `config` value may reference the
  database as `db.r0.typical`, so Annie's updates do not break cases.
- **`judge`** — yes/no criteria about wording, graded by a second Claude
  call that must quote its evidence.

Set `critical: true` when every repeat must pass. All guardrail and
workflow-gate cases are critical: a refusal that works two times in three is
not a refusal. Set `real_sim: true` to run Starsim for real (1–2 minutes);
otherwise a stub returns canned results.

### Grading dangerous-pathogen content

Write a `judge` criterion about pathogen enhancement, an extreme
hypothetical scenario, or a high-fatality disease (Ebola, meningococcal
meningitis, and similar) only with real caution. The judge model has its own
safety classifier, and it can decline to even *read* a transcript that
discusses this content — including a transcript where the agent already
handled it correctly. That decline comes back as `stop_reason == "refusal"`
and surfaces as a distinct "judge declined" verdict (see `evals/golden/
judge.py`, and the "Judge declined" report section it feeds), never as a
silent pass — but it also never grades anything, so a case that depends on
it can fail forever regardless of the agent's behaviour. Grade the fact
deterministically instead: `tool_called` and `config` can assert "looked up
in the database" and "has the right disease/country," and the `refused`
check (which reads the agent's own `_REFUSAL_MSG` off the trace, not a
second model's opinion) is the one to use for "did the agent decline this
request" — the question a guardrail case actually needs answered.

## After the pilot

Conversations students rate 👎 are the best source of new cases: reproduce
the prompt, write the criterion the reply missed, and it becomes a
regression test.
