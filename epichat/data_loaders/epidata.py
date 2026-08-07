"""
epichat/data_loaders/epidata.py

Fetches real-time epidemiological surveillance data from the
Delphi Epidata API (Carnegie Mellon University).

API docs:   https://cmu-delphi.github.io/delphi-epidata/
Base URL:   https://api.delphi.cmu.edu/epidata/
Auth:       Anonymous (60 req/hr, 2 multi-params max)
            API key (no rate limit) — set EPIDATA_API_KEY env var

Datasets available:
  - covidcast: COVID-19 signals (cases, deaths, hospitalizations,
                                  mobility, vaccination, symptoms)
  - fluview:   CDC influenza surveillance (ILI rates)

Usage in EpiChat:
    from epichat.data_loaders.epidata import get_surveillance_data
    df = get_surveillance_data('covid', region='ky')
"""

import os
import requests
import pandas as pd
from datetime import datetime, timedelta
from typing import Optional

# ── API config ────────────────────────────────────────────────
EPIDATA_BASE    = "https://api.delphi.cmu.edu/epidata"
EPIDATA_API_KEY = os.environ.get("EPIDATA_API_KEY", None)  # set in .env

# ── CovidCast signal catalog ──────────────────────────────────
# Full list: https://cmu-delphi.github.io/delphi-epidata/api/covidcast_signals.html
COVIDCAST_SIGNALS = {
    # Cases & Testing (JHU-CSSE)
    'cases_rate':        ('jhu-csse',       'confirmed_7dav_incidence_prop'),
    'cases_smoothed':    ('jhu-csse',       'confirmed_7dav_incidence_prop'),
    'deaths_rate':       ('jhu-csse',       'deaths_7dav_incidence_prop'),

    # Hospital Admissions (HHS — most current active source) - may be inactivces
    'hospitalizations':  ('hhs',            'confirmed_admissions_covid_1d_prop_7dav'),

    # Early Indicators (Facebook Survey)
    'ili_symptoms':      ('fb-survey',      'smoothed_wcli'),
    'ili_community':     ('fb-survey',      'smoothed_whh_cmnty_cli'),
    'mask_wearing':      ('fb-survey',      'smoothed_wwearing_mask_7d'),
    'vaccine_accept':    ('fb-survey',      'smoothed_wcovid_vaccinated_appointment_or_accept'),

    # Doctor Visits
    'doctor_visits':     ('doctor-visits',  'smoothed_adj_cli'),

    # Google Symptoms
    'google_symptoms':   ('google-symptoms','sum_anosmia_ageusia_smoothed_search'),
}

FLU_REGIONS = ['nat', 'hhs1', 'hhs2', 'hhs3', 'hhs4',
                'hhs5', 'hhs6', 'hhs7', 'hhs8', 'hhs9', 'hhs10']


def _get_headers() -> dict:
    """Auth headers — API key if available, else anonymous."""
    headers = {'Accept': 'application/json'}
    if EPIDATA_API_KEY:
        headers['Authorization'] = f'Bearer {EPIDATA_API_KEY}'
    return headers


def _date_str(d: datetime) -> str:
    return d.strftime('%Y%m%d')


# ══════════════════════════════════════════════════════════════
# COVIDCAST — COVID-19 SIGNALS
# ══════════════════════════════════════════════════════════════

