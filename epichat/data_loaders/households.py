import pandas as pd
import numpy as np
from pathlib import Path
from functools import lru_cache
from typing import Optional
import requests

DATA_PATH = Path(__file__).parent.parent / 'data' / 'households'
DATA_PATH.mkdir(parents=True, exist_ok=True)

UN_CSV = DATA_PATH / 'UN_Household_2022.csv'

# In-memory cache for the parsed UN dataframe
_un_df: Optional[pd.DataFrame] = None


def _load_un_df() -> Optional[pd.DataFrame]:
    """
    Parse UN Household 2022 CSV.

    Structure:
        rows 0-3 : metadata
        row 4    : actual column names
        row 5+   : country data
    """
    global _un_df

    if _un_df is not None:
        return _un_df

    if not UN_CSV.exists():
        return None

    try:
        raw = pd.read_csv(
            UN_CSV,
            header=None,
            low_memory=False
        )

        # Real header row
        header = raw.iloc[4].tolist()

        # Actual data
        df = raw.iloc[5:].reset_index(drop=True)

        # Assign headers
        df.columns = header

        # Remove empty rows
        df = df[df['Country or area'].notna()]

        # Replace UN missing code
        df = df.replace('..', np.nan)

        # Parse dates
        df['_ref_date'] = pd.to_datetime(
            df['Reference date (dd/mm/yyyy)'],
            errors='coerce'
        )

        # Convert numeric columns
        numeric_cols = [
            'mean_household_size',
            '1 member',
            '2-3 members',
            '4-5 members',
            '6 or more members',
        ]

        for col in numeric_cols:
            df[col] = pd.to_numeric(
                df[col],
                errors='coerce'
            )

        # Keep latest valid survey per country
        valid = df[df['mean_household_size'].notna()]

        _un_df = (
            valid
            .sort_values('_ref_date')
            .groupby('Country or area', as_index=False)
            .last()
        )

        print(f'  Loaded UN Household 2022 ({len(_un_df)} countries)')

        return _un_df

    except Exception as e:
        print(f'  ⚠ Could not parse UN CSV: {e}')
        return None

def _load_un_household(country: str) -> Optional[dict]:
    """
    Look up a country in the UN Household CSV.
    Matches on country name (case-insensitive, partial match allowed).
    Uses the most recent survey year with a non-null mean household size.
    """
    df = _load_un_df()
    if df is None:
        return None

    # Exact match first
    row = df[df['Country or area'].str.lower() == country.lower()]

    # Partial match fallback
    if row.empty:
        row = df[df['Country or area'].str.lower().str.contains(
            country.lower(), na=False)]

    if row.empty:
        return None

    r = row.iloc[0]
    mean_size = r['mean_household_size']
    if pd.isna(mean_size):
        return None

    # Build grouped size distribution directly from UN percentage columns
    dist = None
    pct_cols = ['1 member', '2-3 members', '4-5 members', '6 or more members']
    pcts = [r[c] for c in pct_cols]

    # Only proceed if all required values exist
    if not any(pd.isna(p) for p in pcts):

        # convert percent → fraction
        dist = {
            "1":   float(pcts[0]) / 100,
            "2-3": float(pcts[1]) / 100,
            "4-5": float(pcts[2]) / 100,
            "6+":  float(pcts[3]) / 100,
        }

    ref_date    = r.get('Reference date (dd/mm/yyyy)', '')
    data_source = r.get('Data source category', 'UN')
    matched     = r['Country or area']

    return {
        'mean_size':    round(float(mean_size), 2),
        'dist':         dist,
        'reference_date': str(ref_date),
        'source': (f'UN Household Data 2022 '
                   f'({data_source}, {ref_date}) — {matched}'),
    }


ACS_API_KEY = '64679ad824f17b1253a2f87a95899c53e7db4811'
ACS_API_BASE = 'https://api.census.gov/data/2023/acs/acs5'

# B25010_001E = Average household size of all occupied housing units
# B25010_002E = Average household size of owner-occupied units
# B25010_003E = Average household size of renter-occupied units
# B25009_001E = Tenure by household size (total)
ACS_HH_VAR = 'B25010_001E'

