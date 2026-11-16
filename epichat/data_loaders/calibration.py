import logging
import requests ##allows you to send HTTP requests to web servers
import pandas as pd ##dataframe
import numpy as np ##numerical/mathematical
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional #used to indicate that a variable, function argument, or return value can either be a specific type or None

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).parent.parent / 'data' / 'calibration_cache'

OWID_URL = "https://catalog.ourworldindata.org/garden/covid/latest/compact/compact.csv"

OWID_METRICS = [# Cases
    "total_cases",
    "new_cases",
    "new_cases_smoothed",
    "total_cases_per_million",
    "new_cases_per_million",
    "new_cases_smoothed_per_million",

    # Deaths
    "total_deaths",
    "new_deaths",
    "new_deaths_smoothed",
    "total_deaths_per_million",
    "new_deaths_per_million",
    "new_deaths_smoothed_per_million",

    # Vaccination
    "total_vaccinations",
    "people_vaccinated",
    "people_fully_vaccinated",
    "total_boosters",
    "new_vaccinations",
    "new_vaccinations_smoothed",
    "total_vaccinations_per_hundred",
    "people_vaccinated_per_hundred",
    "people_fully_vaccinated_per_hundred",
    "total_boosters_per_hundred",
    "new_vaccinations_smoothed_per_million",
    "new_people_vaccinated_smoothed",
    "new_people_vaccinated_smoothed_per_hundred",

    # Demographics / metadata
    "population",
    "population_density",
    "median_age",
    "life_expectancy",
    "gdp_per_capita",
    "extreme_poverty",
    "diabetes_prevalence",
    "handwashing_facilities",
    "hospital_beds_per_thousand",
    "human_development_index",]

# ══════════════════════════════════════════════════════════════
# SOURCE 1: OUR WORLD IN DATA
# ══════════════════════════════════════════════════════════════

def fetch_owid(
        iso3: str,
        metric: str = 'new_cases_smoothed',
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        use_cache: bool = True,
) -> Optional[pd.DataFrame]:
    """Fetch an OWID COVID time series for calibration.

    WORK IN PROGRESS: only the metric validation exists so far — the OWID
    download/cache/filter logic has not been written yet, so this always
    returns None for valid metrics.
    """
    if metric not in OWID_METRICS:
        logger.warning("Unknown metric '%s'. Available: %s", metric, OWID_METRICS)
        return None

    logger.warning("fetch_owid is not implemented yet (work in progress); returning None")
    return None
