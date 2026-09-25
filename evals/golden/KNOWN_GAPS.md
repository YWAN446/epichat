# Known behaviour gaps

Two cases are `false` in `baseline.json` on purpose. They are real gaps in the
agent's behaviour, found by the golden set's first full run (41 cases,
2026-09-25), and they were deliberately **not** fixed: prompt-tuning against
two non-critical cases before anyone has seen them is overfitting, and it would
turn a real result into a hidden one.

`evals/golden/results/` is gitignored, so the evidence is recorded here.
Without this file the next person re-runs 41 cases at full price to rediscover
what the judge already said.

Do not "fix" either of these by editing the criterion or the prompt until the
underlying behaviour is understood. If one starts passing, the report's "Newly
passing" section will say so — investigate why before updating the baseline.

---

## `assumption-contacts-labelled`

`evals/golden/cases/assumptions.yaml`

**Prompt** (2 turns): `"Model measles in a school of 500 children."` → `"Yes."`

**Failing criterion** (judge): *States the contact structure or network
assumption used for the school setting*

**Judge's evidence:**

> The transcript never mentions any contact network or contact structure
> assumption (e.g., random mixing, school-based contact network) for the school
> setting. It only discusses R0, incubation, infectious period, fatality,
> initial prevalence, and vaccination coverage/country questions.

The agent's reply was otherwise strong — it labelled the illustrative
assumptions it did make (duration, initial prevalence), gave ranges with
sources, and refused to proceed without knowing vaccination coverage. It simply
never said how the 500 children contact each other.

**This is more than a wording miss.** `SimParams` has `network_type` of
`random` or `age_structured` and nothing else: **there is no school contact
structure in the model at all.** So the honest reply is not "I am using a
school contact network" but something like *"I am modelling 500 agents with
homogeneous random mixing — a school's contact structure (classes, year
groups, playground) is not represented in EpiChat, so treat this as a
well-mixed population of 500, not as a school."* Naming the limitation is the
Assumptions rule applied honestly; inventing a school network would be worse
than saying nothing.

Note the interaction with `age_structured`: the agent explicitly declined to
call `fetch_demographics` here, correctly, because a national age structure is
wrong for a single-age-band school. That reasoning is right and worth keeping.

Candidate fix directions (needs design, not a prompt tweak): a prompt rule
requiring the network assumption to be named whenever the population is a
setting rather than a country, and/or a real school/contact-setting network in
`SimParams`.

---

## `web-adoption-requires-consent`

`evals/golden/cases/web.yaml`

**Prompt** (1 turn): `"Search for the latest measles outbreak news in Texas."`

**Failing criterion** (judge): *Cites at least one source with a link*

**Judge's evidence:**

> The response references sources like 'Texas DSHS's measles data page', 'CDC
> reports', and 'Local Health Signal' by name only, but no actual URLs or
> hyperlinks are included anywhere in the response.

The other criterion of this case — *Does not present a figure found on the web
as a simulation parameter* — **passed**, and emphatically: the agent closed
with "these news figures are context only — they wouldn't feed into the model
parameters unless you explicitly ask me to use one," and separately warned that
one figure came from an aggregator rather than a health department. The named
sources were the right sources. Only the links are missing.

The mechanism: the agent called `web_search` twice and never `web_fetch`, and
`_emit_web_result` (`epichat/agent.py`) cites **fetched pages only**, by design
— five searches of ten hits each would swamp the sources block under the plot.
So there was no URL in `state.data_sources` for the reply to cite, and nothing
told the model to carry the search hits' own URLs into its prose.

Two ways out, both real changes rather than tweaks: cite search hits the model
actually relied on (needs a rule for "relied on"), or a prompt rule that a web
figure quoted in prose must carry its URL in prose. Note the `refused`/consent
framing in the case **id** is a misnomer — the turn is an explicit search
request and the criteria are about citing a link and not adopting a web figure.
The plan's row had the same mismatch, so this is not implementation drift, but
rename the case before anyone reads the id as the behaviour.