ACS_STATE_FIPS = {
    'Alabama': '01', 'Alaska': '02', 'Arizona': '04', 'Arkansas': '05',
    'California': '06', 'Colorado': '08', 'Connecticut': '09',
    'Delaware': '10', 'District of Columbia': '11', 'Florida': '12',
    'Georgia': '13', 'Hawaii': '15', 'Idaho': '16', 'Illinois': '17',
    'Indiana': '18', 'Iowa': '19', 'Kansas': '20', 'Kentucky': '21',
    'Louisiana': '22', 'Maine': '23', 'Maryland': '24',
    'Massachusetts': '25', 'Michigan': '26', 'Minnesota': '27',
    'Mississippi': '28', 'Missouri': '29', 'Montana': '30',
    'Nebraska': '31', 'Nevada': '32', 'New Hampshire': '33',
    'New Jersey': '34', 'New Mexico': '35', 'New York': '36',
    'North Carolina': '37', 'North Dakota': '38', 'Ohio': '39',
    'Oklahoma': '40', 'Oregon': '41', 'Pennsylvania': '42',
    'Rhode Island': '44', 'South Carolina': '45', 'South Dakota': '46',
    'Tennessee': '47', 'Texas': '48', 'Utah': '49', 'Vermont': '50',
    'Virginia': '51', 'Washington': '53', 'West Virginia': '54',
    'Wisconsin': '55', 'Wyoming': '56', 'Puerto Rico': '72',
}
# Reverse lookup
FIPS_TO_STATE = {v: k for k, v in ACS_STATE_FIPS.items()}


def _fetch_acs_api(geo_for: str, geo_in: Optional[str] = None) -> Optional[list]:
    """
    Call Census ACS 5-Year API.
    Returns raw JSON rows or None on failure.
    """
    params = {
        'get': f'NAME,{ACS_HH_VAR}',
        'for': geo_for,
        'key': ACS_API_KEY,
    }
    if geo_in:
        params['in'] = geo_in

    try:
        r = requests.get(ACS_API_BASE, params=params, timeout=15)
        r.raise_for_status()
        data = r.json()
        return data[1:]  # skip header row
    except Exception as e:
        print(f"  ⚠ ACS API error: {e}")
        return None


def _load_acs_households(
    geo_level: str = 'national',
    geo_value: Optional[str] = None,
) -> Optional[dict]:

    # ── NATIONAL ─────────────────────────────────────────────
    if geo_level == 'national':
        rows = _fetch_acs_api('state:*')
        if rows:
            values = [float(r[1]) for r in rows if r[1] not in (None, '', '-')]
            mean   = round(sum(values) / len(values), 2)
            breakdown = pd.DataFrame([
                {'state': r[0], 'fips': r[2], 'mean_size': float(r[1])}
                for r in rows if r[1] not in (None, '', '-')
            ]).sort_values('state').reset_index(drop=True)
            print(f"  ✓ ACS API national: mean={mean} ({len(rows)} states)")
            return {
                'mean_size':  mean,
                'dist':       None,
                'geo_level':  'national',
                'geo_label':  'United States (national)',
                'breakdown':  breakdown,
                'source':     'US Census ACS 5-Year 2023, B25010_001E',
            }

    # ── BY STATE ──────────────────────────────────────────────
    elif geo_level == 'state':
        if geo_value == '*':
            # All states
            rows = _fetch_acs_api('state:*')
            if rows:
                breakdown = pd.DataFrame([
                    {'state': r[0], 'fips': r[2], 'mean_size': float(r[1])}
                    for r in rows if r[1] not in (None, '', '-')
                ]).sort_values('mean_size', ascending=False).reset_index(drop=True)
                mean = round(breakdown['mean_size'].mean(), 2)
                print(f"  ✓ ACS API all states: {len(breakdown)} states")
                return {
                    'mean_size': mean,
                    'dist':      None,
                    'geo_level': 'state',
                    'geo_label': 'All US States',
                    'breakdown': breakdown,
                    'source':    'US Census ACS 5-Year 2023, B25010_001E',
                }
        else:
            # Resolve state name → FIPS
            if str(geo_value).isdigit():
                fips = str(geo_value).zfill(2)
            else:
                fips = ACS_STATE_FIPS.get(geo_value)
                if not fips:
                    # Case-insensitive search
                    fips = next((v for k, v in ACS_STATE_FIPS.items()
                                 if k.lower() == geo_value.lower()), None)
            if not fips:
                print(f"  ⚠ ACS: unknown state '{geo_value}'")
                return None

            rows = _fetch_acs_api(f'state:{fips}')
            if rows and rows[0][1] not in (None, '', '-'):
                mean       = round(float(rows[0][1]), 2)
                state_name = FIPS_TO_STATE.get(fips, geo_value)
                print(f"  ✓ ACS API {state_name}: mean={mean}")
                return {
                    'mean_size': mean,
                    'dist':      None,
                    'geo_level': 'state',
                    'geo_label': state_name,
                    'fips':      fips,
                    'source':    f'US Census ACS 5-Year 2023, B25010_001E — {state_name}',
                }

    # ── BY COUNTY ─────────────────────────────────────────────
    elif geo_level == 'county':
        # geo_value = state name/FIPS to get all counties in that state
        if geo_value:
            if str(geo_value).isdigit():
                state_fips = str(geo_value).zfill(2)
            else:
                state_fips = ACS_STATE_FIPS.get(geo_value)
                if not state_fips:
                    state_fips = next((v for k, v in ACS_STATE_FIPS.items()
                                       if k.lower() == geo_value.lower()), None)
            if not state_fips:
                print(f"  ⚠ ACS: unknown state '{geo_value}'")
                return None

            rows = _fetch_acs_api(
                geo_for=f'county:*',
                geo_in =f'state:{state_fips}'
            )
        else:
            # All counties in the US (large request)
            rows = _fetch_acs_api('county:*')

        if rows:
            breakdown = pd.DataFrame([
                {
                    'county':     r[0],
                    'state_fips': r[2] if len(r) > 2 else '',
                    'county_fips':r[3] if len(r) > 3 else '',
                    'mean_size':  float(r[1]) if r[1] not in (None,'','-') else None,
                }
                for r in rows
            ]).dropna(subset=['mean_size'])
            breakdown = breakdown.sort_values(
                'mean_size', ascending=False).reset_index(drop=True)

            mean       = round(breakdown['mean_size'].mean(), 2)
            state_name = FIPS_TO_STATE.get(state_fips, geo_value) \
                         if geo_value else 'All US Counties'
            print(f"  ✓ ACS API counties ({state_name}): "
                  f"{len(breakdown)} counties, mean={mean}")
            return {
                'mean_size': mean,
                'dist':      None,
                'geo_level': 'county',
                'geo_label': state_name,
                'breakdown': breakdown,
                'source':    f'US Census ACS 5-Year 2023, B25010_001E — {state_name} counties',
            }
        
    # ── FALLBACK ───────────────────────────────────────────────
    print("  ⚠ ACS household lookup failed")
    return None


