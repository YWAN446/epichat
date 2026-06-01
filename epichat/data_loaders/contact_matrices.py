import pandas as pd
import numpy as np
from pathlib import Path
from typing import Optional

# ── File paths ────────────────────────────────────────────────
DATA_PATH = Path(__file__).parent.parent / 'data' / 'contact_matrices'
 
PREM_PATH    = DATA_PATH / 'prem2021'
POLYMOD_PATH = DATA_PATH / 'polymod'
SOCRATES_PATH= DATA_PATH / 'socrates'
COMIX_PATH   = DATA_PATH / 'comix'
 
SETTINGS = ['all', 'home', 'work', 'school', 'other', 'physical']
 
# ── Countries available per source ───────────────────────────
POLYMOD_COUNTRIES  = ['BEL', 'DEU', 'FIN', 'GBR', 'ITA', 'LUX', 'NLD', 'POL']
COMIX_COUNTRIES    = ['GBR', 'BEL', 'NLD']
 
 
# ══════════════════════════════════════════════════════════════
# SOURCE 1: PREM ET AL. 2021 (primary — 177 countries)
# ══════════════════════════════════════════════════════════════
 
def _load_prem(iso3: str, setting: str = 'all') -> Optional[np.ndarray]:
    """
    Load Prem et al. 2021 synthetic contact matrix.
 
    Files expected at: prem2021/{iso3}_{setting}.csv
    or:                prem2021/{iso3}.csv  (for 'all' setting)
 
    Matrix dimensions: 16x16 (5-year age bins: 0-4, 5-9, ..., 75+)
    Values: mean contacts per day per person in age group i with age group j
 
    Args:
        iso3:    ISO3 country code e.g. 'KEN', 'NGA', 'USA'
        setting: 'all', 'home', 'work', 'school', 'other'
 
    Returns:
        16x16 numpy array or None if file not found
    """
    # Try setting-specific file first, then all-setting file
    candidates = [
        PREM_PATH / f'{iso3.upper()}_{setting}.csv',
        PREM_PATH / f'{iso3.upper()}.csv',
        PREM_PATH / f'{iso3.lower()}_{setting}.csv',
        PREM_PATH / f'{iso3.lower()}.csv',
    ]
 
    for path in candidates:
        if path.exists():
            try:
                df = pd.read_csv(path, index_col=0)
                matrix = df.values.astype(float)
                return matrix
            except Exception as e:
                print(f"  ⚠ Could not load Prem matrix {path.name}: {e}")
 
    return None
 
 
# ══════════════════════════════════════════════════════════════
# SOURCE 2: POLYMOD (8 European countries, empirical)
# ══════════════════════════════════════════════════════════════
 
def _load_polymod(iso3: str, setting: str = 'all') -> Optional[np.ndarray]:
    """
    Load POLYMOD empirical contact matrix.
 
    Files expected at: polymod/{iso3}_{setting}.csv
    Available for: BEL, DEU, FIN, GBR, ITA, LUX, NLD, POL
 
    Matrix dimensions: variable (typically 16x16, 5-year bins)
    Source: Mossong et al. 2008, PLOS Medicine
    """
    if iso3.upper() not in POLYMOD_COUNTRIES:
        return None
 
    candidates = [
        POLYMOD_PATH / f'{iso3.upper()}_{setting}.csv',
        POLYMOD_PATH / f'{iso3.upper()}_all.csv',   # fall back to all contacts
        POLYMOD_PATH / f'{iso3.upper()}.csv',
    ]
 
    for path in candidates:
        if path.exists():
            try:
                df = pd.read_csv(path, index_col=0)
                return df.values.astype(float)
            except Exception as e:
                print(f"  ⚠ Could not load POLYMOD matrix {path.name}: {e}")
 
    return None
 
 
# ══════════════════════════════════════════════════════════════
# SOURCE 3: SOCRATES (40+ countries)
# ══════════════════════════════════════════════════════════════

# SOCRATES country name → ISO3 mapping
SOCRATES_SURVEYS = {
    'BEL': 'Belgium',      'DEU': 'Germany',       'FIN': 'Finland',
    'GBR': 'United Kingdom','ITA': 'Italy',         'LUX': 'Luxembourg',
    'NLD': 'Netherlands',  'POL': 'Poland',         'PER': 'Peru',
    'ZWE': 'Zimbabwe',     'FRA': 'France',         'HKG': 'Hong Kong',
    'VNM': 'Vietnam',      'ZAF': 'South Africa',   'CHN': 'China',
    'RUS': 'Russia',       'THA': 'Thailand',       
}

SOCRATES_SETTING_MAP = {
    'all':    None,
    'home':   'household',
    'work':   'work',
    'school': 'school',
    'other':  'otherplace',
}

SOCRATES_AGE_LIMITS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75]


