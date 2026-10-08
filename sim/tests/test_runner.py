import os
import sys
import tempfile
import time
from pathlib import Path

from runner import RunResult, run_script


def _out() -> Path:
    return Path(tempfile.gettempdir()) / f"epichat-test-{os.getpid()}-{time.time_ns()}.json"


def test_success_reads_the_result_file_and_removes_it():
    out = _out()
    code = (
        "import json, sys\n"
        f"json.dump({{'stats': {{'n_agents': 5}}, 'series': {{'day': [0, 1]}}}}, open(r'{out}', 'w'))\n"
        "print('some chatter on stdout')\n"
    )
    result = run_script(code, out, timeout=30)
    assert isinstance(result, RunResult)
    assert result.ok and not result.timed_out and result.error is None
    assert result.stats == {"n_agents": 5} and result.series == {"day": [0, 1]}
    assert result.duration_ms >= 0
    assert not out.exists()


def test_failure_reports_the_stderr_tail():
    result = run_script("import sys\nsys.stderr.write('x' * 3000 + 'END')\nsys.exit(1)\n", _out(), timeout=30)
    assert not result.ok and not result.timed_out
    assert result.error.endswith("END") and len(result.error) <= 2000


def test_missing_result_file_is_a_failure():
    result = run_script("print('did not write the file')\n", _out(), timeout=30)
    assert not result.ok
    assert "result file" in result.error


def test_timeout_kills_the_child():
    started = time.perf_counter()
    result = run_script("import time\ntime.sleep(10)\n", _out(), timeout=1)
    assert result.timed_out and not result.ok
    assert time.perf_counter() - started < 8
    assert "1" in result.error


def test_non_utf8_stderr_is_reported():
    code = "import sys\nsys.stderr.buffer.write(b'caf\\xe9 \\xff boom')\nsys.exit(2)\n"
    result = run_script(code, _out(), timeout=30)
    assert not result.ok
    assert "boom" in result.error


def test_child_sees_parent_import_path_and_cache_dirs():
    out = _out()
    code = (
        "import json, os\n"
        "json.dump({'stats': {}, 'series': {'env': [os.environ.get('PYTHONPATH', ''), "
        "os.environ.get('NUMBA_CACHE_DIR', ''), os.environ.get('MPLCONFIGDIR', '')]}}, "
        f"open(r'{out}', 'w'))\n"
    )
    result = run_script(code, out, timeout=30)
    pythonpath, numba, mpl = result.series["env"]
    assert str(Path(sys.path[0])) in pythonpath
    assert numba.endswith("numba") and mpl.endswith("mpl")
