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

- **Deterministic** — `tool_called`, `no_tool`, `config`,
  `no_fetch_before_confirmation`, `ran_simulation`, `cites_web_source`.
  These grade what the agent did. A `config` value may reference the
  database as `db.r0.typical`, so Annie's updates do not break cases.
- **`judge`** — yes/no criteria about wording, graded by a second Claude
  call that must quote its evidence.

Set `critical: true` when every repeat must pass. All guardrail and
workflow-gate cases are critical: a refusal that works two times in three is
not a refusal. Set `real_sim: true` to run Starsim for real (1–2 minutes);
otherwise a stub returns canned results.

## After the pilot

Conversations students rate 👎 are the best source of new cases: reproduce
the prompt, write the criterion the reply missed, and it becomes a
regression test.