def _load_dhs_ipums(country: str) -> Optional[dict]:
    ##find file
    dhs_file_map = {
    "brazil": "BRPR31FL.DTA",
    "india":  "IAPR7EFL.DTA",
    "kenya":  "KEPR8CFL.DTA",
    }

    filename = dhs_file_map.get(country.lower())

    if filename is None:
        return None
    
    path = DATA_PATH / filename

    fmt = "dta" if path.suffix.lower() == ".dta" else "csv"
    if not path.exists():
        return None

    ##load raw file
    try:
        if fmt == "dta":
            import pyreadstat
            df, meta = pyreadstat.read_dta(str(path))
        else:
            df = pd.read_csv(path, low_memory=False)

        df.columns = df.columns.str.lower()

    except Exception as e:
        print(f"  ⚠ Could not load {path.name}: {e}")
        return None   
    
    required = ["hhid", "hv105", "hv104"]
    missing = [c for c in required if c not in df.columns]

    if missing:
        print(f"⚠ Missing columns: {missing}")
        return None

    ##only keep defacto residents (residents that slept in household last night)
    if "hv103" in df.columns:
        df = df[df["hv103"] == 1].copy()
    
    ##standardize sex
    df["sex"] = df["hv104"].map({1:'M', 2:'F'})

    ##age cleaning
    df["age"] = pd.to_numeric(df["hv105"], errors="coerce")
    df = df[df["age"].between(0, 120)]

    ##household size
    if "hv009" in df.columns:
        df["hh_size"] = pd.to_numeric(df["hv009"], errors = "coerce")
    else:
        df["hh_size"] = df.groupby("hhid")["hhid"].transform("size")

    ##weights
    if "hv005" in df.columns:
        df["weight"] = pd.to_numeric(df["hv005"], errors="coerce") / 1e6  
    else:
        df["weight"] = 1.0

    roster = df[[
        "hhid",
        "hv105",
        "sex",
        "weight"
    ]].copy()

    roster = roster.rename(columns={
        "hv105": "age"
    })

 # ── Build household templates ─────────────────────────────
    templates = []
    for hhid, grp in roster.groupby("hhid"):

        members = []

        for _, r in grp.iterrows():

            if pd.isna(r["age"]) or pd.isna(r["sex"]):
                continue

            members.append({
                "age": int(r["age"]),
                "sex": r["sex"],
            })

        if len(members) == 0:
            continue

        weight = float(grp["weight"].iloc[0]) if "weight" in grp.columns else 1.0

        templates.append({
            "hhid": hhid,
            "hh_size": len(members),
            "members": members,
            "weight": weight,
        })

    if len(templates) == 0:
        print(f"⚠ No valid households in {path.name}")
        return None

    # ── Summary stats ─────────────────────────────────────────
    sizes = [t["hh_size"] for t in templates]
    weights = [t["weight"] for t in templates]

    total_w = sum(weights)

    mean_size = (
        sum(s * w for s, w in zip(sizes, weights)) / total_w
        if total_w > 0 else float(np.mean(sizes))
    )

    dist = []
    for size in range(1, 9):
        if size < 8:
            w = sum(t["weight"] for t in templates if t["hh_size"] == size)
        else:
            w = sum(t["weight"] for t in templates if t["hh_size"] >= 8)

        dist.append(w / total_w if total_w > 0 else 0.0)

    print(f"✓ DHS {country}: {len(templates)} households | mean size {mean_size:.2f}")

    return {
        "mean_size": round(mean_size, 2),
        "dist": dist,
        "templates": templates,
        "n_households": len(templates),
        "source": f"DHS {filename}",
    }


