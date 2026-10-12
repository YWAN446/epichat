"""v1 flat parameters -> schema v2 (spec 6.1). Pinned against the TypeScript
migrateV1 by web/tests/fixtures/parity.json."""
from __future__ import annotations

from .schema_v2 import SimParamsV2

_VACCINE = ("vaccine", "vaccination", "vaccinate")
_NETWORK_KEYS = ("network_type", "n_contacts", "network_beta")
_DEMOGRAPHICS_KEYS = ("use_demographics", "birth_rate", "death_rate", "age_pct_under18", "age_pct_18_64", "age_pct_over65",
                      "country", "auto_demographics", "demographics_year", "demographics_source")
_RUN_KEYS = ("n_agents", "sim_dur_years", "rand_seed")


def is_v1(data: dict) -> bool:
    return "schema_version" not in data


def _get(f: dict, key: str, default):
    """A v1 row that stored null for a defaulted scalar reads as missing, as the TypeScript side does."""
    value = f.get(key)
    return default if value is None else value


def _duration(days):
    return None if days is None else {"mean_days": days, "dist": "constant", "sd_days": None}


def _is_day0_vaccine(i: dict) -> bool:
    return str(i.get("type", "")).lower() in _VACCINE and int(i.get("start_day") or 0) <= 0


def migrate_v1(flat: dict) -> dict:
    f = dict(flat)
    interventions = [dict(i) for i in f.get("interventions") or []]
    day0 = [i for i in interventions if _is_day0_vaccine(i)]
    disease = {
        "model": _get(f, "disease_type", "sir"),
        "beta": _get(f, "beta", 22.8125),
        "dur_exp": _duration(f.get("dur_exp")),
        "dur_inf": _duration(_get(f, "dur_inf", 10.0)),
        "dur_immune": _duration(f.get("dur_immune")),
        "p_death": _get(f, "p_death", 0.0),
        "p_asymp": _get(f, "p_asymp", 0.3),
        "rel_trans_asymp": _get(f, "rel_trans_asymp", 0.5),
        "sis_waning": 0.0,
        "sis_imm_boost": 0.0,
        "seed": {"mode": "fraction", "value": _get(f, "init_prev", 0.01), "day": 0},
        "initial_immune_frac": min(float(day0[-1].get("coverage") or 0.0), 0.99) if day0 else 0.0,
    }
    return {
        "schema_version": 2,
        "disease": disease,
        "network": {k: f[k] for k in _NETWORK_KEYS if k in f},
        "demographics": {k: f[k] for k in _DEMOGRAPHICS_KEYS if k in f},
        "interventions": [i for i in interventions if not _is_day0_vaccine(i)],
        "run": {k: f[k] for k in _RUN_KEYS if k in f},
    }


def coerce_params(data) -> SimParamsV2:
    """Parameters of either shape, or a v1 SimParams object, validated as v2."""
    if isinstance(data, SimParamsV2):
        return data
    if hasattr(data, "model_dump"):
        data = data.model_dump()
    if isinstance(data, dict) and is_v1(data):
        data = migrate_v1(data)
    return SimParamsV2.model_validate(data)
