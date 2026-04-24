# epichat/data_loaders/demographics.py

import gzip
import json
import requests
import pandas as pd
from pathlib import Path
from functools import lru_cache
from typing import Optional

#file paths
DATA_PATH = Path(__file__).parent.parent / 'data' / 'demographics'
CACHE_DIR  = DATA_PATH / 'cache'
CACHE_DIR.mkdir(parents=True, exist_ok=True)

WPP_FILE = DATA_PATH / 'WPP2024_Demographic_Indicators_Medium.csv'
WHO_FILE = DATA_PATH / 'WHO_Mortality_Database.csv'

# ── World Bank API fallback ### in progress need to update
WB_INDICATORS = {
    'birth_rate':      'SP.DYN.CBRT.IN',
    'death_rate':      'SP.DYN.CDRT.IN',
    'life_expectancy': 'SP.DYN.LE00.IN',
}
WB_BASE   = "https://api.worldbank.org/v2/country/{iso2}/indicator/{indicator}"
ISO3_TO_ISO2 = {
    'KEN': 'KE', 'NGA': 'NG', 'ZAF': 'ZA', 'ETH': 'ET', 'GHA': 'GH',
    'TZA': 'TZ', 'UGA': 'UG', 'ZWE': 'ZW', 'MOZ': 'MZ', 'ZMB': 'ZM',
    'USA': 'US', 'GBR': 'GB', 'DEU': 'DE', 'FRA': 'FR', 'BRA': 'BR',
    'IND': 'IN', 'CHN': 'CN', 'JPN': 'JP', 'MEX': 'MX', 'COL': 'CO',
    'PER': 'PE', 'ARG': 'AR', 'CHL': 'CL', 'IDN': 'ID', 'PHL': 'PH',
    'THA': 'TH', 'VNM': 'VN', 'BGD': 'BD', 'PAK': 'PK', 'EGY': 'EG',
    'MAR': 'MA', 'TUN': 'TN', 'SDN': 'SD', 'AGO': 'AO', 'CMR': 'CM',
    'SEN': 'SN', 'CIV': 'CI', 'MDG': 'MG', 'MLI': 'ML', 'NER': 'NE',
}

# ── WPP dataframe cache (load once per session) ───────────────
_wpp_df: Optional[pd.DataFrame] = None
_who_df: Optional[pd.DataFrame] = None


def _load_wpp() -> Optional[pd.DataFrame]:
    global _wpp_df
    if _wpp_df is not None:
        return _wpp_df
    if not WPP_FILE.exists():
        return None
    try:
        _wpp_df = pd.read_csv(WPP_FILE, low_memory=False,
                              usecols=['ISO3_code', 'Time', 'CBR', 'CDR',
                                       'LEx', 'TFR', 'IMR'])
        print(f"  Loaded UN WPP 2024 ({len(_wpp_df):,} rows)")
        return _wpp_df
    except Exception as e:
        print(f"  ⚠ Could not load WPP file: {e}")
        return None


def _load_who(iso3: Optional[str] = None) -> Optional[pd.DataFrame]:
    """
    Load WHO Mortality Database CSV.
    Looks for WHO_Mortality_{ISO3}.csv first, then WHO_Mortality_Database.csv.
    Columns: Region Code, Region Name, Country Code, Country Name,
             Year, Sex, Age group code, Age Group, Number, Pct,
             Age-standardized death rate per 100 000 standard population,
             Death rate per 100 000 population
    """
    global _who_df

    # Try country-specific file first
    candidates = []
    if iso3:
        candidates.append(DATA_PATH / f'WHO_Mortality_{iso3.upper()}.csv')
    candidates.append(WHO_FILE)

    for path in candidates:
        if not path.exists():
            continue
        try:
            df = pd.read_csv(path, skiprows=6, header=0,
                             index_col=0, low_memory=False)
            # Fix column names (file has a shifted index issue)
            df.columns = [
                'Region Code', 'Region Name', 'Country Code', 'Country Name',
                'Year', 'Sex', 'Age group code', 'Age Group', 'Number',
                'Pct_cause', 'ASdr_per100k', 'Death_rate_per100k'
            ]
            return df
        except Exception as e:
            print(f"  ⚠ Could not load WHO file {path.name}: {e}")

    return None


# ══════════════════════════════════════════════════════════════
# SOURCE 1: UN WPP 2024
# ══════════════════════════════════════════════════════════════

