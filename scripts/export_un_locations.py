"""Export the UN Population Data Portal's location table (ISO3 -> id) for the
web app, so the serverless adapter never has to download it at start-up.
Needs UN_API_KEY in the environment or the root .env.

    py -3.10 scripts/export_un_locations.py
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

from epichat.adapters.un_wpp import UNWPPAdapter  # noqa: E402


def main(web_dir: Path = ROOT / "web") -> None:
    adapter = UNWPPAdapter(api_key=os.environ.get("UN_API_KEY") or None)
    table = adapter.iso3_table()
    if len(table) < 200:
        sys.exit("The UN locations list could not be fetched (is UN_API_KEY set?); nothing written.")
    out = web_dir / "data" / "un_locations.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(dict(sorted(table.items())), indent=1) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
    print("wrote web/data/un_locations.json")
