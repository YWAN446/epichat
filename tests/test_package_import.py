"""Importing a leaf module of the package must not drag in the orchestrator.

The simulation service imports epichat.generator and epichat.schema only; if
the package __init__ eagerly imported EpiChat, the service bundle would need
every orchestrator dependency and pay its import time on every cold start.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _run(code: str) -> str:
    result = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, cwd=ROOT, check=True
    )
    return result.stdout.strip()


def test_importing_generator_leaves_orchestrator_out():
    out = _run(
        "import sys; import epichat.generator; "
        "print('epichat.epichat' in sys.modules, 'anthropic' in sys.modules)"
    )
    assert out == "False False"


def test_eager_names_still_resolve():
    out = _run("from epichat import EpiChat, EpiChatResult; print(EpiChat.__name__, EpiChatResult.__name__)")
    assert out == "EpiChat EpiChatResult"


def test_unknown_attribute_raises_attribute_error():
    out = _run(
        "import epichat\n"
        "try:\n    epichat.nope\nexcept AttributeError as e:\n    print('AttributeError', 'nope' in str(e))"
    )
    assert out == "AttributeError True"
