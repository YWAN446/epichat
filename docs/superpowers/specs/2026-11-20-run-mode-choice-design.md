# Choosing how a scenario runs: agents or a compartmental model (design, 2026-11-20)

On the `starsim-v4` branch (Starsim 4.0.0rc5). Follows the review in `docs/starsim-v4-review-2026-11.md`, owner decision 1.

## Intent

Starsim v4 runs the same declared disease either as agents (`ss.Sim(n_agents=...)`) or as a compartmental model, an ODE
(`ss.Sim(total_pop=...)`). Cliff's port picks for the user: `needs_agents` (`epichat/sim/builder.py:59`) returns agents only
for the hybrid network, lasting or Poisson-distributed contacts, or a treatment with a delay, so the default scenario and the
age-structured network always run as an ODE. The two modes give different answers in some scenarios (an ODE never fades out:
SIRS over three years infects 313% as an ODE against 81% as agents) and look different in all of them (one smooth curve
against a run of individuals).

The owner wants both modes available and the user to choose, with EpiChat recommending one and explaining the trade-off for
this scenario. The explanation is part of the point: it teaches what each kind of model can and cannot show.

## Goals

- Before the first run of a scenario, EpiChat asks which mode to use, recommends one, and says why in two or three sentences
  pitched to the participant's experience.
- The recommendation and its reasons come from the scenario's settings, by a rule in code, so the same scenario always gets
  the same recommendation and the reasons can be tested.
- Both modes are available for every scenario that can run as an ODE. A scenario that needs agents runs as agents, and
  EpiChat says why instead of asking.
- The choice is saved with the scenario, so a shared link, a report or a re-run reproduces it.

## Non-goals

- No control for the mode in the parameters panel; the panel is read-only today and the choice goes through the chat.
- No change to the default number of replicates (1). Bands still need `run.n_replicates` above 1.
- No compartmental form of the scenarios that need agents (the Starsim questions about those stay with Cliff).

## Anti-goals (a failure even if it works)

- An extra turn in the conversation just for this question. It rides on the existing "Run it" step.
- The same scenario getting different recommendations in different conversations.
- A compartmental run, chosen by nobody, of a scenario where the rule says the ODE gives a different answer.
- Jargon for a beginner: "ODE" never appears for experience "none".

## Constraints and what exists

- `configure_simulation` runs in TypeScript (`web/lib/tools/configureSimulation.ts`) and does not call the Python service; only
  `run_simulation` does (`POST /simulate`). Logic both sides need is written in Python and mirrored in TypeScript, pinned by the
  parity fixture (`scripts/export_parity_fixtures.py` → `web/tests/fixtures/parity.json`, `web/tests/sim/parity.test.ts`), as
  `approx_r0` is today.
- Forcing agents on the scenarios the branch runs as an ODE works today: the default random network gives 0.892 infected as an
  ODE and 0.887 to 0.900 over eight agent seeds; the age-structured network gives 0.996 and 0.995 to 0.996. A run as agents of
  either takes 0.06 to 0.13 s for 10,000 people over a year, so speed is not a reason to prefer the ODE for one run.
- EpiChat ends each reply with up to three suggested replies, which the interface shows as buttons (`next` block,
  `web/lib/chat/prompt.ts:50`). A run already reports its mode (`stats.solver`, "ode" or "abm"), shown as "Ran as ..." under
  the run (`web/components/RunSummary.tsx:62`) and in the report (`web/lib/report/compose.ts:131`).
- The prompt contradicts itself today: line 25 calls EpiChat "an agent-based epidemic simulation", line 26 says it runs a
  compartmental model when it can.

## Approaches

- **A. Ask before the first run; the recommendation computed by a rule in code (chosen).** The rule reads the settings and
  returns the recommended mode, whether agents are required, and the reasons; EpiChat explains them. Consistent and testable;
  more code (the rule in Python and TypeScript, a setting, the tool result, the prompt).
- **B. Ask before the first run; EpiChat recommends from guidance in its prompt.** Smallest change, but the recommendation can
  differ between conversations, and EpiChat can miss a reason that comes from data (a disease lookup that sets waning immunity).
- **C. Ask only when the two modes would differ.** Fewer questions, but it drops the question the owner asked for in most
  scenarios.

The owner picked A (2026-11-20). Asked after a builder check, the owner also decided that agents are recommended when nothing
depends on chance, and that a change arriving with a request to rerun runs in the mode chosen and is then explained.

## Design

### The setting

