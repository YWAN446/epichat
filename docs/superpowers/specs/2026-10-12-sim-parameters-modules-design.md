# EpiChat Simulation Parameters, Part 2: Networks, Demographics, Interventions and the Disease Extensions (Design)

Date: 2026-10-12. Status: draft for the owner's review.
Builds on Part 1, `docs/superpowers/specs/2026-10-09-sim-parameters-disease-design.md`
(phases 0 to 5 shipped on 2026-10-12), whose registry, schema v2, exact R0,
diagnostics, options and tools this part extends. Where this document and
Part 1 disagree, this document wins; Part 1's section 19 rulings stay.

## 1. Purpose

Part 1 gave every parameter one description and gave the agent the means to
list, set and reason about them. It filled the disease module's core and left
the other modules at their v1 behaviour (Part 1, section 7.5 and 15). This part
fills them, module by module in Starsim's own order: diseases, networks,
demographics, interventions and products. Connectors and analyzers carry no
parameters of their own (the seasonality connector and the outputs are ours
already).

The thesis of this part, in the owner's words: the simulations so far run on
a daily random-mixing network, on which almost every susceptible is eventually
infected; real contact networks are limited, and the agent must be able to
represent that and take it into account.

For every parameter, three answers:

1. **Automatic source**: a database field (existing or requested in section
   11), a bundled table, or a fetch tool that writes it.
2. **Agent rule**: the default and its label when nothing automatic applies,
   and the prompt sentence that makes the agent offer it.
3. **User path**: a `configure_simulation` field, or the `advanced` patch by
   registry path, and the tier `describe_parameters` lists it under.

The deliverable the owner asked for at the end: a review-request list for the
database team (section 11), generated from the registry and the database once
the simulation update is in.

## 2. Decisions made on 2026-10-12

1. Group-specific disease parameters are keyed to the three age groups the
   demographics already define: under 18, 18 to 64, 65 and over.
2. The disease round adds susceptibility by age, fatality by age (absolute
   probabilities) and presymptomatic transmissibility; not transmissibility by
   age, not partial immunity after recovery.
3. The network round adds all three types: random with its options,
   age-structured with country-specific contact matrices, and the hybrid
   household, school, workplace and community network.
4. The demographics round adds the real age pyramid and projected birth rates;
   background mortality keeps the crude rate.
5. The interventions round adds vaccine and treatment realism and the two
   reduction interventions (contacts, transmission); testing and isolation is
   the following round.
6. After the simulation update, a review-request list is generated for Annie's
   team and other students.
7. Sexual and mother-to-child routes and the `Pregnancy` module are later
   rounds.
8. The hybrid network's layer weights stay Covasim's values; they are not
   requested per disease from the database.
9. Two calibrations come in: beta calibrated to the measured R0 where the
   formula is approximate (5.7), and a run fitted to an outcome the user knows
   (7.7). Calibration to an observed case series with Starsim's `Calibration`
   module (Optuna is already installed as its dependency) is Part 3.

## 3. Starsim 3.7.2 inventory

Read from the installed source (`starsim/diseases.py`, `networks.py`,
`demographics.py`, `interventions.py`, `products.py`), since the user guide
lists few defaults.

