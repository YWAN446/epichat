from __future__ import annotations

import csv
import datetime
import logging
import urllib.request

from epichat.resolver import DataQuery, ResolvedField

_BASE_URL = "https://population.un.org/dataportalapi/api/v1"

_VARIANT_MEDIAN = "4"
_SEX_BOTH = "3"
_ESTIMATE_METHOD_INTERP = "2"  # actual estimate (not projection)

_logger = logging.getLogger(__name__)


def _fetch_text(url: str, api_key: str | None = None) -> str:
    req = urllib.request.Request(url)
    if api_key:
        req.add_header("Authorization", f"Bearer {api_key}")
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8")


def _parse_csv(text: str) -> list[dict[str, str]]:
    lines = text.splitlines()
    if lines and lines[0].startswith("sep"):
        lines = lines[1:]
    reader = csv.DictReader(lines, delimiter="|")
    return list(reader)


class UNWPPAdapter:
    source_name = "un_wpp"

    def __init__(self, api_key: str | None = None) -> None:
        self._api_key = api_key
        self._loc_cache: dict[str, int] = {}
        self._load_locations()

    def _load_locations(self) -> None:
        url = f"{_BASE_URL}/locations?format=csv"
        try:
            text = _fetch_text(url, api_key=self._api_key)
            for row in _parse_csv(text):
                # Locations CSV header uses capitalized names: Id|Name|Iso3|Iso2|...
                loc_id = int(row["Id"])
                for key in ("Iso3", "Iso2", "Name"):
                    val = row.get(key, "").strip()
                    if val:
                        self._loc_cache[val] = loc_id
        except Exception:
            return

    def location_id(self, key: str) -> int | None:
        return self._loc_cache.get(key)

    def iso3_table(self) -> dict[str, int]:
        return {k: v for k, v in self._loc_cache.items() if len(k) == 3 and k.isupper()}

    def fetch(self, query: DataQuery) -> list[ResolvedField]:
        current_year = datetime.date.today().year  # always fetch up to present; query.end_year is not used
        ids = ",".join(str(i) for i in query.indicators)
        url = (
            f"{_BASE_URL}/data/indicators/{ids}"
            f"/locations/{query.location_id}"
            f"/start/{query.start_year}/end/{current_year}/?format=csv"
        )
        try:
            text = _fetch_text(url, self._api_key)
        except Exception as exc:
            _logger.warning("UNWPPAdapter fetch failed: %s", exc)
            return []
        return self._map_rows(_parse_csv(text), query.location_id)

    def _map_rows(self, rows: list[dict[str, str]], location_id: int) -> list[ResolvedField]:
        # Shared pre-filter: median variant, both-sexes only
        rows = [
            r for r in rows
            if r.get("VariantId") == _VARIANT_MEDIAN
            and r.get("SexId") == _SEX_BOTH
        ]
        # Birth/death rates and age distribution are interpolated estimates (method 2).
        # Population (indicator 49) uses method 3 in the UN WPP API, so it must be
        # extracted from the looser `rows` set rather than `interp_rows`.
        interp_rows = [r for r in rows if r.get("EstimateMethodId") == _ESTIMATE_METHOD_INTERP]

        results: list[ResolvedField] = []

        for ind_id, field_name in [("55", "birth_rate"), ("59", "death_rate")]:
            candidates = [
                r for r in interp_rows
                if r.get("IndicatorId") == ind_id and r.get("AgeLabel", "").strip() == "Total"
            ]
            if not candidates:
                continue
            best = max(candidates, key=lambda r: int(r.get("TimeId", 0)))
            year = best.get("TimeLabel", "")
            iso3 = best.get("Iso3", str(location_id))
            location_name = best.get("Location", str(location_id))
            results.append(ResolvedField(
                field=field_name,
                value=round(float(best["Value"]), 3),
                citation=f"UN WPP 2024, {location_name} ({iso3}), {year}",
            ))

        pop_candidates = [
            r for r in rows  # not interp_rows — indicator 49 uses EstimateMethodId=3
            if r.get("IndicatorId") == "49" and r.get("AgeLabel", "").strip() == "Total"
        ]
        if pop_candidates:
            best = max(pop_candidates, key=lambda r: int(r.get("TimeId", 0)))
            year = best.get("TimeLabel", "")
            iso3 = best.get("Iso3", str(location_id))
            location_name = best.get("Location", str(location_id))
            raw = float(best["Value"])
            # EstimateMethodId=2 (interpolated) returns value in thousands; method=3 (original)
            # returns actual count — multiply by 1000 only for the former.
            if best.get("EstimateMethodId") == _ESTIMATE_METHOD_INTERP:
                population = int(round(raw * 1000))
            else:
                population = int(round(raw))
            results.append(ResolvedField(
                field="total_population",
                value=population,
                citation=f"UN WPP 2024, {location_name} ({iso3}), {year}",
            ))

        age_rows = [r for r in interp_rows if r.get("IndicatorId") == "71"]
        pct: dict[str, float] = {}
        age_year: str = ""
        age_iso3: str = ""
        age_location_name: str = ""
        for label in ("0-17", "65+"):
            candidates = [r for r in age_rows if r.get("AgeLabel", "").strip() == label]
            if not candidates:
                continue
            best = max(candidates, key=lambda r: int(r.get("TimeId", 0)))
            pct[label] = round(float(best["Value"]), 3)
            age_year = best.get("TimeLabel", "")
            age_iso3 = best.get("Iso3", str(location_id))
            age_location_name = best.get("Location", str(location_id))

        if "0-17" in pct and "65+" in pct:
            pct["18-64"] = round(100 - pct["0-17"] - pct["65+"], 3)
            results.append(ResolvedField(
                field="age_distribution_pct",
                value=pct,
                citation=f"UN WPP 2024, {age_location_name} ({age_iso3}), {age_year}",
            ))

        return results
