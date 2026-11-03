# Parameter review — November 2026

Annie, your October work is now on `main`: dengue and RSV in full, your Ebola revisions, and the smaller fixes to
measles, rubella, varicella and meningococcal. That is 24 parameters and 41 more cited estimates (178 to 219). Dengue
and RSV each had three values and no estimates behind them; now both have cited estimates for everything but daily
contacts. Thank you.

It came across with `scripts/port_annie_parameters.py` (round 2, from your commit `f295ccc`), parameter by parameter,
because your branch is far behind `main` and its copy of the file does not parse. Nothing you changed was overwritten
by `main` in the meantime.

## Seven things need your call

**1. Meningococcal infectious period (still held back).** Your new value is 1 to 8 days, typical 8. That is a treated
case's infectious window as public-health guidance defines it: 7 days before onset to 24 hours after antibiotics.
Transmission is driven by how long an untreated person, or a carrier, stays infectious, so the simulation still gets
no number here. Needed: an infectious or carriage duration with a citation, and a note saying which it is.

**2. Dengue fatality (new, held back).** The range runs from 0.05% to 25%. The 25% comes from a case series of
patients in an ICU, not a population case fatality; the other two estimates are surveillance figures. Same rule as
influenza in September. Needed: the ICU estimate scoped to the population it describes, or left out of the range.

**3. RSV fatality (new, held back).** The typical 0.31% is deaths per lower-respiratory-infection episode in children
under 5, and the 1.7% maximum is an inpatient case fatality. The simulation counts every infection as a case, so either
would overstate deaths, by an order of magnitude or more in a whole-population run. Needed: a fatality per infection, or
the estimates scoped to the population and denominator they describe.

**4. RSV infectious period (new, held back).** The typical 11.2 days has no citation, and both cited estimates give 6.5
days (range 4 to 10). 11.2 looks like a PCR shedding duration, which your dengue note rightly says must not stand in
for the infectious period. Needed: a transmission window with a citation, or the shedding figure scoped as shedding.

**5. Ebola contacts (not ported).** Your two estimates (10.6 and 8.5) are contacts traced per case, but the parameter
is contacts per day, so they would read as daily contacts. Needed: a contacts-per-day figure, or tell us where
contacts per case should live.

**6. Influenza fatality, maximum 13.5% (open since September).**

**7. Hepatitis A immunity (open since September):** a numeric value, with "lifelong" moved to `special_value`.

Two smaller questions, ported as you had them: dengue's R0 typical of 6.16 is the midpoint of its range and sits above
every point estimate it includes (2.99, 3.44, 5.44); and RSV's R0 minimum of 0.92 is, by your own note, an effective
reproduction number rather than R0.

## Small things we changed on the way in

- Bylsma 2022's RSV fatality estimate had its value as text ("0.85"); it is in as the number 0.85.
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