| Module | Starsim classes and parameters | Part 1 | This part |
|---|---|---|---|
| Diseases | `Infection`: `init_prev`; states `susceptible`, `infected`, `rel_sus` (1), `rel_trans` (1). `SIR`: `beta`, `dur_inf`, `p_death`. `SEIR`: + `dur_exp`. `SIS`: `waning`, `imm_boost`, state `immunity`. | every parameter covered; our SIRS/SEIRS (`dur_immune`) and SEIAR (`p_asymp`, `rel_trans_asymp`) | age multipliers on `rel_sus` and `p_death`; `rel_trans` for the exposed |
| Networks | `RandomNet`: `n_contacts` (a distribution), `dur`, `beta`, `age_range`, `dynamic`. `ClusterNet`: `cluster_size`, `age_range`, `beta`. `HybridNet`: `household_size`, `contacts` (s 20, w 16, c 20), `beta` (h 3.0, s 0.6, w 0.6, c 0.3), `school_ages` (6 to 22), `work_ages` (22 to 65). `MixingPools`: `n_contacts` matrix, `beta`. `StaticNet`, `MFNet`, `MSMNet`, `PrenatalNet`, `MaternalNet`, `PostnatalNet`, `ErdosRenyiNet`, `DiskNet`, `NullNet`. A sim runs any list of networks; a disease's `beta` may be a dict by network. | `random` (constant contacts, fresh daily) and `age_structured` (a fixed matrix) | random options, country matrices, hybrid; the rest deferred |
| Demographics | `People(age_data)`: an age histogram. `Births`: `birth_rate` (a rate or a year series), `rel_birth`. `Deaths`: `death_rate` (a rate or a life table by year, sex, age), `rel_death`. `Pregnancy`: `fertility_rate` by age, durations and outcomes. | crude birth and death rates; three age shares, uniform ages within each | the age pyramid and the birth series; crude deaths kept; `Pregnancy` deferred |
| Interventions | `RoutineDelivery`: `prob` (annual, converted per step), `start_year`, `end_year` or `years`, `eligibility`. `CampaignDelivery`: `years`, `prob`. `routine_vx`, `campaign_vx` with a `Vx` product. `treat_num` with a `Tx` product: `max_capacity`, `prob`, `eligibility`. `routine_screening`, `campaign_screening`, triage with a `Dx` product. | routine vaccine (yearly probability, start day, efficacy 1); our daily treatment with a capacity; seasonality | efficacy, campaigns, age targeting, waning; treatment efficacy, delay, transmissibility; contact and transmission reductions |
| Products | `simple_vx`: `efficacy` (0.9), `leaky` (partial protection for all, else all-or-nothing); multiplies `rel_sus`. `Tx`: state changes with `efficacy`. `Dx`: result probabilities by true state. | `simple_vx(efficacy=1.0)` | an EpiChat vaccine product with waning; a treatment product |

## 4. Disease module

### 4.1 New parameters

| Path | Kind, unit | Default | Bounds | Models | Tier | Starsim target | Affects |
|---|---|---|---|---|---|---|---|
| `disease.rel_sus_age.under18`, `.18_64`, `.over65` | number, multiplier | 1 | 0 to 10 | all | advanced | `rel_sus_base` of the agents in the group (4.2) | peak, final_size |
| `disease.p_death_age.under18`, `.18_64`, `.over65` | number, fraction | null (the scalar `p_death`) | 0 to 1 | the models with deaths | advanced | the per-agent death draw in `set_progression` | deaths |
| `disease.rel_trans_exposed` | number, fraction of the infectious value | 0 | 0 to 1 | seir, seirs, seiar | advanced | `rel_trans_base` of exposed agents, who become sources (4.3) | peak, timing |

The scalar `disease.p_death` stays and is what a group without its own value
uses. The three susceptibility multipliers apply whenever agents carry ages,
which in Starsim is always: without a fetched pyramid the default ages are
uniform from 0 to 60, so the elderly group is empty and the agent must say so
when a user asks for an elderly effect, or fetch the demographics first
(section 6).

- Automatic source: none today. `fatality_rate_by_age` is requested from the
  database (section 11); when it exists, `lookup_disease` reports it and the
  agent passes it like the other consensus values.
- Agent rule: the prompt tells the agent to offer susceptibility by age when
  the scenario names children, schools, care homes or the elderly, and
  fatality by age for the diseases whose severity depends on age (influenza,
  COVID-19, pertussis in infants); every such value is an illustrative
  assumption until the database carries it, and is labelled so in the
  limitations.
- User path: the `advanced` patch by path; `describe_parameters` lists them
  with the group in the label ("Susceptibility, under 18").

### 4.2 Composition of `rel_sus` and `rel_trans`

