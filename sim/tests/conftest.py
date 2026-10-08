"""Make the flat sim modules and the repository's epichat package importable,
and give every test a secret and a dummy model key."""
import os
import sys
from pathlib import Path

SIM = Path(__file__).resolve().parent.parent
ROOT = SIM.parent
for path in (str(SIM), str(ROOT)):
    if path not in sys.path:
        sys.path.insert(0, path)

os.environ.setdefault("SIM_SHARED_SECRET", "test")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-never-used")

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_demographics_cache():
    """The package memoizes country lookups in-process; without this, a test
    that looked up a country decides what a later test sees and whether its
    cache file gets written."""
    from epichat.data_loaders import demographics
    demographics.get_country_demographics.cache_clear()
    yield
    demographics.get_country_demographics.cache_clear()
