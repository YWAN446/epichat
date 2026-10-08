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