def get_covidcast(
    signal_key: str = 'cases_smoothed',
    geo_type: str = 'state',
    geo_value: str = '*',
    days_back: int = 90,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Optional[pd.DataFrame]:
    """
    Fetch COVID-19 surveillance signal from CovidCast.

    Args:
        signal_key:  key from COVIDCAST_SIGNALS dict
                     'cases', 'deaths', 'hospitalizations',
                     'vaccinated', 'cases_smoothed', etc.
        geo_type:    'nation', 'state', 'county', 'msa', 'hrr'
        geo_value:   '*' = all | 'ky' = Kentucky | 'us' = national
        days_back:   lookback window in days (if no dates given)
        start_date:  YYYY-MM-DD
        end_date:    YYYY-MM-DD (default: today)

    Returns:
        DataFrame: date, region, {signal_key}, [stderr, sample_size]
        or None on failure

    Examples:
        df = get_covidcast('cases_smoothed', geo_type='state', geo_value='*')
        df = get_covidcast('hospitalizations', geo_type='state', geo_value='ky')
        df = get_covidcast('cases', geo_type='nation', geo_value='us')
    """
    if signal_key not in COVIDCAST_SIGNALS:
        print(f"  ⚠ Unknown signal '{signal_key}'. "
              f"Available: {list(COVIDCAST_SIGNALS.keys())}")
        return None

    source, signal = COVIDCAST_SIGNALS[signal_key]

    end   = datetime.strptime(end_date,   '%Y-%m-%d') if end_date   else datetime.today()
    start = datetime.strptime(start_date, '%Y-%m-%d') if start_date else end - timedelta(days=days_back)

    params = {
        'data_source': source,
        'signal':      signal,
        'geo_type':    geo_type,
        'geo_values':  geo_value,
        'time_type':   'day',
        'time_values': f'{_date_str(start)}-{_date_str(end)}',
    }
    if EPIDATA_API_KEY:
        params['api_key'] = EPIDATA_API_KEY

    try:
        resp = requests.get(
            f'{EPIDATA_BASE}/covidcast/',
            params=params,
            headers=_get_headers(),
            timeout=15
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get('result') != 1:
            print(f"  ⚠ Epidata: {data.get('message', 'unknown error')}")
            return None

        records = data.get('epidata', [])
        if not records:
            print(f"  ⚠ No records returned for {signal_key} / {geo_value}")
            return None

        df = pd.DataFrame(records)
        df['date'] = pd.to_datetime(df['time_value'].astype(str), format='%Y%m%d')
        df = df.rename(columns={'geo_value': 'region', 'value': signal_key})

        cols = ['date', 'region', signal_key]
        if 'stderr'      in df.columns: cols.append('stderr')
        if 'sample_size' in df.columns: cols.append('sample_size')
        df = df[cols].sort_values('date').reset_index(drop=True)

        print(f"  ✓ CovidCast {signal_key} ({geo_type}={geo_value}): "
              f"{len(df)} records "
              f"[{df['date'].min().date()} → {df['date'].max().date()}]")
        return df

    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 429:
            print("  ⚠ Rate limit hit — register for a free API key at "
                  "https://api.delphi.cmu.edu/epidata/admin/registration_form")
        else:
            print(f"  ⚠ CovidCast HTTP error: {e}")
    except Exception as e:
        print(f"  ⚠ CovidCast error: {e}")

    return None


# ══════════════════════════════════════════════════════════════
# FLUVIEW — CDC INFLUENZA SURVEILLANCE
# ══════════════════════════════════════════════════════════════

def get_fluview(
    regions: list = ['nat'],
    epiweeks: Optional[str] = None,
    seasons: Optional[list] = None,
) -> Optional[pd.DataFrame]:
    """
    Fetch CDC FluView influenza surveillance (ILI rates).

    Args:
        regions:   list of region codes
                   'nat' = national | 'hhs1'–'hhs10' = HHS regions
        epiweeks:  epiweek range 'YYYYWW-YYYYWW' (default: last 52 weeks)
        seasons:   list of flu seasons e.g. [2022, 2023]
                   overrides epiweeks if provided

    Returns:
        DataFrame: epiweek, region, ili, wili, num_providers, num_patients
        or None on failure

    Examples:
        df = get_fluview(regions=['nat'])
        df = get_fluview(regions=FLU_REGIONS, seasons=[2022, 2023])
    """
    if epiweeks is None and seasons is None:
        today    = datetime.today()
        year     = today.year
        week     = today.isocalendar()[1]
        epiweeks = f'{year-1}{week:02d}-{year}{week:02d}'

    params = {'regions': ','.join(regions)}

    if seasons:
        params['epiweeks'] = ','.join(
            f'{s}40-{s+1}20' for s in seasons
        )
    else:
        params['epiweeks'] = epiweeks

    if EPIDATA_API_KEY:
        params['api_key'] = EPIDATA_API_KEY

    try:
        resp = requests.get(
            f'{EPIDATA_BASE}/fluview/',
            params=params,
            headers=_get_headers(),
            timeout=15
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get('result') != 1:
            print(f"  ⚠ FluView: {data.get('message', 'unknown error')}")
            return None

        records = data.get('epidata', [])
        if not records:
            return None

        df = pd.DataFrame(records).sort_values('epiweek').reset_index(drop=True)
        print(f"  ✓ FluView ({','.join(regions)}): {len(df)} epiweeks")
        return df

    except Exception as e:
        print(f"  ⚠ FluView error: {e}")
        return None


# ══════════════════════════════════════════════════════════════
# MAIN PUBLIC FUNCTION — unified EpiChat interface
# ══════════════════════════════════════════════════════════════

def get_surveillance_data(
    disease: str,
    region: str = '*',
    geo_type: str = 'state',
    signal_key: str = 'cases_smoothed',
    days_back: int = 90,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Optional[pd.DataFrame]:
    """
    Unified surveillance data fetcher for EpiChat.
    Routes to the correct Epidata endpoint based on disease.

    Args:
        disease:    'covid' or 'flu'
        region:     state code e.g. 'ky', 'ca' | '*' for all | 'nat' for flu
        geo_type:   'state', 'nation', 'county' (covid only)
        signal_key: CovidCast signal (covid only) — see COVIDCAST_SIGNALS
        days_back:  lookback window in days (covid only)
        start_date: YYYY-MM-DD (covid only)
        end_date:   YYYY-MM-DD (covid only)

    Returns:
        DataFrame with surveillance time series or None

    Examples:
        df = get_surveillance_data('covid', region='*')
        df = get_surveillance_data('covid', region='ky',
                                   signal_key='hospitalizations')
        df = get_surveillance_data('flu', region='nat')
    """
    disease = disease.lower().strip()

    if disease in ('covid', 'covid-19', 'coronavirus'):
        return get_covidcast(
            signal_key = signal_key,
            geo_type   = geo_type,
            geo_value  = region,
            days_back  = days_back,
            start_date = start_date,
            end_date   = end_date,
        )

    elif disease in ('flu', 'influenza', 'ili'):
        flu_region = region if region != '*' else 'nat'
        return get_fluview(regions=[flu_region])

    else:
        print(f"  ⚠ Unknown disease '{disease}'. Use 'covid' or 'flu'.")
        return None


def check_api_status() -> dict:
    """
    Check Epidata API connectivity and auth status.

    Returns:
        dict with status, auth_mode, rate_limit, api_key_set
    """
    try:
        resp = requests.get(
            f'{EPIDATA_BASE}/covidcast/meta',
            headers=_get_headers(),
            params={'api_key': EPIDATA_API_KEY} if EPIDATA_API_KEY else {},
            timeout=10
        )
        return {
            'status':      'ok' if resp.status_code == 200 else 'error',
            'http_code':   resp.status_code,
            'auth_mode':   'api_key' if EPIDATA_API_KEY else 'anonymous',
            'rate_limit':  'none'       if EPIDATA_API_KEY else '60 req/hr',
            'multi_param': 'unlimited'  if EPIDATA_API_KEY else 'max 2',
            'api_key_set': bool(EPIDATA_API_KEY),
            'register_at': 'https://api.delphi.cmu.edu/epidata/admin/registration_form',
        }
    except Exception as e:
        return {'status': 'unreachable', 'error': str(e)}