def _fetch_unwpp(iso3: str, year: int = 2022) -> Optional[dict]:
    """
    Fetch from local UN WPP CSV.
    Returns birth_rate (CBR), death_rate (CDR), life_expectancy (LEx),
    fertility_rate (TFR), infant_mortality (IMR).
    Falls back to nearest available year if exact year not found.
    """
    df = _load_wpp()
    if df is None:
        return None

    iso3 = iso3.upper()
    subset = df[df['ISO3_code'] == iso3].copy()
    if subset.empty:
        return None

    # Try exact year, then nearest
    row = subset[subset['Time'] == year]
    if row.empty:
        subset['year_diff'] = (subset['Time'] - year).abs()
        row = subset.loc[[subset['year_diff'].idxmin()]]
        actual_year = int(row['Time'].values[0])
    else:
        actual_year = year

    r = row.iloc[0]
    return {
        'birth_rate':       round(float(r['CBR']), 3),
        'death_rate':       round(float(r['CDR']), 3),
        'life_expectancy':  round(float(r['LEx']), 2),
        'fertility_rate':   round(float(r['TFR']), 3),
        'infant_mortality': round(float(r['IMR']), 3),
        'source':           f'UN WPP 2024 — {iso3} ({actual_year})',
    }


# ══════════════════════════════════════════════════════════════
# SOURCE 2: WHO MORTALITY DATABASE
# ══════════════════════════════════════════════════════════════

def _fetch_who_mortality(iso3: str, year: Optional[int] = None) -> Optional[dict]:
    """
    Fetch age-standardized death rate from WHO Mortality Database.
    Returns agestd_death_rate_per100k for Sex=='All'.
    Converts to per-1000 for consistency with WPP CDR.

    Note: WHO file uses Country Code (ISO2-like) not ISO3.
    Uses the Country Name column to match since export may vary.
    """
    df = _load_who(iso3)
    if df is None:
        return None

    # Filter Sex == 'All' and a valid age group (exclude unknown)
    all_sex = df[
        (df['Sex'] == 'All') &
        (~df['Age group code'].str.contains('unknown', case=False, na=True))
    ].copy()

    if all_sex.empty:
        return None

    # Filter by year if specified
    if year:
        year_rows = all_sex[all_sex['Year'] == year]
        if year_rows.empty:
            # Use whatever year is available
            year_rows = all_sex
        all_sex = year_rows

    # Compute weighted mean ASdr across all age groups as overall death rate proxy
    valid = all_sex['ASdr_per100k'].dropna()
    if valid.empty:
        return None

    # Sum all-age deaths and express as rate per 1000
    # ASdr per 100k → divide by 100 to get per 1000
    mean_adr = valid.mean() / 100.0

    actual_year = int(all_sex['Year'].iloc[0]) if not all_sex.empty else year

    return {
        'who_death_rate_per1000':      round(mean_adr, 3),
        'who_agestd_rate_per100k':     round(valid.mean(), 2),
        'who_source':                  f'WHO Mortality Database — {actual_year}',
    }


def get_who_age_distribution(iso3: str) -> Optional[pd.DataFrame]:
    """
    Return age-specific death rates from WHO data as a DataFrame.
    Useful for age-stratified severity modeling (Phase 3).

    Returns DataFrame with columns:
        age_group, age_group_code, agestd_rate_per100k, sex
    """
    df = _load_who(iso3)
    if df is None:
        return None

    result = df[df['Sex'] == 'All'][
        ['Age group code', 'Age Group', 'ASdr_per100k']
    ].copy()
    result.columns = ['age_group_code', 'age_group', 'agestd_rate_per100k']
    result = result[~result['age_group_code'].str.contains('unknown', case=False, na=True)]
    result = result.dropna(subset=['agestd_rate_per100k'])
    result['source'] = 'WHO Mortality Database'
    return result.reset_index(drop=True)


# ══════════════════════════════════════════════════════════════
# SOURCE 3: WORLD BANK API (live fallback)
# ══════════════════════════════════════════════════════════════

def _fetch_worldbank(iso3: str, indicator_key: str, year: int = 2022) -> Optional[float]:
    """Fetch one indicator from World Bank Open Data API."""
    iso2 = ISO3_TO_ISO2.get(iso3.upper())
    if not iso2:
        return None
    url = WB_BASE.format(iso2=iso2, indicator=WB_INDICATORS[indicator_key])
    try:
        resp = requests.get(
            url,
            params={'format': 'json', 'mrv': 1, 'per_page': 5},
            timeout=8
        )
        resp.raise_for_status()
        data = resp.json()
        if len(data) >= 2 and data[1]:
            for record in data[1]:
                if record.get('value') is not None:
                    return float(record['value'])
    except Exception:
        pass
    return None