`run.solver`: `"abm"` (agents), `"ode"` (compartmental), or unset (null, the default: not chosen yet). The values match
`stats.solver`. A new registry entry (`epichat/params/registry.py`, exported to `web/data/param_registry.json`), the Python
schema (`RunParams`), the TypeScript schema (`RunSchema` in `web/lib/sim/params.ts`) and a first-class `solver` field on
`configure_simulation`'s input, since EpiChat sets it in nearly every conversation.

### The rule

A pure function with no Starsim import, `recommend_solver(params) -> {recommended, required, reasons}`, with `reasons` a list
of `{code, text}`. `needs_agents` and `well_mixed` move beside it, and the builder imports them.

1. **Required** (`required: true`, `recommended: "abm"`), the cases `needs_agents` covers today, one reason each:
   `hybrid_network`, `lasting_contacts`, `poisson_contacts`, `treatment_delay`.
2. **Agents recommended** (`required: false`, `recommended: "abm"`), one reason for each that applies. Each reason fires only
   when the ODE can give a different answer:
   - `waning`: immunity wanes (SIS, SIRS, SEIRS) and the run is long enough for infections to return. As an ODE they fall to a
     fraction of a person and grow back; as agents they can die out between waves.
   - `births`: births and deaths over more than a year bring in new susceptibles, with the same effect.
   - `temporary_measure`: a contact or transmission reduction that ends before the run does. As an ODE the epidemic always
     rebounds afterwards; as agents a suppressed outbreak can end.
   - `early_dieout`: few initial infections at a low R0, so a fair share of runs die out early by chance (from the branching
     approximation with the configured R0 and the number of seeds; fires at a chance of 5% or more).
   - `replicates`: `run.n_replicates` above 1; replicates and bands exist only for agents.