def _fetch_socrates_via_r(iso3: str, setting: str = 'all') -> Optional[np.ndarray]:
    """
    Fetch SOCRATES matrix live via rpy2 + socialmixr R package.
    Requires: R installed + socialmixr + rpy2.
    Install:  R -e "install.packages('socialmixr')"
              pip install rpy2
    """
    country_name = SOCRATES_SURVEYS.get(iso3.upper())
    if not country_name:
        return None

    contact_filter = SOCRATES_SETTING_MAP.get(setting)

    try:
        import rpy2.robjects as ro
        from rpy2.robjects import pandas2ri
        from rpy2.robjects.packages import importr
        # pandas2ri.activate() is deprecated — use context manager instead

        socialmixr = importr('socialmixr')
        r_age      = ro.IntVector(SOCRATES_AGE_LIMITS)

        # Load polymod dataset explicitly
        ro.r('library(socialmixr)')
        ro.r('data(polymod)')
        polymod = ro.globalenv['polymod']

        if contact_filter:
            result = socialmixr.contact_matrix(
                polymod,
                countries  = country_name,
                age_limits = r_age,
                filter     = ro.StrVector([contact_filter])
            )
        else:
            result = socialmixr.contact_matrix(
                polymod,
                countries  = country_name,
                age_limits = r_age,
            )

        mat_np = np.array(result.rx2('matrix'))

        # Build age labels
        labels = [f'{SOCRATES_AGE_LIMITS[i]}-{SOCRATES_AGE_LIMITS[i+1]-1}'
                  for i in range(len(SOCRATES_AGE_LIMITS) - 1)] + ['75+']

        df = pd.DataFrame(
            mat_np,
            index   = labels[:mat_np.shape[0]],
            columns = labels[:mat_np.shape[1]]
        )

        # Cache to disk so future calls skip R entirely
        cache_path = SOCRATES_PATH / f'{iso3.upper()}_{setting}.csv'
        df.to_csv(cache_path)
        print(f"  ✓ SOCRATES fetched + cached: {cache_path.name}")

        return mat_np

    except ImportError:
        print("  ⚠ rpy2 not installed — cannot fetch live from SOCRATES. "
              "Run: pip install rpy2 && R -e \"install.packages('socialmixr')\"")
        return None
    except Exception as e:
        print(f"  ⚠ SOCRATES R fetch failed ({iso3}/{setting}): {e}")
        return None


def _load_socrates(iso3: str, setting: str = 'all') -> Optional[np.ndarray]:
    """
    Load SOCRATES contact matrix.

    Priority:
      1. Local CSV cache (epichat/data/contact_matrices/socrates/)
      2. Live fetch via rpy2 + socialmixr R package (auto-caches result)

    Files cached at: socrates/{iso3}_{setting}.csv
    Download tool:   https://lwillem.shinyapps.io/socrates_rshiny/
    R package:       socialmixr (Willem et al. 2020, Scientific Data)

    Args:
        iso3:    ISO3 country code e.g. 'GBR', 'KEN'
        setting: 'all', 'home', 'work', 'school', 'other'
    """
    # 1. Check local CSV cache first
    candidates = [
        SOCRATES_PATH / f'{iso3.upper()}_{setting}.csv',
        SOCRATES_PATH / f'{iso3.upper()}.csv',
    ]

    for path in candidates:
        if path.exists():
            try:
                df = pd.read_csv(path, index_col=0)
                return df.values.astype(float)
            except Exception as e:
                print(f"  ⚠ Could not load SOCRATES cache {path.name}: {e}")

    # 2. Try live fetch via R
    return _fetch_socrates_via_r(iso3, setting)
 
 
# ══════════════════════════════════════════════════════════════
# SOURCE 4: COMIX (pandemic-era, 19 European countries)
# ══════════════════════════════════════════════════════════════

# CoMix Zenodo URLs — pandemic-era contact surveys
COMIX_URLS = {
    'BEL': 'https://doi.org/10.5281/zenodo.10549953',
    'NLD': 'https://doi.org/10.5281/zenodo.7276465',
    'GBR': 'https://doi.org/10.5281/zenodo.13684044',
}

COMIX_COUNTRIES = list(COMIX_URLS.keys())


def _load_comix(iso3: str, setting: str = 'all') -> Optional[np.ndarray]:
    """
    Load CoMix pandemic-era contact matrix.

    Priority:
      1. Local CSV cache (comix/{iso3}_{setting}.csv or {iso3}_all.csv)
      2. Instructions to download via R (see get_download_instructions())

    Available for: 19 European countries (see COMIX_URLS)
    Source: Coletti et al. 2020; Jarvis et al. 2020
    Zenodo: see COMIX_URLS dict above

    Note: CoMix reflects pandemic/lockdown contact patterns.
          Use SOCRATES/POLYMOD for pre-pandemic baseline contacts.

    Args:
        iso3:    ISO3 country code e.g. 'GBR', 'BEL', 'NLD'
        setting: 'all' (only setting currently available for CoMix)
    """
    if iso3.upper() not in COMIX_COUNTRIES:
        return None

    candidates = [
        COMIX_PATH / f'{iso3.upper()}_{setting}.csv',
        COMIX_PATH / f'{iso3.upper()}_all.csv',   # fallback to all-contacts
        COMIX_PATH / f'{iso3.upper()}.csv',
    ]

    for path in candidates:
        if path.exists():
            try:
                df  = pd.read_csv(path, index_col=0)
                mat = df.values.astype(float)
                # Replace NaN with 0 — can occur in CoMix sparse age groups
                mat = np.nan_to_num(mat, nan=0.0)
                return mat
            except Exception as e:
                print(f"  ⚠ Could not load CoMix matrix {path.name}: {e}")

    print(f"  ⚠ No CoMix CSV found for {iso3}. "
          f"Download via R — see get_download_instructions()")
    return None
 