Starsim's transmission reads `beta × rel_trans(source) × rel_sus(target)`.
Several things now write both arrays: the age multipliers, the seasonality
and transmission-reduction factors, the asymptomatic reduction, vaccine
protection and its waning, and SIS immunity. They compose multiplicatively,
once per step, before transmission, in the connector Part 1 introduced
(renamed `TransmissionModifiers`):

```
rel_trans = rel_trans_base × seasonal_factor × transmission_reduction_factor
rel_sus   = rel_sus_base   × vaccine_protection × (1 − sis_immunity)
```

`rel_trans_base` carries the asymptomatic reduction and the exposed fraction;
`rel_sus_base` carries the age multiplier; `vaccine_protection` is a new
per-agent state the EpiChat vaccine product writes (1 for nobody vaccinated,
`1 − efficacy` for a leaky dose, 0 or 1 for an all-or-nothing one, restored to
1 when protection wanes); `sis_immunity` is Starsim's SIS `immunity` state.
Starsim's own `simple_vx` and SIS `update_immunity` write `rel_sus` in place
and would be overwritten, so the builder uses the EpiChat product and the SIS
subclass defers its `rel_sus` write to the connector. Recovered and dead
agents are not susceptible, so their `rel_sus` does not matter.

### 4.3 Presymptomatic transmission

Starsim transmits from agents whose `infectious` state is set; in `SEIR` the
exposed are not. The EpiChat SEIR family includes exposed agents among the
sources when `rel_trans_exposed > 0`, with `rel_trans_base = rel_trans_exposed`
during the latent period and 1 (or the asymptomatic value) once infectious.
`n_infectious` keeps counting the infectious compartment only; the series
gain nothing new.

### 4.4 The exact R0 with the multipliers

Part 1's `D_eff` becomes `D_eff + rel_trans_exposed × D_exp_eff`, where
`D_exp_eff` is the latent period's effective days by the same ceiling rules.
With `s_g` the share of agents in group `g` and `r_g` its susceptibility
multiplier:

- random network: `R0 = n_contacts × network_beta × p × D_eff × asymp_factor × Σ_g s_g r_g`;
- age-structured network: the next-generation matrix of Part 1 section 18
  with each target row `j` scaled by `r_j`; its spectral radius replaces
  `rho(C)`;
- hybrid network: section 5.5.

`calibrate_beta` inverts whichever applies; the unreachable-R0 rule and the
levers are unchanged. The per-group final sizes of section 18 gain the same
factors.

### 4.5 Diagnostics and checks

No new rule. `cfr_out_of_range` compares the population-weighted fatality
(`Σ_g s_g p_g`) with the database range when the age values are set;
`paramWarnings` does the same. The report's Parameters section lists the three
values when they differ from the scalar.

## 5. Network module

### 5.1 Types

`network.network_type` takes `random`, `age_structured` or `hybrid`. It is a
core field of `configure_simulation` (today it is set only by
`fetch_demographics`). The prompt's rule: a scenario that names a setting
with households, schools or workplaces, or that asks why so many were
infected, is a hybrid scenario; a national scenario with fetched demographics
is age-structured; a quick comparison or a classroom example stays random,
and the agent says in one sentence that random mixing overstates the final
size.

### 5.2 Random

| Path | Kind, unit | Default | Bounds | Tier | Starsim target |
|---|---|---|---|---|---|
| `network.n_contacts` | integer, per day | 4 (database `average_contacts_daily`) | 1 to 100 | core | `RandomNet(n_contacts=…)` |
| `network.contacts_dist` | enum `constant`, `poisson` | `constant` | | advanced | the `n_contacts` distribution |
| `network.contact_duration_days` | number, days | 0 | 0 to 365 | advanced | `RandomNet(dur=…)` |
| `network.network_beta` | number, multiplier | 1 | 0.01 to 10 | advanced | `RandomNet(beta=…)` |

A duration above 0 makes contacts persist, which slows spread by local
depletion; the exact R0 assumes fresh contacts, so with a duration the
reported R0 carries `approximate: true` and the measured R0 (5.6) is the one
to quote. The Poisson option spreads daily contacts between agents; under
daily remixing it leaves R0 unchanged.

