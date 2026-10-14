# EpiChat Simulation Parameters, Part 2 Follow-up: Limits on Spread, Suggested Interventions, the Parameters Section and Chosen References (Design)

Date: 2026-10-13. Status: confirmed by the owner on 2026-10-13 (the proposals of
section 17 included); phases A to E shipped, with the amendments marked "as
shipped".
Builds on Part 1, `docs/superpowers/specs/2026-10-09-sim-parameters-disease-design.md`,
and Part 2, `docs/superpowers/specs/2026-10-12-sim-parameters-modules-design.md`
(phases 2A to 2D shipped on 2026-10-13). Where this document and either part
disagree, this document wins. Part 3 (calibration to a case series with
Starsim's `Calibration` module) keeps its name and is not this round.

## 1. Purpose

The owner tested the deployed Part 2 on 2026-10-13 and reported four things.

1. "As R0 is larger than 1, eventually all the susceptible will become
   infected at the end. There is no mechanism to limit the reproduction number
   over time. The network module does not limit this, and when there is no
   intervention, `rel_sus` and `rel_trans` are always set to 1."
2. The Dashboard's Parameters section does not show all the parameters; it
   does not show the network category.
3. After a run the agent offers parameter adjustments to rerun; it does not
   suggest interventions.
4. Can a user click a source in the Data section to use that source's value?

This round answers each: two mechanisms that limit spread without a dated
intervention (section 4 and 5), fitting with them (6), interventions offered
after a run (7), a Parameters section generated from the registry (8), and a
reference a user can choose (9).

A fifth item, the Data section's column header (Status to References), was
done on 2026-10-13 (commit `75db90c`).

## 2. Decisions made on 2026-10-13

By the owner:

1. Both limiting mechanisms come in: variation between people, and a
   behaviour response.
2. The behaviour response relaxes as cases fall; caution does not persist
   once triggered.

Proposed here, for the owner to confirm or overturn at the review (they are
repeated as questions in section 17):

3. The variation is in susceptibility only, not in contact activity (4.1).
4. Both mechanisms are off by default. The agent offers them; it never
   switches them on silently (4.5, 5.5).
5. The behaviour response is an entry of the `interventions` list, type
   `behavior_response` (5.1).
6. The behaviour response is uniform across the hybrid layers in this round.
7. The illustrative values the agent offers: a coefficient of variation of 1;
   a response of up to 50%, half of it at 1% infectious, 7-day memory.
8. Suggested interventions travel as levers of a diagnostic, so no database
   migration is needed (7.1).
9. A chosen reference is applied through the agent, not by the panel writing
   the scenario directly (9.2).

## 3. What the test showed

Measured on 2026-10-13 (10,000 agents, two years, 50 seeds, gamma infectious
period of 10 days, no interventions; the script is not part of the
repository):

| R0 | Random network | Hybrid network | Final-size equation |
|---|---|---|---|
| 1.5 | 58.1% | 59.4% | 58.3% |
| 2.0 | 79.3% | not run | 79.7% |
| 2.5 | 88.9% | 87.3% | 89.3% |
| 4.0 | 98.0% | not run | 98.0% |

A random network whose contacts last 30 or 365 days gave 94% at R0 2.5.

The share infected is fixed by R0 through the final-size equation
`z = 1 − exp(−R0 z)`, on every network the product has. The reason is the one
the owner gave: transmission per contact is `beta × rel_trans(source) ×
rel_sus(target)`, and with no intervention both multipliers are 1 for
everyone, so the only brake is the depletion of susceptibles, `R_t = R0 × S/N`.
The hybrid network changes who meets whom; at the same R0 it does not change
how many are reached. Part 2's thesis (real contact networks are limited) is
therefore not delivered by the network module, and this round delivers it by
other means.

## 4. Variation between people in susceptibility

### 4.1 The parameter

| Path | Kind, unit | Default | Bounds | Models | Tier | Starsim target | Affects |
|---|---|---|---|---|---|---|---|
| `disease.rel_sus_cv` | number, coefficient of variation | 0 | 0 to 2 | all | advanced | a per-agent state `rel_sus_ind`, gamma with mean 1 and this coefficient of variation | final_size, peak |

Each agent carries a personal susceptibility multiplier drawn once, when the
agent is created (births included), from a gamma distribution with mean 1 and
variance `cv²` (shape `1/cv²`, scale `cv²`). With `cv = 0` the state is the
constant 1 and nothing is drawn, so every existing scenario runs as before
and the parity baseline does not move.

The most susceptible agents are infected first, so the susceptibility of
those who remain falls faster than their number: the epidemic slows sooner
and ends smaller, at the same R0.

Why susceptibility and not contact activity (decision 3): a multiplier with
mean 1 that does not touch infectiousness leaves R0 unchanged, so the R0
formula, the measured R0 and every stored R0 keep their meaning. Variation in
activity would scale `rel_trans` as well, raise R0 by `1 + cv²`, and bias the
measured R0 (uniformly chosen seeds are not typical early cases).

### 4.2 Composition

The susceptibility composition of Part 2 section 4.2 gains one factor, in the
disease's own `compose_rel_sus`:

    rel_sus = rel_sus_base (age) × rel_sus_ind × vaccine_protection × (1 − SIS immunity)

Nothing else writes `rel_sus`. `rel_trans` is untouched by this mechanism.

### 4.3 R0, and saturation on the random network

`approx_r0`, `calibrate_beta` and their TypeScript mirrors do not change: the
multiplier's mean is 1.

- Age-structured network: exact. Starsim's mixing pools infect a target with
  probability `force × rel_sus(target)`, and the force is small while R0 is
  being defined, so the multiplier enters linearly.
- Random network: Starsim draws each contact with probability `q × x`,
  `q = network_beta × (1 − exp(−beta/365))` and `x` the target's multiplier,
  which cannot exceed 1. The share of the configured R0 lost to that cap is
  `1 − E[min(x, 1/q)]`:

  | Per-contact probability `q` | CV 0.5 | CV 1 | CV 2 |
  |---|---|---|---|
  | 0.0625 (R0 2.5, 4 contacts, 10 days) | 0.0% | 0.0% | 0.5% |
  | 0.125 (R0 5) | 0.0% | 0.0% | 5.7% |
  | 0.2 | 0.0% | 0.7% | 14.5% |
  | 0.47 (measles-like: R0 15, 4 contacts, 8 days) | 1.0% | 11.9% | 39.0% |

  The service computes the loss with the regularized incomplete gamma
  function (`scipy.special.gammainc`; `E[min(X, c)] = P(k+1, c/θ) + c (1 −
  P(k, c/θ))` for shape `k`, scale `θ`, `kθ = 1`). When it exceeds 2%
  (`SATURATION_LOSS`, a named constant) and `run.calibrate_r0` is on, the
  Part 2 pilot (5.7) runs and corrects beta to the measured R0, exactly as on
  the hybrid network; the run reports `stats.r0_calibration` and
  `applied.beta_calibrated_by_measurement`. Below 2% no pilot runs.
- Hybrid network: already approximate; the pilot already runs.

The rule lives in `needs_calibration` (the service). `r0_is_approximate`, the
web mirror and the panel's R0 label are unchanged.

As shipped, after the review of phase A. Two things differ from the text
above.

- On the random network with fresh daily contacts no pilot runs for
  saturation. The loss is a closed form, so beta is solved by bisection until
  the formula less the loss is the target (`calibrate_by_formula`); the run
  still reports `stats.r0_calibration` (`measured` is the closed form at the
  beta kept, `se` is 0) and `applied.beta_calibrated_by_measurement`. A target
  the registry's bound cannot give ends at the bound with `reached` false. A
  measles-like scenario (R0 12, 4 contacts, an 8-day period) has a per-contact
  probability of 0.40; with a coefficient of variation of 1 its loss is
  e^(−2.5), 8.2%, and beta rises by 16%; four pilots of the result read 11.5,
  11.5, 12.7 and 12.3, mean 12.0. For a coefficient of 1 the loss is exactly
  e^(−1/q), which the tests check. The pilot was tried first and dropped
  there: one reading at a coefficient of 2 is off by about 5%, more than the
  loss it was correcting (at R0 4 it left the run 8% high where doing nothing
  left it 3.6% low).
- The pilot (the first-generation experiment of
  `docs/superpowers/plans/2026-10-13-pilot-measured-r0.md`, which still runs
  on the hybrid network and with lasting contacts) weighs each infection by
  the susceptibility that is left, not by the number of susceptibles. Its
  seeds infect the most susceptible first, so a weight that counts heads read
  0.91 of the true R0 at a coefficient of 1 and 0.75 at 2, and the
  calibration raised beta by as much. The disease records the susceptibles'
  mean multiplier at each step and the weight is multiplied by its ratio to
  the starting mean. On the random network at R0 2.5, where the truth is
  known, the pilot now reads 2.43 to 2.50 at a coefficient of 1 and 2.42 to
  2.46 at 2 (truth 2.48). On the hybrid network at R0 2.5 the calibrated beta
  is 5.26, 5.67 and 6.83 at coefficients of 0, 1 and 2: the rise is the loss
  to repeated household, school and workplace contacts. Without variation the
  weight, and so every run, is what it was.

### 4.4 The expected final size

With gamma-distributed susceptibility the final-size equation has a closed
form, `z = 1 − (1 + cv² R z)^(−1/cv²)`, which tends to the homogeneous
`1 − exp(−R z)` as `cv` tends to 0:

| R0 | CV 0 | CV 0.5 | CV 1 | CV 2 |
|---|---|---|---|---|
| 1.5 | 58% | 49% | 33% | 14% |
| 2.5 | 89% | 80% | 60% | 29% |
| 4.0 | 98% | 93% | 75% | 39% |

`final_size(r)` in the diagnostics becomes `final_size(r, cv)` with this
form, so `final_size_gap` compares a run with the size its own configuration
predicts and does not fire on every run with variation.

As shipped, measured in the product at 50,000 agents and R0 2.5: 89.7%
infected with no variation and 60.7% with a coefficient of variation of 1,
against 89.3% and 60.0%. The multiplier's mean and coefficient of variation
read 1.002 and 0.497, 1.003 and 0.995, 1.001 and 1.997 for 0.5, 1 and 2. A
calibrated run's R0 in the diagnostics is the calibration's target, since its
beta is no longer the formula's.

### 4.5 Source, agent rule, user path

- Automatic source: none today. `susceptibility_variation` is requested from
  the database (section 11).
- Agent rule: off by default. The agent offers it when a diagnostic's lever
  carries it (7.6), when the user asks why so many were infected, or when the
  user knows the real attack rate and it is far below what R0 predicts (6).
  The value it offers is 1 (the exponential case) unless the database carries
  one, and it is labelled an illustrative assumption in the limitations.
- User path: the `advanced` patch, `{"disease.rel_sus_cv": 1}`;
  `describe_parameters` lists it; the panel's Disease group shows
  "Variation in susceptibility: CV 1".

## 5. Behaviour response

### 5.1 The entry

A new type in the `interventions` list (decision 5), one entry per scenario:

| Type | Fields (default) | Starsim |
|---|---|---|
| `behavior_response` (new) | `scale` (the largest reduction, 0 to 1; 0.5 when the agent offers it), `half_prevalence` (0.01: the share infectious at which half of `scale` applies; 0.0001 to 0.5), `memory_days` (7; 1 to 90), `start_day` (0), `end_day` (null: the run's end); `layer` must be `all` | one more factor of the `TransmissionModifiers` connector |

Aliases accepted on input: `behaviour_response`, `behavior`, `behaviour`,
`behavior_change`, `awareness`.

It sits in the interventions list because it shares everything an
intervention entry has: a window, the upsert by type, `remove_interventions`,
a line in the panel's Interventions list, the pilot that runs without
interventions, and the offer after a baseline run (section 7). It is not a
policy; the panel and the agent call it "behaviour response", never "an
intervention the authorities imposed".

### 5.2 Mechanics

Once per step, where the connector already composes transmissibility:

    P(t)      = mean over the last memory_days steps (today included) of infectious agents / agents alive
    factor(t) = 1 − scale × P(t) / (half_prevalence + P(t))        inside the window, 1 outside
    rel_trans = rel_trans_base × treatment factor × seasonal factor × dated reductions × factor(t)

- The same factor applies to everyone that day.
- `rel_sus` and the base values are untouched. A contact transmits with the
  source's `rel_trans` times the target's `rel_sus`, so a population-wide
  factor on one side is the whole effect; on both it would be applied twice.
- As prevalence falls the factor returns to 1 by itself (decision 2).
- The run's stats gain `behavior: {min_factor, min_day}`: the strongest
  reduction reached and its day, so the agent can say "transmission fell by
  up to 47% around day 55".

### 5.3 What it does, and what it cannot do

As shipped, measured in the product (R0 2.5, 10,000 agents, a gamma infectious
period of 10 days, 50 seeds; the draft's table was a deterministic sketch with
a flatter baseline):

| Response | Peak infectious | Infected by 1 year | By 2 years |
|---|---|---|---|
| None | 39% | 89% | 89% |
| Up to 40%, half at 2% infectious | 18% | 70% | 70% |
| Up to 50%, half at 1% (the value the agent offers) | 10% | 58% | 58% |
| Up to 60%, half at 1% | 6.7% | 56% | 59% |
| Up to 80%, half at 0.5% | 2.1% | 35% | 48%, still spreading |

The response flattens the peak, stretches the epidemic and removes the
overshoot. Because it relaxes as cases fall, the long-run total drifts toward
the herd immunity threshold `1 − 1/R0` (60% at R0 2.5) and cannot go far
below it (58% in the table: the last chains die out a little early). A run
that ends well below the threshold, like the last row, has not finished.
Going well below the threshold for good is what the variation of section 4
does, which is why the round has both.

### 5.4 R0, the pilot and the diagnostics

- R0 is unchanged: at the start nobody is infectious, so the factor is 1.
- The pilot of Part 2 (5.7) already runs the scenario without its
  interventions, so it runs without the response.
- The measured R0 of a run with the default 1% seeding is lower than the
  configured one, because the response is already engaged on day 0. `r0_gap`
  stands down while a behaviour response is active from day 0, as it does for
  an early treatment. As shipped: both stand-downs hold on a calibrated run
  too (the review found the calibration's target returned before them), last
  for as long as the seeds transmit (the latent plus the infectious period),
  and a calibrated run's reference takes the day-0 seasonal factor and the
  initial immunity like any other run's, since the pilot measures without
  them and the live run with them.
- `final_size_gap` stands down while a behaviour response is in the scenario:
  no closed form predicts its size.

### 5.5 Source, agent rule, user path

- Automatic source: none today. `behaviour_response_effect` is requested from
  the database (section 11).
- Agent rule: off by default; offered after a baseline run (7.2) and through
  the `well_mixed` lever (7.6); every value is an illustrative assumption and
  is said to be one in the limitations. The agent explains the limit of 5.3
  in one sentence when it reports a run with a response.
- User path: `configure_simulation`'s `interventions` field,
  `{type: behavior_response, scale: 0.5}`; `remove_interventions:
  ["behavior_response"]`. The panel line reads "Behaviour response:
  transmission falls by up to 50% as infections rise (half of that at 1%
  infectious, 7-day memory)".

## 6. Fitting with the new levers

Part 2's fit (7.7) moves beta until one known outcome is reached, which
lowers R0 and slows the early growth with it. With the two mechanisms a user
who knows both R0 and the real attack rate can keep R0.

`run.fit.lever` gains two choices:

| Lever | Bounds | As it rises | Targets |
|---|---|---|---|
| `disease.beta` (default, unchanged) | registry | attack rate and peak rise, peak day falls | all three |
| `network.network_beta` (unchanged) | registry | the same | all three |
| `disease.rel_sus_cv` (new) | 0 to 2 | attack rate and peak fall | `attack_rate`, `peak_infections` |
| `behavior_response.scale` (new) | 0 to 0.95 | attack rate and peak fall | `attack_rate`, `peak_infections` |

- The search of Part 2 (the current value first, doubling or halving until the
  target is bracketed, geometric midpoints, at most eight runs) is unchanged
  but reads its direction from the lever. A lever at 0 starts at 0.5. As
  shipped: a lever whose lower bound is 0 takes arithmetic midpoints and, when
  halved below 0.02, goes to 0; a run that faded out means such a lever is too
  high. In the tests' scenario (R0 about 2.3) a variation of 0.875 gives 61%
  infected in four runs and a response of up to 30% gives 70% in three. A
  fade-out is a run that infected under twice its seeds; the peak staying
  under twice the seeds counts only for a peak day, because a behaviour
  response holds the peak down while the infections go on (the review found
  a response turned back at 0.6 for a 10% target it reaches at 0.78).
- `behavior_response.scale` needs a behaviour-response entry in the scenario;
  without one the validator says so.
- `peak_day` with either new lever is refused with a message naming the two
  beta levers.
- A fit on a new lever does not set beta, so it does not replace the R0
  pilot: on a network where the pilot runs, the pilot runs first and the fit
  follows. (Part 2's rule, the fit supersedes the pilot, stays for the two
  beta levers.) As shipped: that holds for the behaviour response, which the
  pilot runs without. The pilot and the closed form of 4.3 depend on the
  variation, so a fit on `disease.rel_sus_cv` calibrates beta at every value
  it tries, and the fitted run is the run a plain scenario with the fitted
  coefficient gets. On the hybrid network at R0 2.5 a fit to 30% infected
  with one calibration before it reported 30% at a coefficient of 2 with a
  real R0 of 2.1; calibrated at each trial it ends at the bound with 36%
  infected and R0 2.6 on a fresh seed, which says the target is out of reach
  with R0 where it is. A measles-like scenario fitted to 80% infected ends at
  a coefficient of 1.5 with beta raised from 186 to 347 and R0 12.
- `stats.fit` is unchanged; `run_simulation` notes
  `rel_sus_cv_fitted_to_attack_rate` or `behavior_response_fitted_to_attack_rate`.
- Agent rule: when the user gives a known attack rate or peak size and the R0
  came from the database or from the user, fit `disease.rel_sus_cv` and say
  so ("the variation between people was set so that 30% are infected; R0
  stays 2.5"). Beta remains the lever when the user says R0 itself is unknown.

## 7. Suggested interventions after a run

### 7.1 A lever may carry interventions

Today a diagnostic's lever is a patch of parameter paths, and the `advanced`
patch refuses `interventions[]` paths, so no diagnostic can propose an
intervention. `Lever` gains two optional fields:

- `interventions`: a list of intervention entries, applied with
  `configure_simulation`'s `interventions` field.
- `label`: a complete reply of at most 80 characters, used for the button and
  the suggested reply ("Close schools from day 20 for six weeks and rerun").

A lever may carry a patch, entries, or both. Stored diagnostics without the
fields read as before. Because suggestions are levers, they are stored in
`runs.diagnostics`, shown and chosen through the events that exist
(`diagnostic_shown`, `option_chosen`), and need no migration (decision 8).

### 7.2 The `what_if` diagnostic

`what_if` (severity `info`, title "Interventions to try") fires on a run that
had an epidemic: not when `early_fadeout` fired, and not when the attack rate
is under 5%. Its levers are the candidates below that the scenario does not
already have (by type, and layer for contact reductions), at most four, in
this order:

| Candidate | Offered when | Entry | Size |
|---|---|---|---|
| Vaccination campaign | the disease has a routine-immunization indicator, and no vaccine entry | `vaccine`, `kind: campaign`, coverage 0.7, anchor to anchor + 30 | efficacy from the database when it carries one, else 0.9 (illustrative) |
| School closure | the hybrid network, and school-age agents exist | `contact_reduction`, `layer: school`, `scale: 1`, anchor to anchor + 42 | a full closure (illustrative) |
| Distancing | always | `contact_reduction`, `layer: community` on the hybrid network, `all` elsewhere, `scale: 0.3`, anchor to anchor + 56 | illustrative |
| Masks | always | `transmission_reduction`, `scale: 0.2`, anchor to anchor + 90 | illustrative |
| Behaviour response | no behaviour-response entry | `behavior_response`, `scale: 0.5`, defaults of 5.1 | illustrative |

- The anchor is the first day the run's cumulative infections reached 1% of
  the agents (`ANCHOR_SHARE`): when the outbreak would have been noticed.
- Every size is a named constant at the top of the module. When the database
  gains the effect sizes requested in Part 2 (school closure, distancing,
  masks), the module reads them and the lever's basis becomes `disease_db`.
- The list of diseases with a routine-immunization indicator lives in one
  place the service and the web share (today it is written twice, in
  `fetchVaccinationCoverage.ts` and in the frozen Python agent); it is
  exported to the web like the registry and a test keeps the two equal.
- Treatment is not a candidate in this round: its capacity comes from the
  health-system fetch, where the agent already adds it.

As shipped. The labels are "Vaccinate 70% in a campaign from day A to day B
and rerun", "Close schools from day A for six weeks and rerun", "Cut
(community) contacts by 30% from day A for eight weeks and rerun", "Add masks
(20% less transmission) from day A for 90 days and rerun" and "Let people
become careful as cases rise and rerun". A window never passes the run's last
day. With the default 1% seeding the anchor is day 0. A routine vaccine from
day 0 is held as initial immunity and leaves no entry, so a campaign is still
offered on top of it. The database carries no vaccine efficacy yet, so the
campaign's is the illustrative 0.9. The list of indicators is
`epichat/params/indicators.py`, exported as `web/data/vaccine_indicators.json`;
the frozen agent keeps its copy and a test compares the two. `what_if` comes
last among a run's diagnostics; a lever without entries or a label is sent
exactly as before. The service's levers are exported
(`web/tests/fixtures/what_if_levers.json`) and a web test feeds each one
through `configure_simulation`.

Two things the review of phase B added. On a scenario with `run.fit`, the next
run fitted an added intervention away (a baseline fitted to 45% infected
still showed 45% with distancing; 29.5% once the fit was held). So a change to
the interventions after a fitted run now ends the fit and writes the fitted
value into its lever (`configure_simulation` says so in its warnings; a fitted
beta also switches the measured-R0 calibration off, which would otherwise
move it); a call that passes `fit` fits again with the change in place.
`well_mixed` stands down on a fitted run. And `r0_gap` stands down while a
dated contact or transmission reduction covers the seeds' infectious period,
which the day-0 anchor of the default seeding makes the usual case.

### 7.3 The agent's order of offers

The prompt's "Diagnostics and options" section becomes "After a run":

1. A `warning` diagnostic fired: offer its options first, and no
   intervention. A baseline that is broken is fixed before it is compared.
2. Otherwise: report the run, then offer up to two `what_if` levers by their
   labels, plus "Create a report". Say in one sentence that the effect sizes
   are illustrative.
3. After a run with an intervention: report the comparison (`compare`, as
   today) before interpreting, then offer another `what_if` lever or the
   report.

The limit of three suggested replies stays.

As shipped. Rule 2 left no reply for the lever of another info diagnostic
(`well_mixed`'s variation, a fatality or reinfection note, an R0 recheck).
When one fired, the agent gives one of the two intervention replies to its
first lever; the buttons already show the `what_if` labels.

### 7.4 The run card's buttons

Under the run's summary in the conversation, the latest run shows up to three
`what_if` labels as buttons ("Try next"). Pressing one sends its label as the
user's message. The buttons do not depend on the model choosing to mention
them. They are absent on the public share page and on earlier runs.

`suggestion_used` gains the source `option` for these buttons, and
`reference` for section 9.

As shipped. The buttons belong to the last successful run of the last turn;
once a turn passes without a run they are gone. They are not rendered while a
reply streams, nor on a run that raised a warning diagnostic: 7.3 has the
agent offer the warning's options and no intervention, and the card follows
it. They were tested by rendering the components to markup, not in a
browser.

### 7.5 Recording

`diagnostic_shown` lists `what_if` among its ids as it lists any diagnostic.
`matchedLevers` learns to match a lever with entries: every entry of the lever
is in the new scenario (same type and layer, the lever's fields equal) and
the call changed the interventions. `option_chosen` then records the lever as
today, with the entries in its meta.

As shipped. An entry counts only when the call put it there (in the new list
and not in the old one), so a later change to another entry does not record
the lever again; every lever whose entries one call added is recorded.

### 7.6 `well_mixed`, broadened

Section 3 shows the diagnostic's premise (the random network is the problem)
was wrong: every network infects nearly everyone at the same R0. `well_mixed`
keeps its id, fires on every network when the effective R is at least 2 and
more than 70% were infected, stands down when variation or a behaviour
response is already set (and, as today, when a contact reduction is), and
offers, in order:

1. `disease.rel_sus_cv` at 1 (illustrative): variation between people.
2. A behaviour-response entry (illustrative).
3. On the random network only: the hybrid network, as the structure that
   school closures and distancing act on, with the sentence it already
   carries (the switch alone does not lower the final size).

As shipped. The title is "Nearly everyone was infected: only the depletion of
susceptibles limits this epidemic"; the three levers carry the labels "Add
variation between people (CV 1) and rerun", "Let people become careful as
cases rise and rerun" and "Switch to the hybrid network and rerun".

## 8. The Parameters section

### 8.1 What is wrong

The section renders `parameterRows`, a hand-written flat list of under
thirty rows. The registry has 90 parameters. Of the 27 network parameters the
section shows at most four, and nothing is grouped.

### 8.2 The registry says where a parameter applies

`ParamSpec` gains `networks` (empty: every network), beside `models`:
`n_contacts`, `contacts_dist` and `contact_duration_days` on `random`; the
nine `contacts.*` cells and `contacts_source` on `age_structured`;
`household_size`, the three layer contact counts, the four `layer_beta`
values and the four age bounds on `hybrid`; `network_beta` everywhere.

### 8.3 Groups and rows

`parameterGroups(params, sources)` replaces `parameterRows`. Five groups in
the registry's module order: Disease, Contact network, Demographics,
Interventions, Run.

- A row has a label, a value in words with its unit, the registry paths it
  covers, and a source tag (8.4). A row may cover several paths: a duration
  is one row (mean, distribution, sd), so are the seeding, the age shares,
  the contact matrix (a 3 by 3 grid) and the hybrid layers (a small table of
  contacts and transmissibility per layer).
- Each group shows by default its core parameters and every parameter whose
  value is not the registry default. "Show all (N)" opens every parameter
  that applies to the scenario's model and network.
- The derived rows stay: "R₀ (approx.)" at the top of Disease, "Fitted to"
  in Run. The Interventions group is today's list of lines.
- A test walks the registry: every parameter that applies to a scenario is
  covered by exactly one row of the opened groups. A parameter added to the
  registry without a row fails the test, so the section cannot fall behind
  again.

### 8.4 Where each value came from

Each row carries the tag `describe_parameters` already computes: database,
fetched, default, assumption, you, and (section 9) reference. The server
computes the tags with `valueSources` and sends them: `ConfigPayload`,
`DataPayload` and `RunPayload` gain `sources`, a map from path to source.
Payloads stored before this round have none and render without tags.

### 8.5 The same list elsewhere

- `describe_parameters` filters by network as well as by model, so it stops
  listing the hybrid layers on a random-network scenario.
- The report's appendix lists the same rows (core and non-default, by group)
  instead of `EFFECTIVE_PARAM_PATHS`, which today prints Household size,
  Contact duration and Contact matrix on every run.

As shipped (phase C).

- The rows live in `web/lib/client/parameters.ts`: 39 rows (one of them the derived R₀) over the 74
  parameters that are not fields of an intervention entry. The labels of
  rows that existed are kept ("Exposed period", "Death probability").
- "Show all (N)" is a `details` element per group, so it works on the share
  page without script; N is the group's row count.
- A row appears only when its parameter applies to the model: a seiar
  scenario that carries an immunity duration no longer lists it.
- The tags, as the review of phase C left them. The word for a value set in
  the conversation is "set in chat", not "you": the page cannot tell what
  the user typed from what the agent chose or a tool computed (the beta that
  holds an R0, a fitted value that was kept), and "you" claimed the first. A
  value the run itself changed (a calibrated beta, a fitted lever,
  demographics the service filled) is "set by the run". A row whose values
  have several sources shows each one, so a database mean with an assumed
  spread reads "database, assumption". The payloads send only the sources
  that are not defaults (a tenth of the whole map); with sources present, a
  path that was not sent is a default. The coefficient of variation the
  agent offers (1) reads as an assumption.
- The contact matrix is in the default view on the age-structured network
  whatever its values: it is the only description of the contacts there.
- "Random seed" reads "1 (not set)" when unset: the service runs seed 1.
- In the report's table a row that any run shows carries every run's own
  value, and a dash only where the row is not a parameter of that run's
  model or network. The interventions are one row when a run has any. A row
  the section draws as a grid (the matrix, the layers) is written out in
  full there and in the runs panel. Neither list has the derived R₀: the
  formula on a run's own, possibly calibrated, beta is not the R0 the
  report states. A second test changes every parameter and fails when its
  row does not move.
- A stored run whose parameters no longer validate (a ten-year infectious
  period was legal in the first schema) still opens in the runs panel, with
  a sentence in place of its list.
- `describe_parameters` names the network it lists and says the other
  networks' parameters appear once `network.network_type` changes.
- `describe_parameters` with `module: interventions` lists the fields of an
  intervention entry, which no listing gave before.

## 9. Choosing a reference

### 9.1 What exists

In the Data section each parameter has a "N sources" button that opens a
numbered list: the consensus source, then every estimate with its value,
year, country and a link to the paper. Nothing in it can be applied.

### 9.2 The button and the path

Each estimate that has a numeric value gains a "Use this value" button. It is
absent on the public share page and disabled while a reply is streaming.
Pressing it sends a message in the user's name:

    Use reference 3 for R₀: 14 (Guerra et al., 2017).

The agent then calls `configure_simulation` with a new field,
`use_reference: {parameter, index}`, the index being the number shown in the
list. The tool, not the model, reads the estimate from the reference data on
the server, so the value and the citation cannot be mistyped.

It goes through the agent (decision 9) so that the R0 hold, the validation,
the warnings, the comparison with the previous run and the conversation's
record all stay on the one path every other change takes.

### 9.3 What the tool does

| Database parameter | Applied as | Unit handling |
|---|---|---|
| `r0` | the scenario's R0 (beta through `withR0`) | none |
| `incubation_days` | `disease.dur_exp.mean_days` | days |
| `infectious_days` | `disease.dur_inf.mean_days` | days |
| `fatality_rate` | `disease.p_death` | percentage to fraction |
| `asymptomatic_fraction` | `disease.p_asymp` | percentage to fraction |
| `average_contacts_daily` | `network.n_contacts` | rounded to a whole number |
| `immunity_duration` | `disease.dur_immune.mean_days` | weeks, months, years to days |

- The value is validated like any other: outside the registry bounds the call
  fails naming the path.
- A parameter the model does not have fails with what to do ("the sir model
  has no latent period; switch to seir first").
- An estimate with only a range, or a special value such as "lifelong", has
  no button and is refused by the tool.
- The tool returns the estimate's metric, population and notes when it has
  them, and the prompt tells the agent to say what the estimate measured
  when it differs from the parameter (an infection fatality ratio where the
  model wants a case fatality ratio; an effective reproduction number).

### 9.4 Attribution

The tool records the choice as a data source, replacing an earlier choice for
the same parameter: `{field: "ref:<parameter>", value, citation: "<title>
(<year>). <link>", description: "Chosen from the literature table"}`. It
lives in `scenarios.data_sources` with the fetched values, so no migration is
needed.

`valueSources` gains the source `reference`: a path holds it while its value
still equals the recorded one (beta by the R0 it implies), exactly as a
fetched value is a fetch only while it still equals what was fetched. The
Parameters section shows the tag with the reference's title; the report's
data-sources table lists it as a literature reference.

As shipped (phase D).

- The mapping of the seven database parameters to their paths, models and
  units is `web/lib/tools/chosenReference.ts`, shared by the tool and the
  tags. The recorded value is in the unit it was applied in (a fraction, days,
  a whole number of contacts), so the tag can tell whether it still stands.
- The message is "Use Measles reference 3 for R₀: 14 (title, 2017)." with
  the disease whose list it is and the estimate's one value. The paper's
  title is put on one line, stripped of control characters and cut to 80
  characters, and the prompt tells the agent to treat it as a label.
- `use_reference` also takes the disease and the value of the message, as
  checks. The panel lists the last disease looked up, which need not be the
  scenario's: the review applied a measles estimate from a press on the
  mumps list. The tool refuses a number from another disease's list, and a
  value the data does not have at that number (a list cached before a data
  update). The buttons show only when the list is the scenario's disease.
  The value applied is always the data's own.
- A reference for the infectious period, the contacts or the asymptomatic
  share keeps beta, as a typed value does, so R0 moves (measles at 9
  contacts a day: 15 to 34). The tool's result says so, with the old and the
  new R0, and the agent offers to set R0 again. Holding R0 instead would
  change Part 1's rule and is left to the owner.
- A chosen reference stays among the data sources only while its value
  stands. One the user overrode, or whose parameter the network no longer
  has, is dropped, so the run card and the report do not cite it for a
  scenario that runs on another value. It is not fetched data: it does not
  move the stage to "ground", and the report keeps its sentence that no real
  data was fetched.
- A field or a patch for the same value in the same call is refused, and
  the model and the network the same call sets through `advanced` count. A
  failed call no longer renames the scenario's disease.
- Contacts per day can be applied on the random network only; the other
  networks take their contacts from a matrix or from layers, and the tool
  says so.
- An R0 from a reference stands while the scenario still has that R0. A
  later change of the infectious period at the same beta is another R0 and
  drops the tag. After a run that calibrated beta, beta reads "set by the
  run"; the report's data sources still list the reference.
- An asymptomatic share is read in its disease's unit (a percentage for some
  diseases, a fraction for others).
- The button was tested by rendering the list to markup, not in a browser.

## 10. Registry, schema and migration

- Registry version 5: `disease.rel_sus_cv`; `interventions[].half_prevalence`
  and `interventions[].memory_days`; the type `behavior_response`; two more
  choices of `run.fit.lever`; the `networks` field on every parameter. All of
  it shipped in phase A, `networks` included, so the version moves once;
  phase C reads `networks`.
- Parity fixture version 6: the generator draws the variation, the
  behaviour-response entry and the new fit levers.
- `schema_version` stays 2. Every new leaf has a default; stored scenarios
  validate unchanged; the v1 parity baseline (`tests/test_sim_parity.py`) is
  not re-captured.
- `epichat/schema.py`'s `Intervention` is shared with the frozen Python
  agent: the two new fields are optional with defaults and the new type is
  additive, like the two reduction types of Part 2.
- No database migration in any phase: suggestions are levers (7.1), a chosen
  reference is a data source (9.4), and the two new sources of
  `suggestion_used` are checked by the application's schema only
  (`lib/clientEvents.ts`); no database constraint lists them.

## 11. Review requests for the database team

`scripts/review_requests.py` gains two requested fields, and
`docs/data-review-requests.md` is regenerated:

- `susceptibility_variation`: the coefficient of variation of susceptibility
  or exposure between people, as a cited range, with the population and the
  method (a household study, a serosurvey, a fitted model).
- `behaviour_response_effect`: the reduction in contacts or transmission
  observed as prevalence or deaths rose, without or before formal measures,
  as a cited range (mobility data, contact surveys).

## 12. The agent's prompt

- "Diagnostics and options" becomes "After a run" (7.3).
- A new section, "Limits on spread": the two mechanisms in one sentence each,
  when to offer them (4.5, 5.5), that both are off by default and illustrative,
  that the response cannot take the long-run total below the herd immunity
  threshold and the variation can, and the fit rule of section 6.
- "Interventions" gains the behaviour-response entry and its translation
  ("people become careful as cases rise").
- "Parameters" gains `use_reference` and the rule of 9.3 about what an
  estimate measured.
- "Contact networks" loses the implication that the hybrid network limits
  spread; it already says the final size is close on every network.

## 13. Testing

Python:

- Variation: at 50k agents the personal multiplier has mean 1 and the
  configured coefficient of variation within 3%; newborn agents get one; with
  `cv = 0` no state is drawn and the parity suite passes unchanged.
- Final size: on the random network at 50k agents, R0 2.5 with `cv = 1`
  infects within 3 points of the closed form (60%), and `cv = 0` within 3
  points of 89%. As shipped: the pilot's reading is the test of R0 (within 5%
  of the known value at coefficients of 1 and 2, the mean of three seeds).
- Saturation: the loss function reproduces the table of 4.3; a scenario with
  a loss above 2% is corrected by the closed form, with no pilot, to within
  0.5% of the target; one below 2% is left alone; the age-structured network
  never is. As shipped: the factor after prevalence falls is within 3% of 1,
  not 1%.
- Behaviour response: the factor equals the formula on every step; it is 1
  with nobody infectious and outside the window; it multiplies with
  seasonality and a dated reduction; the peak and the one-year attack rate
  are below the baseline's; after prevalence falls the factor is back within
  1% of 1; `stats.behavior` carries the strongest reduction and its day.
- Stand-downs: `r0_gap` and `final_size_gap` with a behaviour response;
  `final_size_gap` silent on a run with variation that matches its closed
  form.
- Fit: `disease.rel_sus_cv` reaches an attack rate of 0.6 from R0 2.5 within
  2 points in at most eight runs with beta unchanged;
  `behavior_response.scale` reaches 0.7; `peak_day` with either is refused;
  on the hybrid network the pilot runs before a fit on a new lever.
- `what_if`: the candidates by scenario (school closure only on the hybrid
  network, the campaign only for a disease with an indicator, nothing a
  scenario already has, nothing after a fade-out), the anchor day from the
  series, labels of at most 80 characters, at most four levers.
- `well_mixed`: fires on the three networks, stands down with variation or a
  response, offers the hybrid network only on the random one.

TypeScript:

- The mirror: the new leaves, the type, the fit rules, parity fixture 6.
- `matchedLevers` with a lever that carries entries; the run card's buttons
  send the label with the source `option` and are absent on the share page.
- `configure_simulation`'s `use_reference`: each row of 9.3, the unit
  conversions, the refusals, the recorded data source, the replacement of an
  earlier choice; `valueSources` returning `reference` and losing it when the
  value changes.
- The Parameters section: the coverage test of 8.3 on a random, an
  age-structured and a hybrid scenario of each model; the default view shows
  core and non-default rows; the tags; payloads without `sources` still
  render.
- `describe_parameters` by network; the report's appendix.
- The prompt's sections and phrases.

Evals: two more pending cases for the API harness. A user who gives a known
attack rate with a database R0 gets a fit on the variation, not on beta; a
baseline run without interventions is followed by an offer of an
intervention, labelled illustrative.

## 14. Implementation phases

Each phase is one plan, merged locally and pushed by the owner; none needs a
database migration.

- **A. Limits on spread.** The variation and its composition, the saturation
  rule in the pilot, the closed-form final size; the behaviour-response entry
  in the schema, the registry (version 5), the connector and the stats; the
  two fit levers; the stand-downs; the TypeScript mirror and parity fixture
  6; the panel line and row; the prompt's "Limits on spread".
- **B. Suggested interventions.** Levers that carry entries and labels;
  `what_if`; the broadened `well_mixed`; the shared indicator list; lever
  matching; the prompt's "After a run"; the run card's buttons. Also the
  `advanced` refusal text, which still names only three intervention fields
  (a minor deferred from 2C).
- **C. The Parameters section.** The registry's `networks`; the grouped rows
  and the coverage test; the source tags and the payloads' `sources`;
  `describe_parameters` by network; the report's appendix.
- **D. Chosen references.** The button; `use_reference`; the attribution; the
  report's row.
- **E. Docs, evals and the review list.** The README sections; the runbook's
  verification steps (section 6k) with the owner's prompts for each of the
  four changes; the two pending cases; the two requested fields and the
  regenerated review list. Also the documentation minors deferred from 2C and
  2D: spec section 13 of Part 2 (a closure at scale 0, a peak-day fit to day
  60), the count in `evals/README.md`, and in the README the connector
  sentence, the stray rule and the three wordings. As shipped: the review
  list also names the entries that contradict themselves (an estimate
  outside its own range, a consensus range none of its estimates is in),
  which the review of phase D had found by hand; the known-attack-rate case
  is RSV at 50%, because at measles' R0 the largest variation still leaves
  67% infected and a 60% target could only test the out-of-reach branch;
  the runbook's fit step of section 6j now says the R0 is not known, which
  keeps beta as the lever.

A is first because B's behaviour-response candidate needs it. C and D are
independent of A and B.

## 15. Out of scope

- Variation in contact activity, and degree distributions on the random
  network.
- A behaviour response by layer (households spared), a response to deaths or
  to reported cases, and caution that persists.
- Spatial or community structure (many weakly connected populations).
- A chart of the transmission factor over time; the stats carry its minimum.
- Treatment as a suggested intervention.
- Editing a parameter directly in the panel.
- Part 3 (calibration to a case series), testing and isolation, and
  sub-project 4b.

## 16. Costs

The multiplier is one gamma draw per agent and one multiplication per step;
the response is one mean and one multiplication per step. Neither changes the
measured run times. A fit keeps its bound of eight runs; on a network where
the pilot runs, a fit on a new lever adds the pilot (about 3 s locally at 10k
agents). As shipped: a fit on the variation where a pilot sets beta runs
the pilot at every trial, two or three pilots of about 2 s each per trial at
10k agents on the hybrid network (35 s for three trials against 24 s with one
calibration); eight trials stay under the service's 120 s limit locally. The Parameters section adds no data to the client: the registry is
already there. No new dependency in either language (`scipy` is already a
dependency of Starsim).

## 17. Questions for the owner

Decisions 3 to 9 of section 2 are proposals. The ones most worth a second
look:

1. **Off by default (decision 4).** Every new scenario still infects nearly
   everyone until the agent's offer is taken. The alternative is a default
   variation for every scenario, which changes every baseline result and
   rests on a value no database field supports yet.
2. **The illustrative values (decision 7).** A coefficient of variation of 1
   takes R0 2.5 from 89% to 60% infected; measured in the product (5.3) a
   response of up to 50% with its half-point at 1% takes the peak from 39% to
   10% infectious and the total from 89% to 58%.
3. **The response as an intervention entry (decision 5).** It appears in the
   panel's Interventions list, not in the Disease or Contact network group.
4. **`well_mixed` on every network (7.6).** The diagnostic will now fire on
   age-structured and hybrid runs too, which it never did.
