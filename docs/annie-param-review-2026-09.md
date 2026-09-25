# Parameter review — September 2026

Annie, your influenza, meningococcal, hepatitis A, Ebola and pertussis work
is now on `main` in the normalized schema. That is roughly 80 cited
estimates, and it is the single biggest thing standing between EpiChat and a
credible student pilot. Thank you.

Three values came in **without numbers**, marked `status: "under_review"`.
The agent tells a student there is no source for them rather than simulate
something misleading. Each needs your call.

## 1. Meningococcal infectious period

**Imported as:** no numeric consensus. Your value was min 1 / typical 1 / max 1 day.

The one-day figure is the public-health rule that a case stops being
infectious about 24 hours after effective antibiotics. That measures
treatment policy, not transmission. A model needs how long an infectious
person actually transmits, which for meningococcus is driven by asymptomatic
nasopharyngeal carriage rather than by the treated illness — a duration this
database does not yet hold a sourced value for. Simulating one day would make
outbreaks die out far too fast.

**Needed:** an infectious or carriage duration with a citation, and a note
saying which of the two it describes.

## 2. Influenza fatality rate

**Imported as:** no numeric consensus. Your value was min 0.001 / typical 0.07 / max 13.5%.

The minimum and typical look right for seasonal influenza. The 13.5%
maximum is about two hundred times the typical value, which suggests a
case-fatality rate among hospitalized patients, or a pandemic subtype such
as H5N1, rather than a population rate.

**Needed:** confirm the denominator. If it is a hospitalized cohort, either
drop it from the consensus range and keep it as a scoped estimate, or split
seasonal from pandemic influenza.

## 3. Hepatitis A immunity duration

**Imported as:** no numeric consensus. Your value mixed `"7300"` (a string),
`"lifelong"`, and a sentence contrasting natural with vaccine-induced
immunity.

The schema needs `min` / `max` / `typical` to be numbers or null so the
simulation can use them. Qualitative text belongs in `special_value`, which
the agent reads and can quote to a student.

**Needed:** numeric days where a number is defensible (20 years = 7300 is a
reasonable floor), with the natural-versus-vaccine contrast in
`special_value`.

## Current coverage

```
disease        r0       incubati infectio fatality average_ immunity asymptom
------------------------------------------------------------------------------
measles        ok       ok       ok       ok       ok       cites    cites
covid19        ok       ok       ok       ok       cites    ok       ok
mumps          ok       ok       ok       ok       -        cites    ok
rubella        ok       ok       ok       ok       -        cites    ok
varicella      ok       ok       ok       ok       -        cites    -
pertussis      ok       ok       ok       ok       ok       ok       ok
influenza      ok       ok       ok       review   -        ok       ok
meningococcal  ok       ok       review   ok       -        ok       ok
hepatitis_a    ok       ok       ok       ok       -        review   ok
ebola          ok       cites    ok       ok       -        ok       ok
dengue         ok       ok       ok       -        -        -        -
rsv            ok       ok       ok       -        -        -        -
cholera        ok       ok       ok       -        -        -        -
polio          ok       ok       ok       -        -        -        -
tuberculosis   ok       ok       ok       -        -        -        -
mpox           ok       ok       ok       -        -        -        -
------------------------------------------------------------------------------
-: 32  cites: 7  ok: 70  review: 3   (of 112)

held back pending review:
  influenza.fatality_rate: Maximum of 13.5% is far above any population-level influenza CFR and looks like a hospitalized-cohort or pandemic-subtype figure.
  meningococcal.infectious_days: Consensus of 1/1/1 day encodes the public-health rule that a case is non-infectious ~24 h after effective antibiotics - not the untreated infectious period or the carriage duration that drives transmission.
  hepatitis_a.immunity_duration: Consensus mixes a numeric string ('7300') with qualitative text ('lifelong', and a sentence contrasting natural with vaccine-induced immunity).
```

Re-run it any time: `py -3.10 scripts/param_coverage.py`

## How to make a change

1. Branch from `main` — not from `feature/pipelines`. That branch's file
   predates the current schema and can no longer be merged.
2. Edit `epichat/data/disease_parameters.json`.
3. Run `py -3.10 -m pytest tests/test_disease_parameters.py -q` before you
   push. It catches typos like `concensus`, strings where numbers belong,
   ranges that are out of order, and estimates with no citation.
4. Push. GitHub Actions runs the whole suite and shows a red ✗ within a
   minute if anything is wrong.

To clear an `under_review` flag: replace the `null` consensus values with
numbers, delete the `status` and `review_note` keys, and add the estimate
that backs them.

## Still open from August

- Rotate the US Census ACS API key that is in this branch's history.
