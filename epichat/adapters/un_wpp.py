from __future__ import annotations

import csv
import io
import urllib.error
import urllib.request

from epichat.resolver import DataQuery, ResolvedField

_BASE_URL = "https://population.un.org/dataportalapi/api/v1"


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
                loc_id = int(row["id"])
                for key in ("iso3", "iso2", "name"):
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
        return []  # implemented in Task 3
