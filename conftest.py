import sys
from pathlib import Path

# Add the project root to sys.path so tests can import epichat
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "live: test calls the live Anthropic API (set EPICHAT_TEST_LIVE=1)"
    )
