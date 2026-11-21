# Round-1 fixes: correct numbers and a settable area population

Date: 2026-11-21. Status: for the owner's approval (a reviewer's check is done and its questions are answered).

## Intent

Round 1 of the usability study (seven participants, 60-minute think-aloud sessions, October 27 to November 13) was
reviewed turn by turn: 90 separate requests, 59% fulfilled and 27% partly. The review found three kinds of failure that
this design fixes:

1. **No population below a country.** Four of seven participants asked for a county or a state. Every run was scaled to
   the whole country, the assistant twice promised a county size and then took it back, and one participant asked for
   the county's numbers alone. The team's own feedback lists "confusion about why it kept scaling to the full country".
   The round-1 task script itself frames the work as helping "a county health department in Kenya".
2. **Wrong numbers reached participants.** Campaign doses about five times too low in a report for a health director;
   initial cases counted in simulated agents rather than people (20 became about 117,000 at Kenya's scale); an
   uncertainty band claimed four times but never drawn; a run comparison of +1.48 million against a real +266,000; a
   made-up run size.
3. **Offers the tool cannot keep.** A Python sandbox, a second model, and runs larger than the simulation service allows.

Round 2 is one to two months away. These fixes land first. This is part 1 of 3; part 2 is the interface cleanup
(remove thumbs and the language animation, panel naming and discoverability, chart and chip fixes), part 3 the first-use
tutorial built on the settled interface.

## Goals

- A user can run a scenario for an area smaller than a country, with a population they give or the assistant finds and
  cites, using the country's ages, contact patterns and vaccination coverage.
- Every count the assistant, the panel or a report shows is right for the population being simulated: run comparisons,
  initial cases, doses, uncertainty, run size.
- The assistant does not offer what EpiChat cannot do.
- A report covers the runs the user picks, numbers them as the panel does, and is titled for the area.
- A turn after a pause of 5 to 60 minutes does not pay to rebuild the whole conversation cache.

## Non-goals

- Real sub-national data (an area's own ages, households, coverage). That is the planned US state and county design from
  Census ACS, later and US only.
- Sub-national vaccination coverage. Coverage stays national and is labelled so.
- Part 2 and part 3 items (thumbs, typewriter, panel name, chart default, chip wrapping, tutorial).
- Researcher outputs beyond the band: results by age, Rt, weekly series, per-replicate lines, CSV export, chart zoom.
- The Starsim v4 follow-ups from the PR #8 review (the removed R0 pilot for lasting contacts, isolation with coverage 0,
  the `binomial` solver). They are model questions being settled with Cliff Kerr.
- Splitting "set in chat" into "you chose" and "the assistant assumed" for every parameter. Only the area population gets
  its own origin here.

## Anti-goals

- Any place that shows national totals for an area scenario: chat, panel, compare deltas, report tables, report title.
- A population figure without a stated origin.
- A change in epidemic dynamics. The area's size changes the scale of counts only; R0, the curve's shape and the shares
  infected stay what they were for the same agents.

## Constraints

- Starsim v4 defaults and meanings (owner's rule, 2026-11-20).
- main is protected: a branch and a PR; the owner merges.
- The repository is public: no participant quotes or identifying details in code, tests or docs.
- No migration of saved scenarios (owner's decision 2, 2026-11-20: earlier conversations were testing). Existing
  scenarios without an area keep working.
- Anything mirrored between Python and TypeScript stays in step through the parity fixture.

## Approaches considered for the area population

- **A. An area population with the country's ages and contacts (chosen by the owner, 2026-11-21).** The user gives a
  number, or the assistant finds one with web search and cites it. Ages, household size, the contact matrix and vaccine
  coverage stay the country's. Works for any county, state or city; covers all four round-1 requests. Weakness: an area
  much younger or older than its country is slightly off, which the report says.
- **B. Real sub-national data.** The area's own population, ages and household size from the US Census (the key works).
  More accurate, but US only; it would have covered one of the four requests. Kept as the later US design.
- **C. Rescale only at report time.** Dropped: the chat and the panel would still show national counts, the source of the
  confusion.

For runs made before an area change, two options were weighed:
- **A new scenario when the area changes (chosen by the owner, 2026-11-21).** The report and comparisons stay at one
  population. The first run in the area is not compared with the national one.
- **One scenario, with each run labelled by its own population.** It allows national and county runs side by side, but
  one report would then mix two scales under one title.

## Design

### 1. Area population

**What the scenario holds.** A scenario gains an optional area: its name, its population (a positive whole number) and
the population's origin, either "you set it" or a cited web source (title and URL). The country total from
`fetch_demographics` is still recorded as the country's population.

**One population for scaling.** Every count that is scaled from agents to people uses one function: the area's population
when an area is set, otherwise the country total, otherwise no scaling. Today's direct uses of `scenario.totalPopulation`
for scaling move to it: `runSimulation.ts` (`popScale`), `configureSimulation.ts` (the peak-infections fit), the report
(`compose.ts`) and the run comparison.

**Setting it.** `configure_simulation` takes an area (name, population, and an optional source title and URL) and a way to
clear it. Rules:
- A population above the country's total is refused with the country's figure.
- A name without a number is refused with a message telling the assistant to ask or look it up.
- If the area population is below `run.n_agents`, `n_agents` is lowered to the population and the tool says so (an agent
  never stands for less than one person).

**A change of area starts a new scenario** (owner's decision, 2026-11-21). Setting, changing or clearing the area goes
through the existing `start_new_scenario` path and carries over everything else: the disease, the parameters, the
interventions and the country's fetched data.
- Earlier runs stay in the Runs section under the earlier scenario.
- Comparisons and reports cover the current scenario's runs, so every run they show was made at one population.
- The tool result and the assistant say that a new scenario started and why.
- Rescaling old runs to the new population would not be exact, because initial cases and treatment capacity are in
  people (section 3). A smaller population changes how the epidemic starts and how many people are treated, not just the
  totals.

**Fetching does not overwrite it.** `fetch_demographics` keeps setting the country's ages, household size, matrix and
total, and never replaces an area population. The same rule covers a household size the user set in the conversation:
the fetch leaves it and says it kept it. Today the fetch overwrites both (`fetchDemographics.ts`, the
`total_population` and `household_size` branches).

**What the assistant does (prompt).**
- When the user names an area with a number, set it.
- When the user names an area without one, look it up with web search, give the figure and its source in one line, set
  it, and invite a correction.
- Say once, plainly, that ages, contacts and vaccination coverage are the country's.
- Never promise an area figure without setting it.
- The prompt's recap example "Population 2 million (user's choice)" (`prompt.ts`) becomes an area example. The About
  section says what an area changes and what stays national.

**What the user sees.**
- The Scenario section gets a Population row, for example "2,000,000, Nairobi County (you set it)" or "11.2 million,
  Georgia, USA (source: [title])". With no area it shows the country's total and its source.
- The Data section keeps the country's total and adds one line: ages, contact patterns and vaccination coverage are
  [country]'s national figures.
- The recap shows the area.

**Reports.**
- The default title names the area ("Measles in Nairobi County, Kenya").
- The Population row shows the area and its origin.
- Limitations always include the sentence that ages, contacts and coverage are national.

### 2. Run comparison

`compareRuns` (`runSimulation.ts`) scales the previous run's agent counts with the current run's scale. When `n_agents`
changed between runs, the "before" figure is wrong.
- The fix (my call): take the previous run's counts as shares of its own agents, then multiply by today's population.
- That fixes a change of `n_agents`. It also keeps the existing deliberate rule that a population fetched between two
  runs does not show up as millions of extra infections.
- An area change starts a new scenario (section 1), so within a scenario this always compares runs at one population.

### 3. Counts in people: initial cases, treatment capacity, the peak-size fit

Three settings are counts that users give in people but EpiChat takes in agents. At a county's scale (200 people per
agent, say) "300 treated a day" becomes 60,000 a day. All three become people, stored as people and converted to agents
when a run starts. (Capacity and the fit were added after the reviewer's check, as my call: the goal that every count be
right for the population covers them.)

**Initial cases.** `seed_count` in `configure_simulation` means people, as users mean it. It is converted to agents when a run starts, using
that run's scale, rounded, and never less than one agent. Storing the people count, and not a converted agent count,
keeps it right when `n_agents` or the area changes later. When one agent already stands for more people than asked, the
tool result says the smallest seed possible at this run size and that more agents give a smaller one. The panel and the
tool result show the people count and the agents it became. `seed_fraction` is a share and needs no conversion. The
tool description and the registry text change to match.

**Treatment capacity.** `treatment_capacity` is people treated a day (today it goes straight into Starsim's `capacity` as
agents a day, `configureSimulation.ts`, while the report labels it as people). It is converted with the run's scale when
the run starts. When it is below one agent a day at this run size, the tool result says so. The per-1,000 conversion in
`fetchHealthSystem.ts` uses the scaling population. The panel row and the report label say "people a day".

**Peak-size fit.** A peak-infections target is converted to agents once, when it is set (`configureSimulation.ts`), and
goes stale when the area or `n_agents` changes. It is stored in people and converted when the run starts.

The diagnostics' suggested seeds and capacities are given in people too.

### 4. Doses delivered

Starsim v4 records, for each delivery, the number delivered per step (`results.<name>.delivered`). The simulation service
sums it per intervention, scales it like the other counts, and returns it with the run's stats, for vaccines (doses) and
treatments (courses given).
- The run tool result carries these totals.
- The prompt tells the assistant to quote doses from the run and never compute them from coverage.
- The report shows them in its run table.

The wording that led to the error changes too:
- The diagnostic lever "A campaign reaching X% of the susceptible" (`diagnostics.py`) says "of everyone eligible,
  vaccinated or not".
- The registry text for campaign coverage says the same: a campaign's coverage is a share of everyone in the eligible
  ages, including those already immune (`builder.py` applies it to all eligible agents).

### 5. The uncertainty band

The registry text for `run.n_replicates` says "the result shows the median run with 10 to 90% bands". The simulation
service already computes these bands (`replicates.py`, scaled in `sim/series.py`). The web app drops them
(`runSimulation.ts`: "the per-day bands wait for the workspace follow-up").
- The bands are stored with the run.
- The chart draws a shaded 10 to 90% band around the line of the run with the median total infected, whenever a run as
  agents has more than one replicate. A compartmental run has no band.
- Views (my call): the service computes bands today for infectious and cumulative infections only (`replicates.py`,
  `BAND_KEYS`). It adds new infections and deaths, so the infected, incidence, cumulative and deaths views all show a
  band. The compartments view does not. The shared conversation and the report figure draw it wherever they draw the
  same chart.
- The registry text says exactly that, and the typo "An compartmental run" goes.
- The run tool result says whether a band is shown, so the assistant does not claim one that is not there.

### 6. Run size

The run tool result already carries the agent count and the scale. The prompt says to quote the run size, agents and
people per agent, only from the tool result.

### 7. What EpiChat cannot do

**Prompt.** The About section states that EpiChat cannot run code, notebooks or other models, or export to them, and
names what it does instead: runs, comparisons, the report and its downloads. The assistant does not offer any of these.

**The compute cap.** The simulation service refuses runs above 500,000 agent-years (`n_agents × years × replicates`,
`SIM_MAX_AGENT_YEARS`).
- The web app reads the same setting with the same default.
- `configure_simulation` refuses a configuration above the cap and gives the largest `n_agents` that fits.
- The tool descriptions state the cap, so the assistant never offers a run above it.

### 8. Reports pick runs

`write_report` takes an optional list of runs, by the numbers the Runs section shows (`RunsSection.tsx`, `run.index`).
- With no list it covers the current scenario's runs, as now.
- A number that is not one of the current scenario's runs is refused with the valid numbers.
- The report's run labels use the panel's numbers ("Run 4, vaccine coverage 90%"), not a renumbering from 1
  (`compose.ts`, `runLabels`).
- The prompt says to use the panel's numbers when talking about runs, never letters.

### 9. A cache that outlasts a pause

The system prompt and the conversation breakpoint (`prompt.ts`, `runTurn.ts`) use the one-hour cache:
`cache_control: { type: "ephemeral", ttl: "1h" }`. No beta header is needed.
- Cost: a cache write costs 2× the base input price instead of 1.25×, and reads stay at 0.1×.
- Why: in think-aloud sessions many turns follow pauses longer than five minutes, and each such turn rewrote the whole
  conversation (the review's $0.20 to $0.40 turns).
- One-hour breakpoints must come before any five-minute ones. Web search adds its own five-minute writes after tool
  results, which comes later and is fine.
- Log `usage.cache_creation` by TTL so round 2 can confirm the saving.

### 10. A false "still spreading" note

The "run ended before the epidemic did" diagnostic (`diagnostics.py`, `_unfinished`) also fires when new infections in
the last window are a handful of agents above the window before. It fires only when the end of the run still holds a
meaningful number of infections.

## Acceptance checks

Each is a test where it can be one, and a walkthrough on the PR's preview before merge:

- Measles, Kenya, a county the user gives with a number: the panel, the recap, run counts and the report all use the
  county's population, and nothing shows the national total except the Data section's country line.
- A US state named without a number: the assistant finds and cites a figure, sets it, and says what stays national.
- Kenya runs, then a switch to a county: a new scenario starts with the same settings, and the county's report has no
  national rows.
- "The county can treat 300 people a day": the run treats at most 300 people a day, shown as such in the panel and
  report.
- "Start with 20 cases" at Kenya's scale: 20 people, shown with the agents it became.
- A campaign: the reported doses match the run's delivered totals.
- Two runs with different `n_agents`: the compare delta matches the two runs' scaled totals.
- Five replicates: a band is drawn, and the assistant says so; one replicate: no band, and no claim of one.
- A request for 1 million agents over 2 years: refused before running, with the largest size that fits.
- A report on two chosen runs of four: only those two, numbered as in the panel.
- A turn after a 10-minute pause: cache reads, not a full rewrite, in the logged usage.
- UNICEF coverage returns data for Kenya and the USA in production.

## Left to the builder

- How the area is stored (columns on `scenarios` or one JSON field) and the migration.
- How a user-set household size is recognized (the parameter origins the panel already uses, `parameters.ts`).
- The threshold for the "still spreading" note.
- The band's styling, and the layout of the Population row.
- Where the web app reads the compute cap from.
- The order of the work. Suggested: the run comparison, seeds and the cap (small); the area population; doses (service
  and web); the band; reports; the prompt; the cache.
