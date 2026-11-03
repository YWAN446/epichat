# Annie's October parameters: a second, per-parameter port

**Why.** Annie's branch `origin/feature/pipelines` (PR #3, tip `f295ccc`, 2026-10-27) is 512 commits behind `main`, its
copy of `epichat/data/disease_parameters.json` is not valid JSON, and a text merge conflicts in six places. September's
work was ported by `scripts/port_annie_parameters.py` (commits `e6de048`, `e66a380`, from her `8b2a4ab`). This round
ports what she has done since, parameter by parameter, so nothing `main` has corrected is lost.

**What changed, three ways.** For the diseases ported in September the base is her `8b2a4ab`; for the rest it is
`main`'s normalized copy of the merge-base content (`7790f7b`, since the merge-base file does not parse). Of her
parameters, 33 changed since the base and none changed on `main` too; 8 of the 33 are cosmetic after cleaning (an
empty estimates list), so 25 are ported:

- dengue: all 7 (R0 2.03 to 10.29, typical 6.16; incubation 3 to 10, 5.9; infectious 1 to 7, 4.5; asymptomatic
  fraction; fatality; immunity; contacts text)
- RSV: all 7 (R0 0.92 to 7.1, 3.0; infectious 3.4 to 18, 11.2; cited incubation; asymptomatic fraction; fatality
  0 to 1.7%, 0.31%; immunity 60 to 812 days, 460; contacts text)
- Ebola: 6 (incubation 2 to 21, typical 9; infectious 3.5 to 10.7, typical 5.61; re-cited estimates)
- measles fatality (an estimate's range that excluded its own value is cleared), rubella fatality (0.005% to
  0.0005%), varicella asymptomatic fraction (0.07 to 0.33, 0.1) and R0 estimate range, meningococcal infectious
  period (new estimate; stays under review).

## Decisions (rulings, following September's rules)

- **Dengue's fatality goes under review.** Its maximum, 25%, is an ICU case series, not a population case fatality;
  September put influenza's 13.5% under review for the same reason.
- **The meningococcal infectious period stays under review.** Annie's 8 days is a treated case's infectious window
  (7 days before onset to 24 hours after antibiotics), not the untreated period or the carriage that drives
  transmission. The note is updated to say so.
- **No schema change.** Her `pmid` becomes a note ("PMID 25390569") since the estimate already has a URL; her
  `unit_override: "contacts/case"` becomes the allowed `metric` field ("contacts traced per case, not per day").
- The source is pinned to her commit `f295ccc`, not the moving branch.

## Global constraints

No migrations, no new npm dependencies, Starsim 3.7.2, never re-capture `tests/fixtures/sim_baseline_v1.json`.
`main`'s file is the schema of record (`tests/test_disease_parameters.py`); main's display names and aliases stay.
Exactly 16 diseases.

## Task 1: the port

- Test first: `tests/test_annie_port_2026_11.py` asserts the ported values above, the two under-review entries, the
  PMID note, the contacts metric, and that the eight cosmetic parameters and every other disease are unchanged.
- `scripts/port_annie_parameters.py`: September's round recorded in the docstring; `PORT_DISEASES = ()`,
  `PORT_PARAMS` = the 25; source `f295ccc`; parse with `raw_decode` (her file now closes its diseases block, so the
  repair's extra braces are extra data); `_clean` maps `pmid` and `unit_override`; `UNDER_REVIEW` gains dengue's
  fatality and the meningococcal note is updated.
- Run it; regenerate `npm --prefix web run sync-data` and `scripts/review_requests.py --write
  docs/data-review-requests.md`.
- Verify: the full Python suite (`--ignore=tests/test_r0_calibration.py`) and the web suite.

## Task 2: the docs and the questions for Annie

- `docs/docs.html`'s disease table, regenerated from `web/data/disease_db.json` by the same rules as today's rows
  (a generator that first reproduces today's 16 rows exactly).
- `docs/annie-param-review-2026-11.md`: what was ported, the open questions (meningococcal infectious period,
  influenza 13.5%, hepatitis A immunity, dengue's 25%), and a request to start future work from `main`.

## Review focus

Main's own corrections since September survive; the three-way classification; units (fatality in percent, durations in
days) against the registry's bounds; how the changed dengue and RSV values reach a simulation (R0 calibration,
durations, the web export, the review list).
