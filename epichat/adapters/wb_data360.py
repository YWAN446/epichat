from __future__ import annotations

import json
import logging
import urllib.request

from epichat.resolver import DataQuery, ResolvedField

_BASE_URL = "https://data360api.worldbank.org"

_logger = logging.getLogger(__name__)

# Maps Data360 indicator ID → (field_name, description)
INDICATOR_MAP: dict[str, tuple[str, str]] = {
    # Health system — capacity
    "WB_WDI_SH_MED_BEDS_ZS":    ("treatment_capacity", "hospital beds/1,000"),
    "WB_WDI_SH_MED_PHYS_ZS":    ("treatment_capacity", "physicians/1,000"),
    "WB_WDI_SH_MED_NUMW_P3":    ("treatment_capacity", "nurses/1,000"),
    # Health system — coverage
    "WB_WDI_SH_UHC_SRVS_CV_XD": ("uhc_coverage",       "UHC service coverage index 0–100"),
    # Disease — TB
    "WB_WDI_SH_TBS_INCD":        ("tb_incidence",        "per 100,000/yr"),
    # Disease — HIV
    "WB_WDI_SH_DYN_AIDS_ZS":    ("hiv_prevalence",      "% of population ages 15–49"),
    "WB_WDI_SH_HIV_INCD_TL_P3": ("hiv_prevalence",      "per 1,000 uninfected/yr"),
    # Disease — malaria
    "WB_WDI_SH_MLR_INCD_P3":    ("malaria_incidence",   "per 1,000 population at risk/yr"),
    # Disease — diabetes
    "WB_WDI_SH_STA_DIAB_ZS":    ("diabetes_prevalence", "% of adults ages 20–79"),
    # Disease — hepatitis B
    "WB_WDI_SH_HEP_HBVS_ZS":    ("hepb_prevalence",     "% of population"),
    # Demographics (WDI alternatives to UN WPP)
    "WB_WDI_SP_DYN_CBRT_IN":    ("birth_rate",           "crude birth rate/1,000/yr"),
    "WB_WDI_SP_DYN_CDRT_IN":    ("death_rate",           "crude death rate/1,000/yr"),
    "WB_WDI_SP_POP_TOTL":       ("total_population",     "total population"),
    "WB_WDI_SP_POP_0014_TO_ZS": ("age_distribution_pct", "population ages 0–14 (%)"),
    "WB_WDI_SP_POP_65UP_TO_ZS": ("age_distribution_pct", "population ages 65+ (%)"),
}

# Which indicators share a logical field and which is primary
CANDIDATE_GROUPS: dict[str, dict] = {
    "treatment_capacity": {
        "primary": "WB_WDI_SH_MED_BEDS_ZS",
        "alternatives": ["WB_WDI_SH_MED_PHYS_ZS", "WB_WDI_SH_MED_NUMW_P3"],
    },
    "hiv_prevalence": {
        "primary": "WB_WDI_SH_DYN_AIDS_ZS",
        "alternatives": ["WB_WDI_SH_HIV_INCD_TL_P3"],
    },
}

# Population divisor for converting raw indicator values to init_prev fractions.
# Prevalence fields (suffix _prevalence): init_prev = value / scale
# Incidence fields (suffix _incidence): init_prev = value / scale / 365 * dur_inf
INCIDENCE_SCALE: dict[str, float] = {
    "tb_incidence":        100_000,   # per 100k/yr
    "malaria_incidence":   1_000,     # per 1k/yr
    "hiv_prevalence":      100,       # percent
    "diabetes_prevalence": 100,       # percent
    "hepb_prevalence":     100,       # percent
}


def _fetch_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=15) as resp:
        return resp.read().decode("utf-8")


class WorldBankData360Adapter:
    source_name = "wb_data360"

    def fetch(self, query: DataQuery) -> list[ResolvedField]:
        # Fetch each requested indicator, keep only valid rows
        raw: dict[str, tuple[float, str]] = {}   # code → (value, year)
        for code in query.indicator_codes:
            if code not in INDICATOR_MAP:
                continue
            url = (
                f"{_BASE_URL}/data360/data"
                f"?DATABASE_ID={query.database_id}"
                f"&INDICATOR={code}"
                f"&REF_AREA={query.location_code}"
                f"&timePeriodFrom={query.start_year}"
                f"&timePeriodTo={query.end_year}"
            )
            try:
                text = _fetch_text(url)
                data = json.loads(text)
            except Exception as exc:
                _logger.warning("WorldBankData360Adapter fetch failed for %s: %s", code, exc)
                continue
            rows = [r for r in data.get("value", []) if r.get("OBS_VALUE") is not None]
            if not rows:
                continue
            best = max(rows, key=lambda r: r.get("TIME_PERIOD", "") or "")
            raw[code] = (float(best["OBS_VALUE"]), best.get("TIME_PERIOD", "unknown"))

        if not raw:
            return []

        results: list[ResolvedField] = []
        consumed: set[str] = set()

        # Grouped candidates
        for field_name, group in CANDIDATE_GROUPS.items():
            primary_code = group["primary"]
            if primary_code not in raw:
                continue
            primary_value, primary_year = raw[primary_code]
            _, primary_desc = INDICATOR_MAP[primary_code]
            consumed.add(primary_code)

            alternatives: list[ResolvedField] = []
            for alt_code in group["alternatives"]:
                if alt_code not in raw:
                    continue
                alt_value, alt_year = raw[alt_code]
                _, alt_desc = INDICATOR_MAP[alt_code]
                alternatives.append(ResolvedField(
                    field=field_name,
                    value=alt_value,
                    citation=f"WB WDI, {query.location_code}, {alt_year}",
                    description=alt_desc,
                ))
                consumed.add(alt_code)

            results.append(ResolvedField(
                field=field_name,
                value=primary_value,
                citation=f"WB WDI, {query.location_code}, {primary_year}",
                description=primary_desc,
                alternatives=alternatives,
            ))

        # Single-candidate fields
        for code, (value, year) in raw.items():
            if code in consumed:
                continue
            field_name, description = INDICATOR_MAP[code]
            results.append(ResolvedField(
                field=field_name,
                value=value,
                citation=f"WB WDI, {query.location_code}, {year}",
                description=description,
            ))

        return results