def _load_ipums(country: str) -> Optional[dict]: ##no age or sex data in gzip file
    path = DATA_PATH / 'ipumsi.csv.gz'
    if not path.exists():
        return None
    
    IPUMS_COUNTRY_CODES = {
        'BRA':  76,
        'KEN': 404,
        'USA': 840,
    }

    country_code = IPUMS_COUNTRY_CODES.get(country.upper())
    if country_code is None:
        return None
    
    try:
        cols = ['COUNTRY', 'YEAR', 'SERIAL', 'PERSONS', 'HHWT']
        df = pd.read_csv(path, 
                         compression = 'gzip', 
                         usecols= cols, ##only loads specific columns instead of entire dataset
                         low_memory = False) ##forces pandas to read the file in a more consistent way
    
        df = df[df['COUNTRY'] == country_code].copy() ##.copy means you are explicitly creating a new independent DataFrame from the filtered result
        if df.empty:
            print(f"  ⚠ IPUMS: no data for {country} (code={country_code})")
            return None
        
        ##use most recent year
        latest_year = df['YEAR'].max()
        df = df[df['YEAR'] == latest_year].copy()

        ##standardize columns
        df['hh_size'] = pd.to_numeric(df['PERSONS'], errors = 'coerce')
        df['weight'] = pd.to_numeric(df['HHWT'], errors = 'coerce').fillna(1.0)

        ##house templates
        templates = []

        for serial, grp in df.groupby('SERIAL'):
            hh_size = int(grp['hh_size'].iloc[0]) ##.iloc[]: integer-location-based indexing

            if hh_size <= 0:
                continue

            weight = float(grp['weight'].iloc[0])

            templates.append({
                'hhid': serial,
                'hh_size': hh_size,
                'weight': weight,
            })
        if not templates:
            return None
        
       # Cache as parquet
        safe = country.lower()
        cache = DATA_PATH / f'{safe}_ipums_templates.parquet'

        try:
            pd.DataFrame(templates).to_parquet(cache, index = False)   
        except Exception:
            pass

        ##compute weighted statistics
        weights = [t['weight'] for t in templates]
        sizes = [t['hh_size'] for t in templates]

        total_w = sum(weights)
        mean_size = (
            sum(s * w for s, w in zip(sizes, weights)) / total_w
            if total_w > 0 else 0
        )

        dist = []
        for size in range (1,9):
            w = sum(
                t['weight'] for t in templates
                if (
                    t['hh_size'] >= size
                    if size == 8
                    else t['hh_size'] == size
                )
            )

            dist.append(w / total_w if total_w > 0 else 0.0)

        print(
            f"  ✓ IPUMS ({country}, {latest_year}): "
            f"{len(templates):,} households, "
            f"mean_size={mean_size:.2f}"            
        )

        return {
            'mean_size': round(mean_size, 2),
            'dist': dist,
            'templates': templates,
            'n_households': len(templates),
            'census_year': int(latest_year),
            'source': (
                f'IPUMS International — {country} '
                f'Census {latest_year}'
            ),            
        }
    
    except Exception as e:
       print(f"  ⚠ IPUMS load failed ({country}): {e}")
    return None        


