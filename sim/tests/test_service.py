from pathlib import Path

from epichat.parser import RepairResult
from epichat.schema import SimParams
from runner import RunResult
from service import Outcome, diff_params, simulate
from settings import load_settings

SETTINGS = load_settings({"SIM_SHARED_SECRET": "t", "SIM_TIMEOUT_SECONDS": "9", "SIM_MAX_REPAIRS": "2"})
GOOD_SERIES = {"day": [0, 1, 2], "n_infected": [1.0, 3.0, 2.0], "cum_infections": [1.0, 4.0, 6.0], "cum_deaths": [0.0, 0.0, 1.0]}


def _params(**over) -> SimParams:
    base = dict(disease_type="sir", beta=0.05, n_agents=100, sim_dur_years=0.01, rand_seed=1)
    base.update(over)
    return SimParams(**base)


def _ok() -> RunResult:
    return RunResult(True, {"n_agents": 100}, GOOD_SERIES, None, False, 10)


def _fail(msg="Traceback: KeyError: 'dur_exp'") -> RunResult:
    return RunResult(False, {}, {}, msg, False, 10)


def _timeout() -> RunResult:
    return RunResult(False, {}, {}, "Simulation timed out after 9 seconds.", True, 9000)


class FakeRunner:
    def __init__(self, results):
        self.results = list(results)
        self.calls: list[tuple[str, Path, float]] = []

    def __call__(self, code, output_path, timeout):
        self.calls.append((code, Path(output_path), timeout))
        return self.results.pop(0)


class FakeRepairer:
    def __init__(self, results):
        self.results = list(results)
        self.calls = []

    def __call__(self, user_input, params, error, model):
        self.calls.append((user_input, params, error, model))
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def _repair_to(params: SimParams) -> RepairResult:
    return RepairResult(params=params, model="claude-opus-5-5", input_tokens=120, output_tokens=30)


def test_diff_params_lists_changed_top_level_fields():
    before = _params()
    after = _params(disease_type="seir", dur_exp=5.0, interventions=[{"type": "vaccine", "coverage": 0.5}])
    changes = diff_params(before, after)
    assert {"field": "disease_type", "from": "sir", "to": "seir"} in changes
    assert {"field": "dur_exp", "from": None, "to": 5.0} in changes
    inter = next(c for c in changes if c["field"] == "interventions")
    assert inter["from"] == [] and inter["to"][0]["type"] == "vaccine"
    assert len(changes) == 3


def test_success_first_try_has_no_repairs_and_computes_stats():
    run = FakeRunner([_ok()])
    out = simulate(_params(), "measles", SETTINGS, run=run, repair=FakeRepairer([]))
    assert out.ok and out.status == 200 and out.attempts == 1 and out.repairs == []
    assert out.stats == {"peak_infections": 3, "peak_day": 1, "total_infected": 6, "total_deaths": 1,
                         "n_agents": 100, "sim_days": 3}
    assert out.series == GOOD_SERIES
    code, path, timeout = run.calls[0]
    assert "json.dump(" in code and "matplotlib" not in code
    assert path.as_posix() in code
    assert timeout == 9.0


def test_fail_then_repair_then_succeed_records_one_repair():
    repaired = _params(disease_type="seir", dur_exp=5.0)
    run = FakeRunner([_fail(), _ok()])
    repair = FakeRepairer([_repair_to(repaired)])
    out = simulate(_params(), "measles in Kenya", SETTINGS, run=run, repair=repair)
    assert out.ok and out.attempts == 2
    assert out.effective_params.disease_type == "seir"
    assert len(out.repairs) == 1
    record = out.repairs[0]
    assert record["attempt"] == 1 and "KeyError" in record["error"]
    assert {"field": "dur_exp", "from": None, "to": 5.0} in record["changes"]
    assert record["usage"] == {"model": "claude-opus-5-5", "input_tokens": 120, "output_tokens": 30}
    assert repair.calls[0][0] == "measles in Kenya" and repair.calls[0][3] == "claude-opus-5-5"
    assert "seir" in run.calls[1][0].lower()


