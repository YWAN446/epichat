"""Bundle the UN WPP 2024 tables the builder reads (sim-parameters Part 2, 6.1 and 6.2):

    .venv/Scripts/python.exe scripts/fetch_un_wpp_tables.py [--source <local copy of the single-age csv.gz>]

epichat/data/un_wpp_age.csv  - iso3, year (2024 and 2030), age (0 to 100), pop_thousands, Medium variant, countries only, from
    WPP2024_PopulationBySingleAgeSex_Medium_2024-2100.csv.gz (67 MB, downloaded to a temporary file unless --source names a copy).
epichat/data/un_wpp_cbr.csv  - iso3, year (2020 to 2050), cbr (per 1,000), from the bundled WPP2024_Demographic_Indicators_Medium.csv.
Rerun when the WPP vintage changes; the outputs are committed."""
from __future__ import annotations

import argparse
import csv
import sys
import tempfile
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "epichat" / "data"
AGE_URL = ("https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/"
           "WPP2024_PopulationBySingleAgeSex_Medium_2024-2100.csv.gz")
AGE_YEARS = (2024, 2030)
CBR_YEARS = range(2020, 2051)


def pyramid_rows(frame: pd.DataFrame) -> list[tuple[str, int, int, float]]:
    """(iso3, year, age, pop_thousands) for the Medium variant, the two pyramid years and the rows with an ISO3 code."""
    keep = frame[frame["ISO3_code"].notna() & (frame["Variant"] == "Medium") & frame["Time"].isin(AGE_YEARS)]
    return sorted((str(r.ISO3_code), int(r.Time), int(r.AgeGrpStart), float(r.PopTotal)) for r in keep.itertuples())


def cbr_rows(path: Path) -> list[tuple[str, int, float]]:
    out = []
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["ISO3_code"] and r["Variant"] == "Medium" and r["LocTypeName"] == "Country/Area" and int(r["Time"]) in CBR_YEARS and r["CBR"]:
                out.append((r["ISO3_code"], int(r["Time"]), float(r["CBR"])))
    return sorted(out)


def write_csv(path: Path, header: list[str], rows) -> None:
    with open(path, "w", newline="\n", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    print(f"wrote {path.relative_to(ROOT)} ({len(rows)} rows)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="a local copy of the single-age csv.gz instead of downloading it")
    args = parser.parse_args()
    source = args.source
    if source is None:
        tmp = Path(tempfile.gettempdir()) / "WPP2024_PopulationBySingleAgeSex_Medium_2024-2100.csv.gz"
        if not tmp.exists():
            print(f"downloading {AGE_URL} ...", file=sys.stderr)
            urllib.request.urlretrieve(AGE_URL, tmp)
        source = tmp
    frame = pd.read_csv(source, compression="gzip", usecols=["ISO3_code", "Variant", "Time", "AgeGrpStart", "PopTotal"], low_memory=False)
    write_csv(DATA / "un_wpp_age.csv", ["iso3", "year", "age", "pop_thousands"], pyramid_rows(frame))
    write_csv(DATA / "un_wpp_cbr.csv", ["iso3", "year", "cbr"], cbr_rows(DATA / "demographics" / "WPP2024_Demographic_Indicators_Medium.csv"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
