"""The parent process must not pay for imports only the child or a repair
needs. Starsim runs in the child; the Anthropic SDK is used only when a run
fails. Both cost over a second each on a cold start, and the daily health
check runs against a cold instance."""
import subprocess
import sys
from pathlib import Path

SIM = Path(__file__).resolve().parent.parent


def test_importing_the_app_loads_neither_starsim_nor_anthropic():
    code = (
        "import sys; sys.path.insert(0, r'%s'); import main; "
        "print('starsim' in sys.modules, 'anthropic' in sys.modules, main.STARSIM_VERSION)" % SIM
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True, cwd=SIM)
    assert out.stdout.strip() == "False False 3.3.2"