### 5.3 Age-structured, with country matrices

The fixed POLYMOD-style matrix becomes nine leaves
`network.contacts.<source>_<target>` over `children`, `adults`, `elderly`
(rows source, columns target, as Starsim's `MixingPools` reads them),
defaults `7.0 2.5 0.5 / 2.5 9.0 1.5 / 0.5 1.5 3.5`, bounds 0 to 50, advanced.
`network.contacts_source` records where they came from: `polymod_default`,
`prem_2021:<ISO3>` or `user`.

- Automatic source: the synthetic contact matrices of Prem et al. (2021,
  177 countries, 16 five-year bands, all locations combined), bundled as
  `epichat/data/contact_matrices.csv` after aggregation to the three groups
  with the country's population weights (the aggregation script is committed
  with its test). `fetch_demographics` applies the country's matrix when it
  switches the network, and `recalibrate_beta` holds the confirmed R0 across
  the matrix change as it does across the network switch.
- Agent rule: without a country the POLYMOD defaults stand, labelled European.
- User path: `advanced` by path; the agent explains a cell as "contacts per
  day a target in group B has with group A".

`network.n_contacts` has no effect on this network, which `describe_parameters`
says in the leaf's description.

### 5.4 Hybrid

Starsim's `HybridNet`, Covasim's four layers: households as persistent fully
connected clusters, schools and workplaces as age-restricted random layers,
community as a random layer. Each layer has a relative transmissibility.

| Path | Kind, unit | Default | Bounds | Tier | Starsim target |
|---|---|---|---|---|---|
| `network.household_size` | number, people | 2.0 (country value when known) | 1 to 10 | core | `household_size` (Poisson mean) |
| `network.school_contacts`, `network.work_contacts`, `network.community_contacts` | integer, per day | 20, 16, 20 | 0 to 100 | advanced | `contacts` |
| `network.layer_beta.household`, `.school`, `.work`, `.community` | number, multiplier | 3.0, 0.6, 0.6, 0.3 | 0 to 10 | advanced | `beta` per layer |
| `network.school_age_min`, `network.school_age_max` | integer, years | 6, 22 | 0 to 100 | advanced | `school_ages` |
| `network.work_age_min`, `network.work_age_max` | integer, years | 22, 65 | 0 to 100 | advanced | `work_ages` |

- Automatic source: the mean household size by country from the UN "Household
  Size and Composition" dataset, bundled as a small table and applied by
  `fetch_demographics` alongside the pyramid. The layer contacts and
  transmissibilities keep Covasim's values, labelled illustrative.
- Agent rule: the prompt offers the hybrid network for household, school and
  workplace scenarios and for a run whose attack rate looks well mixed
  (5.8); it says that the layer weights are Covasim's calibrated values, not
  measurements for the disease at hand.
- User path: `network_type: "hybrid"` and `household_size` as fields, the rest
  by `advanced`.

The hybrid network needs ages: with the pyramid (section 6) the school and
work layers are populated as in life; without it Starsim's default ages
(0 to 60) still fill them, with no elderly.

### 5.5 R0 on the hybrid network

Households are static clusters that saturate, so no closed form gives the
exact R0 Part 1 has for the other two networks. Two numbers:

- An approximate R0 for calibration: `p × D_eff × asymp_factor × Σ_l beta_l × c_l`,
  with `c_l` the population-mean daily contacts of layer `l`: household size
  minus one for households, the layer's contacts times the share of agents in
  its age range for schools and workplaces, the community contacts as given.
  `calibrate_beta` inverts it; the run reports `approximate: true`.
- The measured R0 of 5.6, which the agent quotes.

### 5.6 Measured R0

After every run the builder reads Starsim's infection log (seeds have source
−1) and reports `stats.r0_measured`: the mean number of secondary infections
caused by the day-0 seeds, null when there were none or when nobody was
infected. It is population-free, so it is the same in agent and people units.
With replicates it is the representative's value and the bands carry nothing
for it. On the random and age-structured networks it checks the exact
formula; on the hybrid network it is the number that matters. The run payload
carries it beside `approx_r0`, and the report's Parameters section shows
"R₀ measured".

