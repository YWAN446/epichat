# EpiChat Chat UI Design Spec

## Goal

Replace the current 3-step wizard (`app.py`) with a Claude/Gemini-style conversational chat interface that guides non-modeler users (health analysts, surveillance officers, policy staff) through disease simulation setup via natural dialogue, shows data-sourced parameter summaries inline, and displays results in the same thread.

## Architecture

### Layout

**Sidebar** (always visible):
- EpiChat logo (🦠) + tagline: *"Ask an epidemiological question. Get a validated simulation."*
- `[+ New Chat]` button — clears session state, resets to empty state
- **RECENT** section — session-only list of previous conversations, each shown as the first user message truncated to ~50 characters; clicking restores that conversation's message thread from session state

**Main area — empty state** (no active conversation):
- Centered logo + tagline
- Chat input bar at bottom
- 4–6 short suggestion chips below the input (e.g. "Simulate HIV in Kenya", "Model measles, 80% vaccinated", "COVID with seasonality", "Ebola outbreak, R0=2"); clicking sends the chip text as the first user message

**Main area — active conversation**:
- Scrollable chat thread; user messages right-aligned, EpiChat messages left-aligned with 🦠 avatar
- Suggestion chips hidden once any message is sent
- Chat input bar always pinned at bottom

**Export buttons** (sidebar, visible only after first simulation result):
```
─────────────────────
Export conversation
[↓ Download PDF  ]
[↓ Download Word ]
```

### Session State

```python
{
    "conversations": [],        # list of {id, title, messages}
    "active_conv_id": None,     # currently open conversation
    "stage": "greeting",        # greeting | collecting | summarizing | ready | running | results
    "context": "",              # accumulated user inputs joined for parse_query()
    "params": None,             # SimParams | None
    "data_sources": [],         # list[ResolvedField]
    "plot_path": None,          # path to last plot PNG
    "collected": {              # which fields have been explicitly provided
        "disease": False,
        "location": False,
        "population": False,
        "interventions": False,
    },
}
```

Each conversation stored in `conversations` is a list of `{"role": "user"|"assistant", "content": str, "plot_path": str|None}` dicts.

## Conversation Flow

### Stage: `greeting`

EpiChat opens every new chat with:

> *"What would you like to simulate today? You can describe a disease, a location, a population size, and any interventions — or just start with what you know."*

### Stage: `collecting`

After each user message:

1. Append message to `context` string.
2. Run `parse_query(context)` silently.
3. Store `get_last_resolved()` in `data_sources`.
4. Check `collected` flags for the four required fields in priority order:
   - **disease** — `collected["disease"]` is set when `parse_query()` returns a non-default `disease_type` (i.e. something other than `"sir"`) OR when any disease-specific indicator (e.g. `hiv_prevalence`, `measles_coverage`) appears in `data_sources`. If not set, ask: *"What disease or pathogen would you like to model?"*
   - **location** — `collected["location"]` is set when `data_sources` contains a `total_population` field resolved from UN WPP or WB WDI (meaning a country was matched). If not set, ask: *"Which country or region? I can pull real demographic and health data if available."*
   - **population** — `collected["population"]` is set when `collected["location"]` is True (real population fetched) OR when the user's message contains a numeric population. If not set, ask: *"How large a population? I can use [Country]'s real population of [X] from UN data, or you can specify a number."*
   - **interventions** — always ask last: *"Are there any interventions to include — vaccination, treatment, or seasonal effects? Type 'none' to skip."*
5. Ask **one question at a time**. If all four flags are set (or interventions skipped), advance to `summarizing`.

Interventions is the only optional field — "none", "no", or "skip" sets the flag without adding an intervention.

### Stage: `summarizing`

EpiChat posts the parameter summary message:

```
Got it. Here's what I've put together:

  Disease      HIV/AIDS · SIS model · 10-year simulation
  Location     Kenya (pop. 58.6M) [UN WPP]
  Agents       100,000
  Prevalence   3.0% [WB WDI] ★
               ↳ 0.37/1,000/yr [WB WDI]
  Intervention Treatment · 50% coverage
               Capacity: 1.33 beds/1,000 [WB WDI] ★
               ↳ 0.289 physicians/1,000 [WB WDI]
               ↳ 2.273 nurses/1,000 [WB WDI]
  R₀ (approx)  1,228
  Mortality    2.0%

────────────────────────────────────────
UN WPP  UN World Population Prospects 2024. Official UN demographic
        projections for 237 countries. data.un.org
WB WDI  World Bank World Development Indicators. Annual country-level
        health & economic data from official national sources.
        datatopics.worldbank.org
WHO GHO World Health Organization Global Health Observatory. Disease
        surveillance and health system indicators. who.int/data/gho
────────────────────────────────────────

Would you like to adjust anything, or shall I run the simulation?
```

