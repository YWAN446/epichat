"""The bundled country tables of Part 2 (section 10) and their loaders: the UN WPP 2024 age pyramids (2024 and 2030) and projected crude
birth rates (2020 to 2050), the UN household sizes (2026 database), and the Prem et al. 2021 contact matrices aggregated to the three age
groups. Every loader is cached, takes an ISO3 code in any case and returns None for a country its table does not know. The tables are
written by scripts/fetch_un_wpp_tables.py, scripts/fetch_household_size.py and scripts/fetch_contact_matrices.py."""
from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path

import numpy as np

DATA = Path(__file__).resolve().parents[1] / "data"
AGE_YEARS = (2024, 2030)
MAX_AGE = 100                                      # the pyramid's last single age (100 and over)
PREM_BANDS = tuple(range(0, 80, 5))               # sixteen five-year bands, the last one 75 and over
GROUP_BOUNDS = ((0, 18), (18, 65), (65, MAX_AGE + 1))   # children, adults, elderly on single ages


def _rows(name: str) -> list[dict]:
    with open(DATA / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _band_ages(b: int) -> list[int]:
    start = PREM_BANDS[b]
    return list(range(start, MAX_AGE + 1 if b == len(PREM_BANDS) - 1 else start + 5))


@lru_cache(maxsize=1)
def _pyramids() -> dict[tuple[str, int], np.ndarray]:
    out: dict[tuple[str, int], np.ndarray] = {}
    for r in _rows("un_wpp_age.csv"):
        out.setdefault((r["iso3"], int(r["year"])), np.zeros(MAX_AGE + 1))[int(r["age"])] = float(r["pop_thousands"])
    return out


def pyramid_year(year: int) -> int:
    """The bundled pyramid year nearest to the scenario's demographics year."""
    return min(AGE_YEARS, key=lambda y: (abs(y - year), y))


def age_histogram(iso3: str, year: int = 2024) -> np.ndarray | None:
    h = _pyramids().get((iso3.upper(), pyramid_year(year)))
    return None if h is None else h.copy()


def shares_from_histogram(h: np.ndarray) -> tuple[float, float, float]:
    total = float(h.sum())
    c, a, e = (float(h[lo:hi].sum() / total) for lo, hi in GROUP_BOUNDS)
    return c, a, e


def age_shares(iso3: str, year: int = 2024) -> tuple[float, float, float] | None:
    h = age_histogram(iso3, year)
    return None if h is None else shares_from_histogram(h)


def countries() -> list[str]:
    return sorted({iso3 for iso3, year in _pyramids() if year == AGE_YEARS[0]})


@lru_cache(maxsize=1)
def _birth_rates() -> dict[str, dict[int, float]]:
    out: dict[str, dict[int, float]] = {}
    for r in _rows("un_wpp_cbr.csv"):
        out.setdefault(r["iso3"], {})[int(r["year"])] = float(r["cbr"])
    return out


def birth_rate_series(iso3: str, start_year: int, n_years: int) -> list[float] | None:
    """Crude birth rates per 1,000 for n_years from start_year; a year outside the table takes its nearest year."""
    rates = _birth_rates().get(iso3.upper())
    if not rates:
        return None
    years = sorted(rates)
    return [rates[min(years, key=lambda y: abs(y - (start_year + i)))] for i in range(n_years)]


@lru_cache(maxsize=1)
def _households() -> dict[str, float]:
    return {r["iso3"]: float(r["household_size"]) for r in _rows("un_household_size.csv")}


def household_size(iso3: str) -> float | None:
    return _households().get(iso3.upper())


@lru_cache(maxsize=1)
def _contacts() -> dict[str, np.ndarray]:
    groups = ("children", "adults", "elderly")
    out: dict[str, np.ndarray] = {}
    for r in _rows("contact_matrices.csv"):
        out.setdefault(r["iso3"], np.zeros((3, 3)))[groups.index(r["source"]), groups.index(r["target"])] = float(r["contacts"])
    return out


def contact_matrix(iso3: str) -> np.ndarray | None:
    m = _contacts().get(iso3.upper())
    return None if m is None else m.copy()


def group_fractions(pop: np.ndarray) -> np.ndarray:
    """For each Prem band, the share of its population in each age group (16 × 3); a band with no population splits by its ages."""
    f = np.zeros((len(PREM_BANDS), 3))
    for b in range(len(PREM_BANDS)):
        ages = _band_ages(b)
        total = float(pop[ages].sum())
        for g, (lo, hi) in enumerate(GROUP_BOUNDS):
            inside = [a for a in ages if lo <= a < hi]
            f[b, g] = pop[inside].sum() / total if total > 0 else len(inside) / len(ages)
    return f


def aggregate_contacts(m16: np.ndarray, pop: np.ndarray) -> np.ndarray:
    """Prem's 16-band matrix M[a][b] (daily contacts of a participant in band a with people in band b) to the three groups, rows source S
    and columns target T, as ss.MixingPools reads them (Part 2, 5.3): C[S][T] = sum_a sum_b w_T(a) M[a][b] f_S(b), with w_T(a) the share
    of T's population that sits in band a and f_S(b) the share of band b's population that belongs to S."""
    m16 = np.asarray(m16, dtype=float)
    f = group_fractions(pop)                                                            # f[b, S]
    band_pop = np.array([pop[_band_ages(b)].sum() for b in range(len(PREM_BANDS))])
    in_group = f * band_pop[:, None]                                                    # population of band a inside group T
    w = in_group / in_group.sum(axis=0)                                                 # w[a, T]
    return (w.T @ m16 @ f).T                                                            # [S][T]
