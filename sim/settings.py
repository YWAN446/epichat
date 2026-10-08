"""Service settings, read from the environment. Every value has a default
except the shared secret, whose absence makes the protected routes fail
closed (see main.py)."""
from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


@dataclass(frozen=True)
class Settings:
    shared_secret: str
    timeout_seconds: float
    max_repairs: int
    repair_model: str
    max_agent_years: float
    series_max_points: int
    cache_dir: str


def load_settings(env: Mapping[str, str] = os.environ) -> Settings:
    return Settings(
        shared_secret=env.get("SIM_SHARED_SECRET", ""),
        timeout_seconds=float(env.get("SIM_TIMEOUT_SECONDS", "120")),
        max_repairs=int(env.get("SIM_MAX_REPAIRS", "2")),
        repair_model=env.get("SIM_REPAIR_MODEL", "claude-opus-5-5"),
        max_agent_years=float(env.get("SIM_MAX_AGENT_YEARS", "500000")),
        series_max_points=int(env.get("SIM_SERIES_MAX_POINTS", "2000")),
        cache_dir=env.get("EPICHAT_CACHE_DIR", str(Path(tempfile.gettempdir()) / "epichat-cache")),
    )
