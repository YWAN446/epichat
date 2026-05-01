from __future__ import annotations

import json
import logging
import urllib.request
from urllib.parse import quote

from epichat.resolver import DataQuery, ResolvedField

_BASE_URL = "https://ghoapi.azureedge.net/api/"

_logger = logging.getLogger(__name__)

INDICATOR_MAP: dict[str, str] = {
    # Vaccination coverage
    "WHS3_40": "bcg_coverage",
    "WHS3_41": "dtp3_coverage",
    "WHS3_43": "polio_coverage",
    "WHS3_45": "hepb3_coverage",
    "WHS3_46": "hib3_coverage",
    "WHS3_49": "mcv1_coverage",
    "MCV2":    "mcv2_coverage",
    "PCV3":    "pcv3_coverage",
    "ROTAC":   "rotac_coverage",
    "SDGHPV":  "hpv_coverage",
    "MENGA":   "menga_coverage",
    "WHS3_48": "yfv_coverage",
    "PAB":     "pab_coverage",
    # Disease surveillance
    "WHS3_62": "measles_cases",
    "WHS3_56": "pertussis_cases",
    "WHS3_59": "poliomyelitis_cases",
    "WHS3_55": "diphtheria_cases",
    "WHS3_51": "rubella_cases",
    "WHS3_54": "mumps_cases",
    "WHS3_57": "tetanus_cases",
    "WHS3_58": "neonatal_tetanus_cases",
    "WHS3_60": "yellow_fever_cases",
    "WHS3_61": "japanese_encephalitis_cases",
    "WHS3_63": "congenital_rubella_cases",
    # Population denominator
    "WHS9_86": "total_population",
}


def _fetch_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=15) as resp:
        return resp.read().decode("utf-8")


class WHOGHOAdapter:
    source_name = "who_gho"

    def fetch(self, query: DataQuery) -> list[ResolvedField]:
        results: list[ResolvedField] = []
        for code in query.indicator_codes:
            field_name = INDICATOR_MAP.get(code)
            if field_name is None:
                continue
            filter_expr = f"SpatialDim eq '{query.location_code}'"
            url = f"{_BASE_URL}{code}?$filter={quote(filter_expr, safe=chr(39))}"
            try:
                text = _fetch_text(url)
                data = json.loads(text)
            except Exception as exc:
                _logger.warning("WHOGHOAdapter fetch failed for %s: %s", code, exc)
                continue
            rows = [
                r for r in data.get("value", [])
                if r.get("NumericValue") is not None
            ]
            if not rows:
                continue
            best = max(rows, key=lambda r: int(r.get("TimeDimensionValue") or 0))
            year = best["TimeDimensionValue"]
            value = best["NumericValue"]
            results.append(ResolvedField(
                field=field_name,
                value=value,
                citation=f"WHO GHO, {query.location_code}, {year}",
            ))
        return results
