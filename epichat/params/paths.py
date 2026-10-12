"""Dotted paths over nested parameter dicts ("disease.dur_inf.mean_days")."""
from __future__ import annotations

from typing import Any


def flatten(d: dict, prefix: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in d.items():
        path = f"{prefix}{key}"
        if isinstance(value, dict):
            out.update(flatten(value, f"{path}."))
        else:
            out[path] = value
    return out


def get_path(d: dict, path: str) -> Any:
    node: Any = d
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def set_path(d: dict, path: str, value: Any) -> None:
    parts = path.split(".")
    node = d
    for part in parts[:-1]:
        if not isinstance(node.get(part), dict):
            node[part] = {}
        node = node[part]
    node[parts[-1]] = value


def diff(before: dict, after: dict) -> list[dict]:
    old, new = flatten(before), flatten(after)
    changes = [{"field": k, "from": old[k], "to": new.get(k)} for k in old if old[k] != new.get(k)]
    changes += [{"field": k, "from": None, "to": new[k]} for k in new if k not in old]
    return changes
