# Starsim v4 port: review, fixes, and questions (November 2026)

This reviews Cliff Kerr's Starsim v4 port (#7, head `22a7910`) on the branch `starsim-v4` of this repository. Main was merged in,
and Starsim is pinned at `starsim==4.0.0rc5`. The same scenarios were run on main (Starsim 3.7.2) and on the branch (4.0.0rc5):
10,000 people for one year with the default seeding unless noted, and a single seed for agent runs.

The port's core works:

- One declared disease runs as an ODE where it can.
- It is 10 to 200 times faster: a year of 10,000 people takes 0.02 to 0.07 s as an ODE.
- R0 and beta agree exactly with Starsim's own R0 on the random and age-structured networks.
- Vaccines, reductions, seasonality, the behaviour response, deaths by age and SEIAR all match main.

## Fixed on this branch

Each fix has a test that failed before it and passes after.

| # | What was wrong | Fix |
|---|---|---|
| 1 | `stats.r0_model` took the sim's modifiers at the start, so a reduction from day 0 lowered it: R0 2.5 with a 70% reduction on days 0 to 30 reported 0.75, although 89% were infected. The fit reads R0 ≤ 1 as a fade-out, so a beta fit to an attack rate of 85% ended at 96% after 8 runs. | `r0_model` is Starsim's R0 of the scenario without interventions, and `None` on the hybrid network or with lasting contacts (Starsim lays those out as well-mixed contact, whose R0 is not theirs). The fit now lands within 2 points. |
| 2 | Delayed seeds were missing from `new_infections` and `total_infected`, because a delivery is not the infection flow. | The seeding's deliveries are added to the day they happen on. |
| 3 | Agent runs ignored the configured age shares unless something in the disease depended on age. Shares of 50/20/30 gave Starsim's world ages, 29/61/10, while the R0 formula used the shares. On the hybrid network the shares decide who is in school and at work. | `build_people` draws ages in the configured shares, uniform within each band, as main did. |
| 4 | v4's `HybridNet` turns a plain number of contacts into the same number for everyone, and the port passed plain numbers: every pupil was in a school group of exactly 21 and every worker in a workplace of 17 (the variance of their contacts 0.32 and 0.02, against about 20 and 16 for Covasim's Poisson counts). | `ss.poisson(...)` counts, v4's own default: groups vary in size and the configured contacts are the mean. Schools and workplaces stay v4's clusters (see below). |
| 5 | With a treatment delay, `symptomatic_only` was ignored, because a treatment goes by default to everyone infected, the asymptomatic included: an all-asymptomatic SEIAR epidemic was treated away (33 infected against 1,503 untreated). With 30% asymptomatic, treating the symptomatic only gave the same as treating everyone (61% infected, where the fix gives 69%). The isolation (`rel_trans_treated`) reached only the symptomatic, even for a treatment of everyone infectious: with 30% asymptomatic and 0.5, 56% infected either way, 37% with the asymptomatic isolated too. | The delayed treatment takes the same `who=` as the immediate one: still infectious, and symptomatic if asked. The isolation takes it too. |
| 6 | A treatment with a delay was a different delivery from one without. It was offered once, exactly `delay` days after onset, with probability equal to the coverage, and never to the seeds, who start infectious without an onset. SIR at R0 2.5 as agents, coverage 0.3: no delay infected 0.1%, a 2-day delay 74% (main: 0.4% and 22%). | By the owner's decision (2026-11-20), one delivery for both: offered each day at the coverage to the infectious, from `delay_days` after they became infectious (`I.time_in`, which Starsim runs as agents). A 2-day delay now gives 0.7%, a 4-day one 56% (main: 67%; there the cure took effect a day later). The isolation acts on the same people from the same day, until they are treated or recover (see below). |

Tests: pytest 681 passed and 42 skipped (live API); sim 71 passed; web 745/745.

**Kept as in the port, by the owner's decision (2026-11-19).** Seeds start infectious (I) in every model, on day 0 and when
seeding is delayed, as Starsim does. In SEIR, SEIRS and SEIAR they therefore skip the latent period. Main started them
latent (E), so the first transmission now comes on day 1, not after a latent period, and SEIAR's seeds are all symptomatic.
The peak moves by a few days: for a measles-like SEIR, day 49 on the branch against 56 on main.

