"""EpiChat simulation service.

Private FastAPI app: validates SimParams, runs Starsim through the package's
generator and templates, repairs parameters with the model when a run fails,
and returns stats and series. Reachable from the web app only through the
Vercel service binding plus a shared secret.
"""
from __future__ import annotations

import hmac
import os
import platform
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PACKAGE_ROOT = HERE if (HERE / "epichat").is_dir() else HERE.parent   # Vercel copy vs. local checkout
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
os.environ.setdefault("EPICHAT_CACHE_DIR", str(Path(tempfile.gettempdir()) / "epichat-cache"))

import starsim  # noqa: E402
from fastapi import Depends, FastAPI, HTTPException, Request  # noqa: E402
from fastapi.exceptions import RequestValidationError  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from epichat.data_loaders.demographics import get_demographics_for_sim  # noqa: E402
from epichat.schema import SimParams  # noqa: E402
from series import scaled_outcome, thin  # noqa: E402
from service import simulate  # noqa: E402
from settings import Settings, load_settings  # noqa: E402

app = FastAPI(title="EpiChat simulation service", docs_url=None, redoc_url=None)
_state = {"served": False}


class SimulateRequest(BaseModel):
    params: SimParams
    pop_scale: float = Field(default=1.0, ge=1.0)
    context_text: str = Field(default="", max_length=6000)


def _error(status: int, kind: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"ok": False, "error": {"kind": kind, **extra}})


@app.exception_handler(HTTPException)
async def _http_error(_: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, dict) else {"kind": "error", "detail": exc.detail}
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "error": detail})


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    # pydantic's error objects can carry non-serializable ctx values; copy only what the client needs
    detail = [{"loc": [str(p) for p in e.get("loc", [])], "msg": e.get("msg", ""), "type": e.get("type", "")}
              for e in exc.errors()]
    return _error(422, "invalid_params", detail=detail)


def require_bearer(request: Request) -> Settings:
    settings = load_settings()
    if not settings.shared_secret:
        raise HTTPException(500, {"kind": "misconfigured"})
    given = request.headers.get("authorization", "")
    expected = f"Bearer {settings.shared_secret}"
    if not hmac.compare_digest(given.encode(), expected.encode()):
        raise HTTPException(401, {"kind": "unauthorized"})
    return settings


@app.get("/health")
def health() -> dict:
    return {"ok": True, "starsim_version": starsim.__version__,
            "python_version": platform.python_version(), "cold_start": not _state["served"]}


@app.post("/simulate")
def simulate_route(body: SimulateRequest, settings: Settings = Depends(require_bearer)):
    agent_years = body.params.n_agents * body.params.sim_dur_years
    if agent_years > settings.max_agent_years:
        return _error(
            422, "too_large",
            detail=(f"n_agents × sim_dur_years = {agent_years:,.0f} exceeds the cap of "
                    f"{settings.max_agent_years:,.0f} agent-years; reduce n_agents or sim_dur_years"),
            agent_years=agent_years, cap=settings.max_agent_years,
        )
    cold_start = not _state["served"]
    started = time.perf_counter()
    outcome = simulate(body.params, body.context_text, settings)
    _state["served"] = True
    duration_ms = int((time.perf_counter() - started) * 1000)

    if not outcome.ok:
        if outcome.timed_out:
            return _error(504, "timeout", seconds=settings.timeout_seconds,
                          repairs=outcome.repairs, attempts=outcome.attempts)
        return _error(500, "execution_failed", detail=outcome.error or "unknown execution error",
                      repairs=outcome.repairs, attempts=outcome.attempts)

    stats, series = scaled_outcome(outcome.stats, outcome.series, body.pop_scale)
    return {
        "ok": True,
        "effective_params": outcome.effective_params.model_dump(),
        "population": int(round(outcome.effective_params.n_agents * body.pop_scale)),
        "stats": stats,
        "stats_agents": outcome.stats,
        "series": thin(series, settings.series_max_points),
        "pop_scale": body.pop_scale,
        "repairs": outcome.repairs,
        "attempts": outcome.attempts,
        "duration_ms": duration_ms,
        "cold_start": cold_start,
        "starsim_version": starsim.__version__,
    }


@app.get("/demographics/{iso3}")
def demographics(iso3: str, settings: Settings = Depends(require_bearer)):
    code = iso3.strip().upper()
    try:
        demo = get_demographics_for_sim(code)
    except ValueError:
        return _error(404, "not_found")
    return {"ok": True, "iso3": code, "birth_rate": demo["birth_rate"],
            "death_rate": demo["death_rate"], "source": demo["source"]}
