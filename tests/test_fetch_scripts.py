"""The parsing steps of the one-off fetch scripts, on inline rows (the downloads themselves are not tested)."""
import importlib.util
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_household_rows_keep_the_latest_numeric_value_per_country():
    fetch = load("fetch_household_size")
    header = ["Country and area", "ISO3 Code", "Reference year", "Data source category", "Average household size (number of members)"]
    rows = [header,
            ["Kenya", "KEN", "2014", "DHS", "4.0"], ["Kenya", "KEN", "2022", "DHS", "3.6"], ["Kenya", "KEN", "2019", "Census", ".."],
            ["Nowhere", None, "2020", "DHS", "2.0"], ["Zed", "ZZZ", "2001", "MICS", "5"]]
    out = fetch.select_latest(rows)
    assert out == [{"iso3": "KEN", "household_size": 3.6, "reference_year": 2022, "source": "DHS"},
                   {"iso3": "ZZZ", "household_size": 5.0, "reference_year": 2001, "source": "MICS"}]


def test_single_age_rows_keep_countries_in_the_two_pyramid_years():
    fetch = load("fetch_un_wpp_tables")
    frame = pd.DataFrame({"ISO3_code": ["KEN", "KEN", None, "KEN"], "Variant": ["Medium"] * 4, "Time": [2024, 2030, 2024, 2025],
                          "AgeGrpStart": [0, 0, 0, 0], "PopTotal": [1.5, 1.7, 9.9, 1.6]})
    out = fetch.pyramid_rows(frame)
    assert out == [("KEN", 2024, 0, 1.5), ("KEN", 2030, 0, 1.7)]