**Clustered schools and workplaces, by the owner's decision (2026-11-20).** On the hybrid network, schools and workplaces are
v4's clusters, fixed groups whose members all meet, so a person's contacts also know each other. On main they were Covasim v3's
random layers. The community stays random. With Poisson group sizes the mean contacts are those configured, so the R0 formula's
inputs are unchanged. The attack rate barely moves: at R0 1.5 over 10 seeds, 53.4% with clusters against 53.5% with random layers.

**Isolation from the offer of treatment, by the owner's decision (2026-11-20).** `rel_trans_treated` applies to the people
treatment is offered to (the infectious, symptomatic only if asked), from `delay_days` after they become infectious until they
are treated or recover, while the programme runs. It does not depend on the coverage. Main applied it only to people waiting
for a limited capacity, so without a capacity limit it did nothing.

## Questions for Cliff

1. **ODE runs never fade out.** In an ODE, infections can fall to a fraction of a person and grow back. SIRS over three years
   (immunity of about 180 days, R0 2) infects 81% on main, where the epidemic dies out by day 112. On the branch it infects 313%:
   the infected fall to 4e-5 people on day 210, then come back in two more waves. This hits the waning models, runs with births,
   and anything that suppresses an epidemic for a while.
   - Does v4 have an extinction threshold for compartmental runs, such as a minimum count below which a compartment is emptied?
   - If not, would you run these scenarios as agents?
2. **R0 is not held on the hybrid network or with lasting contacts.** On main, a short pilot measured R0 and corrected beta
   (`calibrate.py`); the port removes it. With Poisson contact counts (fix 4), the attack rate still differs. The network shape is
   not the cause: random layers and clusters give the same within a point.

   | Scenario | Main | Branch |
   |---|---|---|
   | Hybrid network, R0 1.5 | 60% | 53% |
   | Hybrid network, R0 2.5 | 90% | 84% |
   | Contacts lasting 30 days, R0 1.5 | 53% | 25% |
   | Contacts lasting 30 days, R0 2.5 | 93% | 75% |

   - Does v4 offer a way to measure R0 in an agent run (who infected whom, or first-generation counts) that we could port the pilot to?
   - Or does it have a better estimate for these networks?