# ══════════════════════════════════════════════════════════════
# MAIN PUBLIC FUNCTION
# ══════════════════════════════════════════════════════════════

@lru_cache(maxsize=128)
def get_country_demographics(country_iso3: str, year: int = 2022) -> dict:
    """
    Get demographic parameters for a country.

    Priority:
      1. UN WPP 2024 local CSV  (birth_rate, death_rate, life_expectancy,
                                  fertility_rate, infant_mortality)
      2. WHO Mortality Database  (age-standardized death rate supplement)
      3. World Bank API          (live fallback for missing values)
      4. Raises ValueError       (if nothing found)

    Args:
        country_iso3: ISO3 code e.g. 'KEN', 'NGA', 'USA', 'MEX'
        year: reference year (default 2022)

    Returns:
        dict with birth_rate, death_rate, life_expectancy, source, ...
    """
    iso3 = country_iso3.upper()

    # ── Check disk cache ──────────────────────────────────────
    cache_file = CACHE_DIR / f'{iso3}_{year}.json'
    if cache_file.exists():
        with open(cache_file) as f:
            data = json.load(f)
        data['source'] += ' [cached]'
        return data

    result = {}
    sources = []

    # ── 1. UN WPP (primary — best coverage) ──────────────────
    wpp = _fetch_unwpp(iso3, year)
    if wpp:
        result.update({
            'birth_rate':       wpp['birth_rate'],
            'death_rate':       wpp['death_rate'],
            'life_expectancy':  wpp['life_expectancy'],
            'fertility_rate':   wpp['fertility_rate'],
            'infant_mortality': wpp['infant_mortality'],
        })
        sources.append(wpp['source'])

    # ── 2. WHO Mortality Database (supplement / cross-check) ──
    who = _fetch_who_mortality(iso3, year)
    if who:
        # Store WHO death rate as supplementary field
        result['who_agestd_death_rate_per100k'] = who['who_agestd_rate_per100k']
        # Only use WHO CDR if WPP didn't provide one
        if 'death_rate' not in result:
            result['death_rate'] = who['who_death_rate_per1000']
        sources.append(who['who_source'])

    # ── 3. World Bank API (fallback for missing fields) ───────
    missing = [k for k in ['birth_rate', 'death_rate', 'life_expectancy']
               if k not in result]

    if missing:
        wb_map = {
            'birth_rate':      'birth_rate',
            'death_rate':      'death_rate',
            'life_expectancy': 'life_expectancy',
        }
        wb_used = False
        for key in missing:
            val = _fetch_worldbank(iso3, wb_map[key], year)
            if val is not None:
                result[key] = round(val, 3)
                wb_used = True
        if wb_used:
            sources.append('World Bank API')

    if not result:
        raise ValueError(
            f"No demographic data found for '{iso3}'. "
            f"Ensure WPP file is at: {WPP_FILE}"
        )

    result['source']  = ' + '.join(sources)
    result['country'] = iso3
    result['year']    = year

    # ── Save to disk cache ────────────────────────────────────
    with open(cache_file, 'w') as f:
        json.dump(result, f, indent=2)

    print(f"  ✓ {iso3}: birth={result.get('birth_rate','?')}/1000, "
          f"death={result.get('death_rate','?')}/1000, "
          f"LE={result.get('life_expectancy','?')}yr "
          f"[{result['source']}]")
    return result


def get_demographics_for_sim(iso3: str, year: int = 2022) -> dict:
    """Slim wrapper — returns only the fields Starsim needs."""
    demo = get_country_demographics(iso3, year)
    return {
        'birth_rate':  demo['birth_rate'],
        'death_rate':  demo['death_rate'],
        'source':      demo['source'],
    }


def clear_cache(iso3: Optional[str] = None):
    """Clear disk cache. Pass iso3 to clear one country, None to clear all."""
    if iso3:
        for f in CACHE_DIR.glob(f'{iso3.upper()}_*.json'):
            f.unlink()
        print(f"Cleared cache for {iso3}")
    else:
        for f in CACHE_DIR.glob('*.json'):
            f.unlink()
        # Also clear lru_cache
        get_country_demographics.cache_clear()
        print("Cleared all demographic cache")