Rules for the summary:
- `★` marks the value actually used when alternatives (`↳`) exist.
- Only data sources actually used in the summary appear in the footnote block.
- Citation abbreviations (`[UN WPP]`, `[WB WDI]`, `[WHO GHO]`) appear inline next to each value.
- R₀ and Mortality are always shown; they have no citation (derived values).

Advance stage to `ready`.

### Stage: `ready`

Two possible user responses:

**Modification** — any message that changes a parameter (e.g. "change duration to 5 years", "add vaccination at 70%", "remove treatment"):
1. Call a new LLM function `apply_modification(params, message) -> SimParams` that interprets the plain-text change.
2. Re-post the full summary with updated values (same format, prefixed with *"Updated. Here's the revised summary:"*).
3. Ask the same closing question: *"Would you like to adjust anything, or shall I run the simulation?"*
4. Stay in `ready` stage.

**Run intent** — "yes", "run it", "looks good", "go ahead", or similar:
1. Advance to `running`.

### Stage: `running`

EpiChat posts: *"Running simulation…"* with a spinner.

Calls `EpiChat._execute_with_retry()` with current `params`, computes `pop_scale` from `total_population / n_agents` if available.

On error: posts the error message, returns to `ready` stage with the same summary and closing question.

On success: advance to `results`.

### Stage: `results`

EpiChat posts the results message:

```
✓ Simulation complete — HIV/AIDS in Kenya, 10 years

  Peak infections   61,122   (day 3,649)
  Total infected    68,532   (137.1% of agents)
  Deaths                 0

[epidemic curve plot — full width, st.image]

Kenya's HIV burden grows substantially over the decade, peaking at
~61,000 active infections near year 10...

Key findings:
· Peak represents ~61% of the modelled population
· Treatment at 50% coverage was insufficient to control transmission
· Zero recorded deaths may reflect a tracking limitation

─────────────────────────────────────────
Would you like to try a variation, or start a new simulation?
```

The plot is rendered via `st.image` inside the assistant message block.

User can now:
- Type a small variation ("now run without treatment", "increase vaccination to 80%") → `chat_controller` calls `apply_modification()`, re-posts updated summary, asks "Shall I run?", advances to `ready`
- Type a substantially new scenario ("now simulate measles in Brazil") → resets `collected` flags and `context`, restarts from `collecting` stage, appending to the same thread
- Type "new simulation" → equivalent to clicking New Chat (clears full session)
- Click New Chat in sidebar

Export buttons appear in sidebar after first result.

## Export

Both exports contain the full conversation in order: user messages, EpiChat text responses (including parameter summaries with citations and footnotes), and the epidemic curve plot embedded as an image.

**PDF** — generated in-memory using `fpdf2`:
- EpiChat messages: left-aligned, light grey background
- User messages: right-aligned, white background
- Plot: embedded PNG, full width
- Filename: `epichat_{first_user_message_slug}_{YYYYMMDD}.pdf`

**Word** — generated in-memory using `python-docx`:
- Same structure; plot inserted as `Document.add_picture()`
- Filename: `epichat_{first_user_message_slug}_{YYYYMMDD}.docx`

Both served via `st.download_button(data=bytes_buffer, ...)` — no temp files written to disk.

## New Modules

| File | Responsibility |
|---|---|
| `app.py` | Full rewrite: chat layout, session state, stage routing, render loop |
| `epichat/chat_controller.py` | Stage machine: `next_question()`, `build_summary()`, `detect_run_intent()` |
| `epichat/modifier.py` | `apply_modification(params, text) -> SimParams` via LLM call |
| `epichat/exporter.py` | `to_pdf(messages, plot_path) -> bytes`, `to_docx(messages, plot_path) -> bytes` |

Existing modules (`parser.py`, `resolver.py`, `epichat.py`, `narrator.py`, schema, adapters, templates) are unchanged.

## Out of Scope

- Email export (deferred until user accounts)
- Persistent chat history across browser sessions (deferred until user accounts)
- Side-by-side comparison of multiple simulation results (deferred)
- The existing `app.py` 3-step wizard is fully replaced; no backwards compatibility needed