### 5.7 Calibration to the measured R0

Where the formula is approximate (the hybrid network, or a contact duration
above zero), the child calibrates before the real run: it runs a pilot with
the formula's beta, measures R0 (5.6), corrects beta by `target / measured`,
and repeats until the measured value is within 5% of the target or after
three corrections; the real run then uses the corrected beta. The pilot is
short: `min(sim days, 4 × (latent + infectious mean days))`, since the seeds'
secondary infections are complete well within that window, and it uses the
first replicate's seed. `run.calibrate_r0` (bool, default true, advanced)
switches it off; on the exact networks nothing runs. `effective_params`
carries the corrected beta; `stats.r0_calibration` reports
`{target, measured, corrections}`; the run payload's `applied` notes
`beta_calibrated_by_measurement`. The agent says "beta was adjusted so the
measured R0 matches the one you set".

### 5.8 Diagnostics

Two new rules in `epichat/sim/diagnostics.py`, thresholds as named constants:

| id | Severity | Trigger | Levers |
|---|---|---|---|
| `well_mixed` | info | random network, no contact reduction, `R_eff ≥ 2`, attack rate above 0.7 | `network.network_type` to `hybrid` (rationale: with limited, repeated contacts the final size is lower than under daily random mixing); `network.contact_duration_days` to 7 |
| `r0_gap` | info | `r0_measured` is not null and differs from `approx_r0` by more than 25% | none when the run was calibrated by measurement (5.7, the gap is closed by construction) or the user switched the calibration off (the measured value is quoted); on the exact networks, the beta recheck of Part 1 |

### 5.9 Agent and user

Core fields: `network_type`, `household_size`. The prompt gains a short
"Contact networks" section: which network for which scenario, the well-mixed
caveat, and the instruction to quote the measured R0 when the approximate one
is flagged.

## 6. Demographics module

### 6.1 The age pyramid

UN WPP 2024's population by single year of age (medium variant), bundled for
every country for 2024 and 2030 as `epichat/data/un_wpp_age.csv`. When
`demographics.country` is set and the table has it, the builder creates the
population with `People(n_agents, age_data=histogram)` and the three shares
are derived from the same histogram; `fetch_demographics` records them from the
bundled table too, so the panel and the builder agree. `demographics.age_source`
records `un_wpp`, `shares` (the user edited a share, and the builder assigns
uniform ages within bands as today) or `default`.

- Automatic source: the bundled table, keyed by country and
  `demographics_year`.
- Agent rule: without a country, Starsim's default ages, and the agent says
  there is no elderly group until demographics are fetched.
- User path: the three shares by `advanced`, as today.

### 6.2 Births and deaths

`demographics.birth_rate` stays the crude rate for the first year and the
override. For runs longer than a year with a known country the builder passes
UN WPP's projected crude birth rates by year (bundled, 2024 to 2050) to
`Births`. `demographics.death_rate` stays the crude rate (decision 4);
age-specific mortality is listed under section 15 for a later round. Aging is
on when demographics are on, as Starsim does.

### 6.3 Sources and the review list

The bundled tables' vintage (WPP 2024), a spot check of five countries against
the UN site, and the three-band aggregation go on the review list.

## 7. Interventions and products module

### 7.1 Intervention entries

The `interventions` list keeps one entry per intervention; entries gain
fields, and two types are new. Every field has a default, so stored scenarios
validate unchanged.