# ══════════════════════════════════════════════════════════════
# MAIN PUBLIC FUNCTIONS
# ══════════════════════════════════════════════════════════════
 
def get_contact_matrix(
    iso3: str,
    setting: str = 'all',
    source: Optional[str] = None,
) -> Optional[np.ndarray]:
    """
    Load age contact matrix for a country.
 
    Priority: Prem 2021 → POLYMOD → SOCRATES → CoMix
    Override with source= to force a specific dataset.
 
    Args:
        iso3:    ISO3 country code e.g. 'KEN', 'GBR', 'USA'
        setting: 'all', 'home', 'work', 'school', 'other'
        source:  force a source: 'prem2021', 'polymod', 'socrates', 'comix'
                 default None = auto (priority order above)
 
    Returns:
        numpy array (contact matrix) or None if not found
 
    Examples:
        m = get_contact_matrix('KEN')             # Kenya, all contacts
        m = get_contact_matrix('GBR', 'school')   # UK, school contacts
        m = get_contact_matrix('GBR', source='polymod')  # force POLYMOD
    """
    if setting not in SETTINGS:
        raise ValueError(f"setting must be one of {SETTINGS}")
 
    iso3 = iso3.upper()
 
    if source:
        loaders = {'prem2021': _load_prem, 'polymod': _load_polymod,
                   'socrates': _load_socrates, 'comix': _load_comix}
        fn = loaders.get(source.lower())
        if not fn:
            raise ValueError(f"source must be one of {list(loaders.keys())}")
        return fn(iso3, setting)
 
    # Auto priority
    for loader, name in [
        (_load_prem,     'Prem 2021'),
        (_load_polymod,  'POLYMOD'),
        (_load_socrates, 'SOCRATES'),
        (_load_comix,    'CoMix'),
    ]:
        matrix = loader(iso3, setting)
        if matrix is not None:
            print(f"  ✓ Contact matrix loaded: {iso3} ({setting}) [{name}] "
                  f"shape={matrix.shape}")
            return matrix
 
    print(f"  ⚠ No contact matrix found for {iso3}/{setting}. "
          f"Download data — see get_download_instructions()")
    return None
 
 
def get_mean_contacts(iso3: str, setting: str = 'all', source: Optional[str] = None) -> Optional[float]:
    """
    Return mean contacts per person per day from the matrix.
    Used to set n_contacts in SimParams.
 
    Args:
        iso3:    ISO3 country code
        setting: contact setting
 
    Returns:
        float mean contacts/day or None if matrix not found
 
    Example:
        n = get_mean_contacts('KEN')   # e.g. 12.4
    """
    matrix = get_contact_matrix(iso3, setting, source=source)
    if matrix is None:
        return None
    return float(matrix.sum(axis=1).mean())
 
 
def get_contact_matrix_info(iso3: str) -> dict:
    """
    Return metadata about available matrices for a country.
 
    Returns:
        dict with available sources and settings per source
    """
    iso3 = iso3.upper()
    info = {'country': iso3, 'available': {}}
 
    for source, loader, countries in [
        ('prem2021',  _load_prem,    None),
        ('polymod',   _load_polymod, POLYMOD_COUNTRIES),
        ('socrates',  _load_socrates,None),
        ('comix',     _load_comix,   COMIX_COUNTRIES),
    ]:
        if countries and iso3 not in countries:
            continue
        available_settings = []
        for s in SETTINGS:
            if loader(iso3, s) is not None:
                available_settings.append(s)
        if available_settings:
            info['available'][source] = available_settings
 
    return info
 
 
def list_available_countries() -> dict:
    """
    Scan data directories and return dict of available countries per source.
    """
    available = {}
    for source, path in [
        ('prem2021',  PREM_PATH),
        ('polymod',   POLYMOD_PATH),
        ('socrates',  SOCRATES_PATH),
        ('comix',     COMIX_PATH),
    ]:
        if not path.exists():
            available[source] = []
            continue
        countries = sorted(set(
            f.stem.split('_')[0].upper()
            for f in path.glob('*.csv')
        ))
        available[source] = countries
    return available