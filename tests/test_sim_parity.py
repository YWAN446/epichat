"""Spec section 13: for each model's default parameters at 10k agents, the
median over ten seeds of total infections (the v1 definition, without the
day-0 seeds) and of peak day from the builder on Starsim 3.7.2 is within 5%
and 3 days of the 3.3.2 template pipeline
(tests/fixtures/sim_baseline_v1.json, captured once by
scripts/capture_sim_baseline.py). About two minutes: sixty in-process runs."""
import json
import statistics
from pathlib import Path

import pytest

from epichat.sim.run_params import run

ROOT = Path(__file__).resolve().parent.parent
BASELINE = json.loads((ROOT / "tests" / "fixtures" / "sim_baseline_v1.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", sorted(BASELINE["cases"]))
def test_builder_matches_the_v1_baseline(name):
    case = BASELINE["cases"][name]
    totals, peak_days, peaks = [], [], []
    for seed in BASELINE["seeds"]:
        stats = run({**case["params"], "rand_seed": seed})["stats"]
        totals.append(stats["total_infected"] - stats["seeds_day0"])     # the baseline's cum_infections excludes the day-0 seeds
        peak_days.append(stats["peak_day"])
        peaks.append(stats["peak_infections"])
    median_total, base_total = statistics.median(totals), case["median"]["total_infected"]
    assert abs(median_total - base_total) <= 0.05 * base_total, (name, median_total, base_total, totals)
    if name == "sis":
        # sis settles on an endemic plateau, so the day of the maximum is a random day of the
        # plateau (the baseline's own seeds range from day 65 to day 356); the plateau's height
        # is the comparable quantity, so the peak size stands in for the peak day
        median_peak = statistics.median(peaks)
        base_peak = statistics.median(r["peak_infections"] for r in case["per_seed"])
        assert abs(median_peak - base_peak) <= 0.05 * base_peak, (name, median_peak, base_peak, peaks)
    else:
        median_day, base_day = statistics.median(peak_days), case["median"]["peak_day"]
        assert abs(median_day - base_day) <= 3, (name, median_day, base_day, peak_days)