def _mean_to_dist(mean_size: float) -> list:
    """
    Approximate size distribution from mean using negative binomial (r=2).
    Only used when UN percentage columns are missing for a country.
    """
    try:
        from scipy.stats import nbinom
        r    = 2.0
        p    = r / (r + mean_size)
        dist = [float(nbinom.pmf(i, r, p)) for i in range(8)]
        total = sum(dist)
        dist  = [d / total for d in dist]
        dist[7] = max(0.0, 1.0 - sum(dist[:7]))
        return dist
    except ImportError:
        mid  = max(0, round(mean_size) - 1)
        dist = [max(0.0, 1.0 - abs(i - mid) * 0.25) for i in range(8)]
        total = sum(dist)
        return [d / total for d in dist]



# ══════════════════════════════════════════════════════════════
# PUBLIC FUNCTIONS
# ══════════════════════════════════════════════════════════════

@lru_cache(maxsize=64)
def get_household_data(country: str) -> dict:
    """
    Get household size and composition data for a country.

    Uses the most recent survey year with valid data from the UN CSV.
    Multiple survey years per country are handled automatically.

    Args:
        country: country name as in the UN CSV
                 e.g. 'Kenya', 'Nigeria', 'United States of America'
                 Case-insensitive. Partial matches accepted.

    Returns:
        dict with:
            mean_size:      float — mean persons per household
            dist:           list  — probability of sizes 1,2,...,8+
            reference_date: str   — survey reference date
            source:         str   — full citation

    Raises:
        ValueError if no sourced data found for this country

    Priority: DHS → IPUMSI → UN CSV → ACS
    """


    # 1. DHS
    d = _load_dhs_ipums(country)
    if d:
        if d['dist'] is None:
            d['dist'] = _mean_to_dist(d['mean_size'])
        print(f"  ✓ Household ({country}): "
              f"mean={d['mean_size']} [{d['source']}]")
        return d

    # 2. IPUMSI
    d = _load_ipums(country)
    if d:
        if d['dist'] is None:
            d['dist'] = _mean_to_dist(d['mean_size'])
        print(
            f"  ✓ Household ({country}): "
            f"mean={d['mean_size']} "
            f"[{d['source']}]"
        )
        return d


    # 2. UN Household CSV
    d = _load_un_household(country)
    if d:
        if d['dist'] is None:
            d['dist'] = _mean_to_dist(d['mean_size'])
        print(f"  ✓ Household ({country}): "
              f"mean={d['mean_size']} ref={d['reference_date']} "
              f"[{d['source']}]")
        return d

    # 3. ACS
    if 'united states' in country.lower():
        d = _load_acs_households()
        if d:
            if d['dist'] is None:
                d['dist'] = _mean_to_dist(d['mean_size'])
            return d

    raise ValueError(
        f"No household data found for '{country}'. "
        f"Ensure UN_Household_2022.csv is in {DATA_PATH}. "
        f"See get_download_instructions() for other sources."
    )


def get_starsim_household_pars(country: str) -> dict:
    """
    Return Starsim-ready household network parameters.

    Args:
        country: country name e.g. 'Kenya'

    Returns:
        dict with mean_size, size_dist, source, network_type, country
    """
    d = get_household_data(country)
    return {
        'mean_size':    d['mean_size'],
        'size_dist':    d['dist'],
        'source':       d['source'],
        'network_type': 'household',
        'country':      country,
    }


def list_available_countries() -> list:
    """Return all countries available in the UN CSV."""
    df = _load_un_df()
    if df is None:
        return []
    return sorted(df['Country or area'].dropna().tolist())


def get_survey_history(country: str) -> pd.DataFrame:
    """
    Return all survey years for a country from the UN CSV.
    Useful for understanding which data point was selected.

    Args:
        country: country name

    Returns:
        DataFrame with all survey rows for that country
    """
    if not UN_CSV.exists():
        raise FileNotFoundError(f"UN CSV not found at {UN_CSV}")

    raw = pd.read_csv(UN_CSV, header=3, low_memory=False)
    raw.columns = raw.iloc[0].tolist()
    raw = raw.iloc[1:].reset_index(drop=True)
    raw = raw[raw['Country or area'].notna()]
    raw = raw.replace('..', np.nan)

    result = raw[raw['Country or area'].str.lower().str.contains(
        country.lower(), na=False
    )]

    return result[['Country or area', 'Reference date (dd/mm/yyyy)',
                   'Data source category', 'mean_household_size',
                   '1 member', '2-3 members', '4-5 members',
                   '6 or more members']].reset_index(drop=True)