def test_every_attempt_fails_returns_500_with_all_repairs():
    run = FakeRunner([_fail("e1"), _fail("e2"), _fail("e3")])
    repair = FakeRepairer([_repair_to(_params(beta=0.06)), _repair_to(_params(beta=0.07))])
    out = simulate(_params(), "x", SETTINGS, run=run, repair=repair)
    assert not out.ok and out.status == 500 and out.attempts == 3
    assert [r["attempt"] for r in out.repairs] == [1, 2]
    assert out.error == "e3" and not out.timed_out


def test_timeout_is_final_and_never_repaired():
    run = FakeRunner([_timeout()])
    repair = FakeRepairer([_repair_to(_params())])
    out = simulate(_params(), "x", SETTINGS, run=run, repair=repair)
    assert not out.ok and out.status == 504 and out.timed_out and out.attempts == 1
    assert repair.calls == [] and out.repairs == []


def test_repairer_failure_ends_the_loop_with_repair_error():
    run = FakeRunner([_fail("boom")])
    repair = FakeRepairer([RuntimeError("model unavailable")])
    out = simulate(_params(), "x", SETTINGS, run=run, repair=repair)
    assert not out.ok and out.status == 500 and out.attempts == 1
    assert out.repairs == [{"attempt": 1, "error": "boom", "repair_error": "RuntimeError: model unavailable"}]
    assert out.error == "boom"


def test_zero_repairs_setting_means_one_attempt():
    settings = load_settings({"SIM_SHARED_SECRET": "t", "SIM_MAX_REPAIRS": "0"})
    run = FakeRunner([_fail("only")])
    repair = FakeRepairer([_repair_to(_params())])
    out = simulate(_params(), "x", settings, run=run, repair=repair)
    assert out.status == 500 and out.attempts == 1 and repair.calls == []


def test_each_attempt_gets_its_own_output_path():
    run = FakeRunner([_fail(), _ok()])
    simulate(_params(), "x", SETTINGS, run=run, repair=FakeRepairer([_repair_to(_params(beta=0.06))]))
    paths = [call[1] for call in run.calls]
    assert paths[0] != paths[1]
    assert all(p.suffix == ".json" and p.name.startswith("epichat-") for p in paths)


def test_render_failure_is_execution_failed(monkeypatch):
    import service

    class BrokenGenerator:
        def generate(self, *a, **k):
            raise RuntimeError("'nope' is undefined")

    monkeypatch.setattr(service, "CodeGenerator", BrokenGenerator)
    out = simulate(_params(), "x", SETTINGS, run=FakeRunner([]), repair=FakeRepairer([]))
    assert not out.ok and out.status == 500 and out.attempts == 1
    assert "template" in out.error and "nope" in out.error


def test_effective_params_are_the_resolved_ones():
    run = FakeRunner([_ok()])
    out = simulate(_params(n_contacts=4), "x", SETTINGS, run=run, repair=FakeRepairer([]))
    assert out.effective_params.n_contacts == 4   # no country: resolve_demographics leaves them alone
    assert isinstance(out, Outcome)


def test_repair_above_cap_is_not_run():
    settings = load_settings({"SIM_SHARED_SECRET": "t", "SIM_MAX_AGENT_YEARS": "1000"})
    run = FakeRunner([_fail("boom"), _ok()])
    too_big = _params(n_agents=2000, sim_dur_years=1.0)   # 2,000 agent-years > cap 1,000
    out = simulate(_params(n_agents=100, sim_dur_years=1.0), "x", settings, run=run, repair=FakeRepairer([_repair_to(too_big)]))
    assert not out.ok and out.status == 500 and out.attempts == 1
    assert len(run.calls) == 1
    assert out.repairs[0]["attempt"] == 1 and "cap" in out.repairs[0]["repair_error"]
    assert out.error == "boom"


def test_repair_diff_ignores_what_demographics_resolution_fills_in(monkeypatch, tmp_path):
    monkeypatch.setenv("EPICHAT_CACHE_DIR", str(tmp_path / "cache"))
    before = _params(country="KEN", dur_inf=10.0)
    repaired = _params(country="KEN", dur_inf=11.0)   # the model changed one field and echoed nothing else
    run = FakeRunner([_fail("err"), _ok()])
    out = simulate(before, "x", SETTINGS, run=run, repair=FakeRepairer([_repair_to(repaired)]))
    assert out.ok
    assert out.repairs[0]["changes"] == [{"field": "dur_inf", "from": 10.0, "to": 11.0}]
    assert out.effective_params.use_demographics is True and out.effective_params.country == "KEN"
