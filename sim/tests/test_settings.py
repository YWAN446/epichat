import tempfile
from pathlib import Path

from settings import Settings, load_settings


def test_defaults_match_the_spec():
    s = load_settings({"SIM_SHARED_SECRET": "abc"})
    assert s == Settings(
        shared_secret="abc", timeout_seconds=120.0, max_repairs=2, repair_model="claude-opus-5-5",
        max_agent_years=500000.0, series_max_points=2000,
        cache_dir=str(Path(tempfile.gettempdir()) / "epichat-cache"),
    )


def test_every_setting_reads_from_the_environment():
    s = load_settings({
        "SIM_SHARED_SECRET": "x", "SIM_TIMEOUT_SECONDS": "7.5", "SIM_MAX_REPAIRS": "0",
        "SIM_REPAIR_MODEL": "claude-sonnet-5-5", "SIM_MAX_AGENT_YEARS": "1000",
        "SIM_SERIES_MAX_POINTS": "50", "EPICHAT_CACHE_DIR": "/tmp/c",
    })
    assert (s.timeout_seconds, s.max_repairs, s.repair_model) == (7.5, 0, "claude-sonnet-5-5")
    assert (s.max_agent_years, s.series_max_points, s.cache_dir) == (1000.0, 50, "/tmp/c")


def test_missing_secret_is_empty_string():
    assert load_settings({}).shared_secret == ""