| Type | Fields (default) | Starsim |
|---|---|---|
| `vaccine` | `coverage`, `kind` (`routine`; or `campaign`), `start_day` (0), `end_day` (null: the run's end), `efficacy` (1.0), `leaky` (true), `age_min` (null), `age_max` (null), `protection_days` (null: permanent) | `routine_vx` or `campaign_vx` with the EpiChat vaccine product; `eligibility` by age |
| `treatment` | `coverage` (1.0), `capacity` (null), `start_day` (0), `end_day` (null), `efficacy` (1.0), `delay_days` (0), `rel_trans_treated` (1.0), `symptomatic_only` (false) | `treat_num` with an EpiChat treatment product |
| `seasonality` | `scale` (0.2), `shift` (0); `peak_day` accepted as an alias of `shift` | the connector |
| `contact_reduction` (new) | `layer` (`all`; or `household`, `school`, `work`, `community`), `scale` (0 to 1), `start_day`, `end_day` | the layer's network `beta` scaled over the window; on random and age-structured only `all` |
| `transmission_reduction` (new) | `scale` (0 to 1), `start_day`, `end_day` | a connector factor on `rel_trans` over the window |

Semantics: routine coverage is the yearly probability each eligible person
is vaccinated (Starsim's annual probability), as today; a campaign reaches
the target coverage uniformly over its window (the per-day probability is
derived from the window's length). A day-0 vaccine with efficacy 1 stays
`disease.initial_immune_frac` (Part 1 section 18); with efficacy below 1 it is
a campaign on day 0, so the protection is leaky as the product says. Treatment
with a delay treats an infectious agent `delay_days` after it became
infectious, cures it with probability `efficacy`, and lowers its
`rel_trans` to `rel_trans_treated` while it waits; `symptomatic_only` skips
asymptomatic agents in SEIAR. School closure is a `contact_reduction` on the
school layer at scale 0; distancing is the community layer at a fraction;
masks are a `transmission_reduction`.

### 7.2 Products

Starsim keeps products apart from delivery; we attach the product's
parameters to the intervention entry, because a scenario never reuses a
product. The builder makes an EpiChat `Vaccine` product (efficacy, leaky,
waning through `vaccine_protection`, section 4.2) and an EpiChat `Treatment`
product (efficacy, delay, transmissibility), both documented in the registry
under the entry's leaves (`interventions[].efficacy` and so on).

### 7.3 R0 and interventions

The R0 reported stays the baseline one; the agent explains that reductions
and vaccination lower the effective reproduction number, and the run's
`r0_measured` shows it when they are active from day 0.

### 7.4 Agent and user

`configure_simulation` gains `interventions`: a list of entries as in 7.1,
each upserted by type (and layer for contact reductions), and
`remove_interventions`: a list of types to drop. The shortcut fields
(`vaccine_coverage`, `vaccine_start_day`, `treatment_capacity`,
`seasonality_scale`) stay for the common cases. The `advanced` patch still
refuses `interventions[]` paths. The prompt gains an "Interventions" section:
how to translate "schools closed from day 30 for six weeks" and "masks for
the first three months", to label every effect size an illustrative
assumption unless the database carries it, and to use the database's vaccine
efficacy when `lookup_disease` reports one. `fetch_vaccination_coverage` keeps
writing initial immunity and, when the database has the vaccine's efficacy,
writes a day-0 campaign instead.

### 7.5 Diagnostics

None new. The existing rules see the reductions through the series; `well_mixed`
stands down when a contact reduction is active.

### 7.6 Sources and the review list

Vaccine efficacy per disease (with the product and dose it refers to) and
treatment efficacy with its delay are requested from the database (section
11); effect sizes of school closure, distancing and masks are requested as
cited ranges to seed the illustrative defaults.

### 7.7 Fitting to a known outcome

A participant often knows one number from the real event: the share
infected, or when the peak came. `run.fit` (object, optional, advanced):
`{ target: attack_rate | peak_day | peak_infections, value, lever: disease.beta | network.network_beta }`,
the lever defaulting to beta. The child searches the lever by bisection on a
log scale within the registry bounds, one full-length run per step with the
first replicate's seed, until the outcome is within tolerance (attack rate
within 2 points, peak day within 3 days, peak infections within 5%) or after
eight runs; the replicates, if any, then run with the fitted value.
`effective_params` carries it, `stats.fit` reports
`{target, wanted, achieved, lever, value, runs}`, and the agent reports
"beta was set so that the attack rate is 30%", labelling the fit as such in
the limitations. `configure_simulation` gains `fit` as a field; the
diagnostics and the comparison read the fitted run like any other, and
`final_size_gap` stands down on a fitted run. Eight runs of 10k agents cost
about half a minute on the service; the cap applies to each run.

## 8. Run module

Unchanged: `run.n_agents`, `run.sim_dur_years`, `run.n_replicates`,
`run.rand_seed`. The hybrid network's edges cost more per step than a random
net's; the agent-years cap stays, and the measured timings go into the
runbook with the first deploy (section 16).

## 9. Registry, schema and migration

Every addition is an optional leaf with a default, so `schema_version` stays
2 and stored rows validate unchanged; the registry export's `version` becomes
2. The pydantic `Intervention` model in `epichat/schema.py` is shared with the
frozen Python agent, so its new fields default too. The TypeScript mirror,
`validateParams` and the parity fixture gain the new leaves, R0 cases on all
three networks, and migration cases for the new entries.

## 10. Automatic sources, in one place

| Source | Carries | Applied by |
|---|---|---|
| database (existing fields) | R0, incubation, infectious period, fatality rate, contacts, immunity duration, asymptomatic share | `lookup_disease`, the agent |
| database (requested, section 11) | `fatality_rate_by_age`, `vaccine_efficacy`, `treatment_efficacy`, `presymptomatic_transmission` | `lookup_disease`, the agent |
| bundled `contact_matrices.csv` (Prem 2021) | the 3×3 contact matrix by country | `fetch_demographics` |
| bundled `un_wpp_age.csv` (WPP 2024) | the age pyramid by country and year | the builder; the shares by `fetch_demographics` |
| bundled `un_wpp_cbr.csv` (WPP 2024) | projected crude birth rates by year | the builder for multi-year runs |
| bundled `un_household_size.csv` | mean household size by country | `fetch_demographics` |
| UN WPP live API, with the service fallback | crude birth and death rates, total population | `fetch_demographics` |
| WHO GHO | routine vaccination coverage | `fetch_vaccination_coverage` |
| World Bank Data360 | hospital beds for the treatment capacity | `fetch_health_system` |

## 11. Review requests for the database team

`scripts/review_requests.py` extends `scripts/param_coverage.py`: for every
disease and every database field the registry names, existing and requested,
it prints the status (`ok`, `under_review`, `estimates_only`, `no_source`,
or `requested` for a field the database does not have yet) and what a
reviewer should find: the unit, the age bands for the age-specific fields,
and the kind of source that settles it (a systematic review, a surveillance
report, a vaccine trial). It also lists the bundled tables with the check each
needs (vintage, a spot check, the aggregation). The output,
`docs/data-review-requests.md`, is generated at the end of the implementation,
committed, and handed to Annie's team; it is regenerated whenever the database
or the registry changes.

## 12. Diagnostics and the agent, summary

New rules: `well_mixed`, `r0_gap` (5.7). New prompt sections: "Contact
networks" (5.8) and "Interventions" (7.4), plus one sentence in "Parameters"
on the age groups and the illustrative label. `describe_parameters` lists the
new leaves by module as it does today; `network_type`, `household_size` and
`fit` become fields, and `interventions` a structured field. The measured-R0
calibration (5.7) and the fit (7.7) are explained in the "Contact networks"
and "Interventions" sections respectively.

## 13. Testing

Python:
- Composition: with an age multiplier, a vaccine, seasonality and SIS
  immunity all active, `rel_sus` and `rel_trans` equal the product of the
  factors on every step; nothing overwrites them.
- Presymptomatic: with `rel_trans_exposed = 0.5`, exposed agents infect and
  the exact R0 with the extended `D_eff` is within 5% of the simulated final
  size's implied R0 at 50k agents.
- R0 calibration with multipliers: targets 1.5, 2.5, 4 on the random and
  age-structured networks with `rel_sus_age` of 1.5 / 1 / 0.7, within 5%.
- Measured R0: on the random network at 50k agents and 50 seeds, within 10%
  of the configured R0; on the hybrid network it is reported and finite, and
  the approximate R0 is within a factor of two of it (a bound to tighten once
  measured).
- Hybrid: four layers exist with Covasim's defaults; school and work layers
  hold only agents in their age ranges; a `contact_reduction` on the school
  layer at scale 0 removes its transmission for the window.
- Pyramid: with a known country the agents' ages match the bundled histogram
  (shares within a point); without it the shares path works as today.
- Interventions: a campaign reaches its coverage within the window; a leaky
  vaccine with efficacy 0.5 halves `rel_sus` for the vaccinated; waning
  restores it; a treatment with a delay and `rel_trans_treated` 0.5 halves
  transmissibility while waiting; `symptomatic_only` leaves asymptomatic
  agents untreated.
- Measured-R0 calibration: on the hybrid network with target 2.5 at 50k
  agents, the calibrated run's measured R0 is within 5% of the target in at
  most three corrections, and the exact networks run no pilot.
- Fit: on the random network, fitting the attack rate to 0.3 lands within 2
  points in at most eight runs, and fitting the peak day to day 60 within 3
  days; the replicates run with the fitted beta.
- Diagnostics: `well_mixed` fires on a constructed well-mixed run and not on
  a hybrid one; `r0_gap` fires on a mismatch and stands down on a calibrated
  run.
- Bundled tables: the aggregation of Prem's 16 bands reproduces a published
  3×3 within rounding for two countries; every ISO3 the UN table knows has a
  pyramid row for 2024.

TypeScript: the new leaves in the registry and the parity fixture; the
`interventions` field upserting and removing entries; `network_type` and
`household_size` as fields with `recalibrate_beta` across a network change;
`fetch_demographics` applying the matrix, the pyramid shares and the household
size; the run payload's `r0_measured`; the prompt sections; the panel rows for
the new parameters and the measured R0.

Evals: the pending cases stay; two more pending cases are written for the API
harness: a school-closure scenario on the hybrid network, and "why were so
many infected?" leading to the hybrid option.

## 14. Implementation phases

Each phase is one plan, merged locally and pushed by the owner; none needs a
database migration.

- **2A. Disease extensions and the composition rule.** The three age
  multipliers, fatality by age, presymptomatic transmission, the
  `TransmissionModifiers` connector and the EpiChat vaccine product's
  `vaccine_protection` state, the extended exact R0, the parity fixture, the
  review-request script's skeleton.
- **2B. Demographics and networks.** The bundled tables and their
  aggregation scripts, the pyramid and birth series in the builder, the three
  network types, the country matrices, the hybrid layers, the measured R0, the
  two diagnostics, the calibration to the measured R0, the fields and prompt
  section, the timings in the runbook.
- **2C. Interventions and products, and the fit.** The extended entries, the
  two reduction interventions, the treatment product, the `interventions` and
  `fit` fields and prompt sections, the WHO coverage path with efficacy.
- **2D. Docs, evals and the review list.** The README and runbook sections,
  the two pending cases, `docs/data-review-requests.md` generated and
  committed.

## 15. Out of scope

Testing and isolation (the next round after 2C). Calibration to an observed
case series with Starsim's `Calibration` module (Part 3: an asynchronous job
in the service, the data input, the likelihood, and a card for the fit).
Sexual and mother-to-child routes and `Pregnancy`. Age-specific background mortality. Transmissibility by
age and partial immunity after recovery. Per-disease layer weights for the
hybrid network. Calibration to observed data. Rendering of the new payload
fields beyond the panel rows (the workspace follow-up).

## 16. Costs

The bundled tables are small: the matrices a few hundred rows, the pyramid
about 230 countries × 101 ages × 2 years, the birth series and household sizes
a few thousand rows; well under a megabyte compressed. The hybrid network
builds edges for every household and layer, so a 10k-agent year costs more
than the random net's 4 seconds on Vercel; 2B measures it and the runbook
records it. The measured R0 reads a log Starsim already keeps.

## 17. Questions resolved on 2026-10-12

The nine decisions of section 2. The hybrid layer weights were the one open
question and were settled as Covasim's values (decision 8); the calibration
question raised at the review was settled as decision 9.
