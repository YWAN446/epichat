"""Value-preserving normalization for one parameter block.

Shared by scripts/normalize_parameters.py (which fixes main's own file) and
scripts/port_annie_parameters.py (which fixes Annie's before porting it).
Nothing here changes a cited number: it moves qualitative text out of slots
that must hold numbers, and drops placeholders that carry no information.
"""
from __future__ import annotations

_SLOTS = ("min", "max", "typical")
_SCENARIO_KEYS = ("pre_pandemic", "initial_lockdown", "post_relaxation")
_EMPTY = {"N/A", "NA", "NONE", ""}


def is_num(v) -> bool:
    """True for a real number; False for bool, None, and every string."""
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def normalize_param(param: dict) -> None:
    """Normalize one parameter block in place.

    * an estimate's "range" that is a string becomes null
    * a consensus min/max/typical that is not a number becomes null, and any
      text it carried moves to consensus.special_value
    * COVID-19's scenario sub-ranges nest under consensus.scenarios
    """
    for est in param.get("estimates") or []:
        if isinstance(est.get("range"), str):
            est["range"] = None

    cons = param.get("consensus")
    if not isinstance(cons, dict):
        return

    texts: list[str] = []
    for slot in _SLOTS:
        value = cons.get(slot)
        if value is None or is_num(value):
            continue
        if isinstance(value, str) and value.strip().upper() not in _EMPTY:
            texts.append(value.strip())
        cons[slot] = None

    if texts:
        carried = [cons["special_value"]] if cons.get("special_value") else []
        cons["special_value"] = "; ".join(dict.fromkeys(carried + texts))

    scenarios = {k: cons.pop(k) for k in _SCENARIO_KEYS if k in cons}
    if scenarios:
        cons["scenarios"] = scenarios