3. **Neither** (no reason above applies): the two modes give the same epidemic, and **agents are still recommended** (the
   owner's decision, 2026-11-20), with one reason `same_answer` ("nothing here depends on chance, so both give the same
   epidemic: agents show it as individual people, a compartmental model as its exact average curve"). Agents are therefore
   recommended for every scenario; the reasons say how much it matters for this one. This keeps main's behaviour and the
   agent-based framing, and a run as agents costs about 0.1 s.

The texts are short English sentences for EpiChat to rephrase, identical in Python and TypeScript.

### Which mode runs

The builder runs agents when the scenario requires them, when `run.solver` is "abm", or when it is unset and the recommendation
is agents. Otherwise it runs the ODE. It says so to Starsim with its own `solver=` parameter (`'abm'` or `'ode'`; Starsim's
default, `'auto'`, would pick the ODE whenever the model has a compartmental form), with `n_agents` for agents and `total_pop`
for the ODE as today. A scenario that requires agents runs as agents even if `run.solver` is "ode"; the run
reports "abm", and `configure_simulation`'s result has already said agents are required. A fit uses the same mode as the run.

**The first run records its mode** (builder's call, 2026-11-20). When a run starts with `run.solver` unset, `run_simulation`
(`web/lib/tools/runSimulation.ts`) writes the mode about to run into `run.solver` first, in code, not by a prompt instruction.
Running without picking, with the recommendation on screen, counts as accepting it. So after the first run `chosen` is always
the mode in use, a later change never switches the mode silently, and later tuning of the rule's thresholds does not change
how a saved scenario re-runs.

### What `configure_simulation` returns

Every result carries `solver: {chosen, recommended, required, reasons, new_reasons}`, computed by the TypeScript mirror after
the change is applied, so EpiChat always knows whether a choice is pending and what to recommend. `new_reasons` lists the codes
of the agent reasons (section 2 of the rule) that fire after this change and did not before it; `configure_simulation`
already has the scenario before the change, so it runs the rule on both (builder's call, 2026-11-20). Since agents are
recommended everywhere, "the recommendation turned against a compartmental choice" means exactly that `new_reasons` is not
empty while `chosen` is "ode".

### What EpiChat does (prompt)

- **Before the first run of a scenario** (`chosen` unset, not required): in the message that offers to run, give the
  recommendation and its reasons, and what the other mode trades away, in two or three sentences for the participant's
  experience level. The suggested replies replace "Run it" with "Run as agents" and "Run as a compartmental model", the
  recommended one first and marked "(recommended)". When the user picks, set `solver` and run in the same turn.
- **If the user just says to run** without picking: use the recommended mode and say so in one sentence.
- **Required**: say once, in one sentence, that this scenario runs as agents and why; no question.
- **Later changes**, when `chosen` is "ode" and `new_reasons` is not empty (a compartmental run, then waning immunity is
  added). This can only happen to a user who chose the compartmental model themselves.
  - If the same message also asks for a run (every "Try next" lever ends "and rerun"): run in the compartmental model as
    chosen, so the comparison with the previous run stays clean; then say in one sentence that agents would now be
    recommended and why, and offer "Rerun as agents" among the suggested replies (the owner's decision, 2026-11-20).
  - Otherwise: say why in one sentence and offer the two buttons again before running.
  - If a change makes agents required, say so in one sentence; the run is as agents whatever was chosen.
- **Switching on request** ("run it as agents"): set `solver` and run.
- **The general trade-off**, in the prompt for EpiChat to draw on: agents simulate individual people, so outbreaks can die out
  by chance, replicates give bands, and the R0 formula is approximate; a compartmental model gives one smooth average curve,
  the R0 formula exactly, the same result every time, never dies out, and can count fractions of a person.
- **Wording**: line 25 no longer says "agent-based"; it says EpiChat runs a scenario as simulated individuals or as a
  compartmental model, and lets the user choose. Line 26 and the paragraph at line 104 follow the new behaviour.

### Documentation

The registry texts for `run.n_agents` and `run.n_replicates`, `README.md` (lines 31 and 137), and the model section of
`docs/docs.html` describe the choice instead of "an ODE unless something needs agents".

### Saved scenarios

A scenario saved before this change has `run.solver` unset, so it runs as agents, as the rule recommends for every scenario.
That changes how the default and age-structured scenarios re-run on the branch today (as an ODE), and matches main, which ran
everything as agents.

## Testing

- **The rule:** for each reason, a scenario where it fires and a close one where it does not; `required` for each of the four
  cases; `same_answer` alone when nothing applies.
- **The reasons are real:** for each agent reason, a run of its scenario where the ODE and agents differ by a clear margin,
  so a reason never claims a difference that does not exist. For `same_answer`, a scenario where they agree within a few points.
- **Which mode runs:** "abm" on the default scenario runs agents; "ode" on the hybrid network runs agents; unset follows the
  recommendation.
- **Parity:** the fixture adds `recommend_solver` on the seeded parameter sets, plus targeted cases for every reason. The
  TypeScript mirror matches codes and texts exactly.
- **configure_simulation:** the result carries the `solver` block, and the `solver` field sets `run.solver`; `new_reasons`
  lists a reason a change adds (waning immunity added to a compartmental scenario) and is empty when the change adds none.
- **run_simulation:** a run with `run.solver` unset writes the mode it runs into `run.solver` before calling the service.
- Test first, as for the review fixes: each test fails before its change.

## Left to the builder

- The exact thresholds of `waning`, `early_dieout` and `temporary_measure` (for example, how long the run must outlast the mean
  immunity, or how close to the end a reduction may stop), set so that the "reasons are real" tests pass with a clear margin.
  As built (`epichat/params/solver.py`, after the final review):
  - `waning`: R0 above 1 and a run longer than 2.5 mean immunity periods. A compartmental model's next wave comes after 2
    (gamma or lognormal immunity) to 2.5 (constant) periods; at 1 to 2 periods the two modes agree.
  - `births`: R0 above 1 and a run of more than 3 times the years births need to restore a susceptible share of 1/R0 from the
    final-size share. A compartmental model's next wave comes at 2.6 to 2.8 times (R0 5 to 15, births 20 to 40 per 1,000).
  - `temporary_measure` and `early_dieout` use R at the start, R0 × (1 − the initial immune share), not R0. This departs from
    "the configured R0" above: with R0 alone, measles at 92% coverage claimed `same_answer`, although agents die out early
    about 15% of the time.
    - `temporary_measure`: a reduction that ends before the run does, lasts at least one infectious period, and holds R at the
      start above 1 and R × (1 − scale) below 1.
    - `early_dieout`: R at the start above 1, and a chance of at least 5% that every seed's chain dies out. That chance is s^n
      for a count of seeds and exp(−n(1 − s)) for a fraction, which agents draw per agent; s is the final-size root.
  - SIS is not under `waning`: it stays endemic, with no trough for a compartmental model to come back from.
- The exact wording of the reason texts and of the prompt, within the rules above.
- Where the pure function lives (for example `epichat/params/solver.py`, with `web/lib/sim/solver.ts`).
- Whether to drop `run.n_agents`'s mention of the two Starsim calls from its mapping text.
