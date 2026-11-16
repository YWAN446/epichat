"""Bundle the mean household size by country (sim-parameters Part 2, 5.4):

    .venv/Scripts/python.exe scripts/fetch_household_size.py

Downloads the UN Population Division's Household Size and Composition workbook (2026 database) and writes
epichat/data/un_household_size.csv - iso3, household_size, reference_year, source - keeping, per country, the row with the latest
reference year that carries a numeric average. Rerun when the UN publishes a new database; the output is committed."""
from __future__ import annotations

import csv
import sys
import tempfile
import urllib.request
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
URL = "https://population.un.org/Household/assets/UNDESA_PD_2026_hh-size-composition.xlsx"
SHEET = "HH size and composition 2026"
COLUMNS = {"iso3": "ISO3 Code", "year": "Reference year", "size": "Average household size (number of members)", "source": "Data source category"}


def select_latest(rows: list[list]) -> list[dict]:
    """rows: the header row followed by the data rows (the workbook's sheet from its header on)."""
    header = [str(c).strip() if c is not None else "" for c in rows[0]]
    idx = {k: header.index(v) for k, v in COLUMNS.items()}
    best: dict[str, dict] = {}
    for r in rows[1:]:
        iso3 = r[idx["iso3"]]
        if not iso3 or len(str(iso3)) != 3:
            continue
        try:
            size, year = float(r[idx["size"]]), int(float(r[idx["year"]]))
        except (TypeError, ValueError):
            continue
        if iso3 not in best or year > best[iso3]["reference_year"]:
            best[str(iso3)] = {"iso3": str(iso3), "household_size": size, "reference_year": year, "source": str(r[idx["source"]])}
    return [best[k] for k in sorted(best)]


def main() -> int:
    tmp = Path(tempfile.gettempdir()) / "UNDESA_PD_2026_hh-size-composition.xlsx"
    if not tmp.exists():
        print(f"downloading {URL} ...", file=sys.stderr)
        urllib.request.urlretrieve(URL, tmp)
    ws = openpyxl.load_workbook(tmp, read_only=True, data_only=True)[SHEET]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    start = next(i for i, r in enumerate(rows) if r and "ISO3 Code" in r)
    out = select_latest(rows[start:])
    path = ROOT / "epichat" / "data" / "un_household_size.csv"
    with open(path, "w", newline="\n", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["iso3", "household_size", "reference_year", "source"], lineterminator="\n")
        w.writeheader()
        w.writerows(out)
    print(f"wrote {path.relative_to(ROOT)} ({len(out)} countries)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
