# Parameter review — November 2026

Annie, your October work is now on `main`: dengue and RSV in full, your Ebola revisions, and the smaller fixes to
measles, rubella, varicella and meningococcal. That is 24 parameters and 40 more cited estimates (178 to 218). Dengue
and RSV each had three values and no estimates behind them; now both have cited estimates for everything but daily
contacts. Thank you.

It came across with `scripts/port_annie_parameters.py` (round 2, from your commit `f295ccc`), parameter by parameter,
because your branch is far behind `main` and its copy of the file does not parse. Nothing you changed was overwritten
by `main` in the meantime.

## Five things need your call

**1. Meningococcal infectious period (still held back).** Your new value is 1 to 8 days, typical 8. That is a treated
case's infectious window as public-health guidance defines it: 7 days before onset to 24 hours after antibiotics.
Transmission is driven by how long an untreated person, or a carrier, stays infectious, so the simulation still gets
no number here. Needed: an infectious or carriage duration with a citation, and a note saying which it is.

**2. Dengue fatality (new, held back).** The range runs from 0.05% to 25%. The 25% comes from a case series of
patients in an ICU, not a population case fatality; the other two estimates are surveillance figures. Same rule as
influenza in September. Needed: the ICU estimate scoped to the population it describes, or left out of the range.

**3. Ebola contacts (not ported).** Your two estimates (10.6 and 8.5) are contacts traced per case, but the parameter
is contacts per day, so they would read as daily contacts. Needed: a contacts-per-day figure, or tell us where
contacts per case should live.

**4. Influenza fatality, maximum 13.5% (open since September).**

**5. Hepatitis A immunity (open since September):** a numeric value, with "lifelong" moved to `special_value`.

## Small things we changed on the way in

- Your `pmid` field became a note ("PMID 25390569") on the estimate, which already has its URL.
- A measles fatality estimate had the range [0.07, 2.08] around a value of 2.21; your edit clearing it is in.

## For next time

Please start new work from the current `main` rather than `feature/pipelines`:

```
git fetch origin
git checkout -b params-<topic> origin/main
```

On `main` the file is valid JSON in the normalized schema, and `pytest tests/test_disease_parameters.py` checks every
edit (keys, units, plausible values, citations). Then your changes can be merged as they are, with no port.
