"""Export ISO3 -> English location name from the UN Population Data Portal
for the web app's details panel (the configuration stores codes such as KEN).

    py -3.10 scripts/export_country_names.py    # writes web/data/country_names.json

Needs UN_API_KEY in the root .env, like scripts/export_un_locations.py.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

from epichat.adapters.un_wpp import _BASE_URL, _fetch_text, _parse_csv  # noqa: E402


def main(web_dir: Path = ROOT / "web") -> None:
    text = _fetch_text(f"{_BASE_URL}/locations?format=csv", api_key=os.environ.get("UN_API_KEY") or None)
    names: dict[str, str] = {}
    for row in _parse_csv(text):
        iso3 = row.get("Iso3", "").strip()
        name = row.get("Name", "").strip()
        if len(iso3) == 3 and iso3.isupper() and name:
            names[iso3] = name
    if len(names) < 200:
        sys.exit("The UN locations list could not be fetched (is UN_API_KEY set?); nothing written.")
    out = web_dir / "data" / "country_names.json"
    out.write_text(json.dumps(dict(sorted(names.items())), ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {out.relative_to(ROOT)} ({len(names)} locations)")


if __name__ == "__main__":
    main()