3. **What a treatment means.** The registry says coverage is the "share of infectious people treated each day", and main treated
   each person at most once.
   - (a) `rate=` offers treatment every day, with or without a delay (fix 6), so a failed cure is tried again the next day. 50%
     coverage at 50% efficacy infects 60% on main and 0.2% on the branch. Can a compartmental delivery give "each person at most
     once"? Is that routine delivery with no `when=`, or `skip_reached_within`, which is agents only? Whatever the answer, it
     would apply to both.
   - (b) A delay is now the same daily delivery to `I & (I.time_in >= ss.days(delay))` (fix 6). The port's
     `when=ss.on(onset, delay=...)` offered it once and missed the seeds, who have no onset. SIR at R0 2.5 as agents,
     coverage 0.3, cure 100%:

     | Delay | Main | Port | Branch |
     |---|---|---|---|
     | 0 | 0.4% | 0.1% | 0.1% |
     | 2 days | 22% | 74% | 0.7% |
     | 4 days | 67% | 79% | 56% |

     The rest of the gap to main is that main's cure took effect the next day, so the treated transmitted one more day. Is
     `time_in` the way you would write "each day, from `delay` days after becoming infectious"? Is there a compartmental
     form, so that a delay need not mean agents?
   - (c) `rel_trans_treated` now isolates the people treatment is offered to, from the delay on, until they are treated or
     recover (the owner's decision above). The port applied it to everyone in I while the programme ran; main applied it only
     to people waiting for a limited capacity, so without one it did nothing. Isolation at 0.5:

     | Scenario | Main | Branch |
     |---|---|---|
     | Coverage 0 | 89% (as untreated) | 28% |
     | Coverage 0.3, 2-day delay | 22% (as without it) | 0.2% (0.7% without it) |

     If we later want main's meaning, is `ss.capacity(n, queue=True)` the way to model waiting, and can a modifier reach the
     queue?
   - (d) The old v1-shaped treatment rounded `coverage × infectious` down to a whole number of people. We'd keep your smooth
     rate; say if you see a reason not to.
4. **Gamma durations above a CV of about 0.82 run as exponential.** `to_dist` gives `ss.erlang(k=round(CV⁻²))`, so k = 1
   whenever CV² is above 2/3, and the registry allows an SD up to twice the mean. With an infectious period of mean 10 and
   SD 15, the peak moves from day 89 to day 53 and grows from 1,610 to 2,336.
   - Should agent runs use a true gamma, and the ODE something else (a mixture of Erlangs?)?
   - Or should we cap the SD at the mean?
5. **The SIS immunity boost changed meaning.** On main, each infection added leaky immunity that accumulated (`sis_imm_boost`).
   On the branch, that share of recoveries becomes fully immune in R. With a boost of 0.5 and waning of 2 a year, the mean
   number infectious over the third year is 643 on main and 593 on the branch. Is the change intended, and is it Starsim's
   SIS?
6. **Clustered hybrid network.** We use v4's clusters for schools and workplaces, with Poisson sizes (fix 4) rather than
   fixed ones. `r0.hybrid_contacts` still takes each layer's mean contacts, which Poisson sizes keep. Do you agree with Poisson
   sizes? With fixed ones, as the port had them, more runs died out early (1 of 10 at R0 1.5, against none). Is the mean the
   right input to an R0 formula for fixed groups, or should the pilot (question 2) cover them?
7. **Five susceptibility classes.** They are close at CV ≤ 1 (61.2% infected, against 60.0% in theory and 59.3% on main) but
   drift at CV 2 (31.9%, against 27.6% on main). What does a finer split, such as 10 classes, cost in run time?
8. **`R0()` and interventions.** We now take R0 from a copy of the sim built without interventions. Is there a v4 option for
   the basic R0 that leaves interventions out directly?
9. **The release.** When do you expect 4.0.0, and do you expect API changes after rc5? We pin `==4.0.0rc5` and will move to
   4.0.0 deliberately.
10. **Ages in agent runs (fix 3).** `build_people` drew ages only from a UN pyramid. With configured shares and nothing
    age-dependent in the disease, agents got Starsim's world ages (29/61/10), because only a stratified disease makes
    Starsim draw ages from its strata. The test for shares passed only because it set elderly susceptibility. On the
    hybrid network at R0 2.0, a young population (47/50/3) and an old one (12/59/29) then ran on identical agents: the old
    one had more infections (79% against 73%), the reverse of main. The fix draws agents in the shares, uniform within
    each band (0-17, 18-64, 65-94), as main did. Do you agree that agent runs should always follow the shares? Would you
    give the bands a shape other than uniform?
11. **Forkserver on Vercel.** The runner preloads `__main__` into the forkserver. It works under uvicorn on Linux (71 sim tests,
    and a real server answered a run in 74 ms after warm-up), but Vercel's Python runtime is untested. Do you know of anything
    in its entry point that preloading `__main__` would run? We will check on a preview deployment.

## Decisions for the owner

1. **ODE by default.** The default scenario and the age-structured network become deterministic compartmental models, with no
   replicates or bands, no fade-out by chance, and fractional people. The website and the agent's prompt no longer say
   "agent-based". Keep that framing, or keep agents as the default with the ODE as a fast option?
2. **Saved scenarios.** Beta is now a rate per contact (`beta / 365` a day) rather than a probability (`1 − e^(−beta / 365)`),
   and the R0 formula uses mean days. Re-running a scenario saved before the port gives about 15% more R0 at the default and
   25% more for a measles-like one. Should we migrate them (a schema bump that recomputes beta from the R0 they were set to),
   or accept it?
3. **Default ages.** Without fetched demographics, ages are now Starsim's world population (29% under 18, 61% 18 to 64, 10% 65 and
   over) instead of uniform from 0 to 60, so the elderly exist by default. Elderly fatality now counts, and deaths rise
   accordingly. Accept?
4. **Timing.** Peaks move by a few days, and the differences above change results. Merge between rounds of the usability study,
   not during one.
5. **Treatment.** If question 3 cannot be done in a compartmental run, should treatment always run as agents?
