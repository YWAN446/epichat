# Vaccination coverage from UNICEF (the WHO GHO API is retired)

**Why.** `fetch_vaccination_coverage` reads WHO's GHO OData API (`ghoapi.azureedge.net`). Since at least 2026-10-27
every request there answers HTTP 500, the service root and `$metadata` included (Azure Front Door, `TCP_MISS`: the
origin is down). WHO's legacy page lists "GHO OData API (deprecated end of 2025)" and a "World Health Data Hub OData
API" whose link is `#`. The adapter turns every failure into "no rows", so the agent hears "no vaccination data
returned for KEN" when the source is down.

**Source.** UNICEF co-publishes the same WHO/UNICEF estimates (WUENIC) through SDMX:
`https://sdmx.data.unicef.org/ws/public/sdmxapi/rest/data/UNICEF,IMMUNISATION,1.0/{ISO3}.{IM_A+IM_B}.?format=csv&labels=id&startPeriod=YYYY`.
No key, about 0.2 s, 2025 revision (Kenya MCV1 80% in 2025). A query with no data answers 404 with an SDMX error
document (code 100). UNICEF has no Pol3 series.

**Owner's decisions (2026-11-03).** Switch to UNICEF. Polio uses the World Bank's Pol3 through Data360
(`WB_HNP_SH_IMM_POL3`, latest 2022). Hepatitis A has no coverage series (its current code `WHS3_45` is hepatitis B
dose 3, the wrong vaccine). Rubella uses its own vaccine, RCV1, not measles MCV1.

## Global constraints

- No migrations, no new npm dependencies (`npm --prefix web ci` only), Starsim stays 3.7.2, never re-capture
  `tests/fixtures/sim_baseline_v1.json`.
- Old conversations keep their stored payloads: `source: "who_gho"` stays in the `DataPayload` union and in
  `SOURCE_LABELS`.
- The frozen Python agent (`epichat/agent.py`, `epichat/adapters/who_gho.py`) and the parity export of the WHO
  adapter stay as they are.
- The what_if diagnostic keeps offering a vaccination campaign for exactly the seven diseases it offers one for today
  (measles, rubella, pertussis, polio, hepatitis A, tuberculosis, meningococcal).

## Task 1: the indicator list (Python, exported to the web)

- `epichat/params/indicators.py`:
  `VACCINE_INDICATORS = {"measles": ["IM_MCV1", "IM_MCV2"], "rubella": ["IM_RCV1"], "pertussis": ["IM_DTP3"],
  "polio": ["WB_HNP_SH_IMM_POL3"], "tuberculosis": ["IM_BCG"], "meningococcal": ["IM_MENGA"]}`, the sources' own
  codes (`IM_` UNICEF, `WB_` World Bank Data360). Add `VACCINE_DISEASES = frozenset(VACCINE_INDICATORS) |
  {"hepatitis_a"}` and `has_vaccine(disease)`; keep `has_vaccine_indicator`.
- `epichat/sim/diagnostics.py`: the campaign lever asks `has_vaccine`.
- Tests first: `tests/test_indicators.py` (the export equals the list; every code starts `IM_` or `WB_HNP_`; hepatitis A
  has a vaccine and no indicator; rubella is `IM_RCV1`; the frozen-copy equality is dropped, since the frozen agent
  keeps WHO's codes), `tests/test_sim_whatif.py` (hepatitis A still gets the campaign lever). Watch them fail.
- Regenerate `web/data/vaccine_indicators.json` with `scripts/export_web_data.py`.
- Verify: `pytest tests/test_indicators.py tests/test_sim_whatif.py tests/test_web_exports.py`.

## Task 2: the UNICEF adapter and the World Bank's Pol3 (web)

- `web/lib/data/unicef.ts`: `UNICEF_BASE_URL`; `UNICEF_INDICATOR_MAP` (code to `[field, description]`: BCG, DTP3,
  HEPB3, HIB3, MCV1, MCV2, RCV1, ROTAC, HPV, MENGA, YFV, PAB; fields `<vaccine>_coverage` as the client labels them);
  `parseCsv` (quoted fields, doubled quotes, CRLF); `mapUnicefRows(rows, codes, iso3)` (per code, the latest year
  with a value, in the requested order; citation `WHO/UNICEF estimates, KEN, 2025`); `fetchUnicef(query, opts)`: one
  request for all codes, `startPeriod` ten years back, 404 means no data (`[]`), any other failure throws
  `UNICEF data service unavailable (...)` so the tool can say the source is down.
- `web/lib/data/types.ts`: `DataQuery.source` gains `"unicef"`; `Adapters.whoGho` becomes `Adapters.unicef`.
  `web/app/api/chat/route.ts` binds it. Delete `web/lib/data/whoGho.ts` and its tests.
- `web/lib/data/wbData360.ts`: `WB_HNP_SH_IMM_POL3: ["polio_coverage", ...]`; the citation names the database
  (`WB HNP`, `WB WDI` as before by default).
- Fixtures under `web/tests/fixtures/unicef/` (real responses: Kenya MCV1+MCV2, the 404 document).
- Tests first in `web/tests/data/adapters.test.ts`.

## Task 3: the tool, the labels and the prompt (web)

- `fetchVaccinationCoverage`: `VACCINE_CODES` (was `GHO_CODES`); `IM_` codes go to `adapters.unicef`, `WB_` codes to
  `adapters.wbData360` with `databaseId: "WB_HNP"`; the payload's source is `unicef` or `wb_data360`.
- `DataPayload.source` and `SOURCE_LABELS` gain `unicef: "WHO/UNICEF immunization estimates"`; `VACCINES` gains
  `rcv1`; the tool description (`lib/tools/index.ts`), the tool lines (`lib/client/toolLine.ts`), the prompt's source
  list (`lib/chat/prompt.ts`) and the report's `sourceOf` name the new source.
- Tests first in `web/tests/tools/fetchTools.test.ts` (routing, the down-source message, hepatitis A has no
  indicator, polio through the World Bank); `helpers.ts` gains the `unicef` adapter.
- Verify: `npm --prefix web test`, `npm --prefix web run typecheck`, `npm --prefix web run lint`.

## Task 4: the docs

- `docs/docs.html` (the architecture diagram and the data-sources table) and `README.md`'s data-source row name
  UNICEF's WHO/UNICEF estimates and the World Bank's Pol3, and say the GHO API is retired.

## Review focus

Real response shapes (quoted CSV fields, empty `OBS_VALUE`, the 404 document, an HTML 500 page); stored `who_gho`
payloads still render; the hepatitis A lever; the tool description sits in the cached prompt prefix; the live
service for Kenya measles, Nigeria polio, US rubella and US meningococcal (no data).
