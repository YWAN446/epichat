from series import scale_counts, scaled_outcome, stats_from, stride_for, thin


def _series(n: int) -> dict:
    return {
        "day": list(range(n)),
        "n_infected": [float(i % 7) for i in range(n)],
        "cum_infections": [float(i * 2) for i in range(n)],
        "cum_deaths": [float(i // 10) for i in range(n)],
    }


def test_stride_for_is_ceil_and_at_least_one():
    assert stride_for(10, 2000) == 1
    assert stride_for(2000, 2000) == 1
    assert stride_for(2001, 2000) == 2
    assert stride_for(7301, 2000) == 4
    assert stride_for(0, 2000) == 1


def test_thin_short_series_is_identity():
    s = _series(31)
    assert thin(s, 2000) == s


def test_thin_one_point():
    s = _series(1)
    assert thin(s, 2000) == s


def test_thin_keeps_stride_points_and_the_last_day_without_duplicates():
    s = _series(7301)
    out = thin(s, 2000)
    assert len(out["day"]) <= 2000 + 1
    assert out["day"][0] == 0 and out["day"][-1] == 7300
    assert out["day"][1] == 4
    assert len(set(out["day"])) == len(out["day"])
    for key in s:
        assert len(out[key]) == len(out["day"])
    assert out["cum_infections"][-1] == s["cum_infections"][-1]


def test_thin_last_index_appears_exactly_once_whether_or_not_it_is_on_the_stride():
    off = thin(_series(4000), 2000)    # stride 2; last index 3999 is not on the stride -> appended
    assert off["day"][-1] == 3999 and off["day"][-2] == 3998
    on = thin(_series(3999), 2000)     # stride 2; last index 3998 is on the stride -> not appended twice
    assert on["day"][-1] == 3998 and on["day"][-2] == 3996
    assert len(on["day"]) == 2000


def test_scale_counts_rounds_and_identity_at_one():
    assert scale_counts([1.0, 2.4, 2.5, 3.6], 1.0) == [1, 2, 2, 4]
    assert scale_counts([1.0, 2.0], 2419.6) == [2420, 4839]


def test_stats_from_uses_the_full_series():
    s = _series(31)
    stats = stats_from(s, n_agents=500)
    assert stats == {
        "peak_infections": 6, "peak_day": 6, "total_infected": 60, "total_deaths": 3,
        "n_agents": 500, "sim_days": 31,
    }


def test_stats_from_without_deaths_series():
    s = _series(5)
    del s["cum_deaths"]
    assert stats_from(s, 10)["total_deaths"] == 0


def test_scaled_outcome_scales_counts_only():
    s = _series(3)
    stats = stats_from(s, 10)
    scaled_stats, scaled_series = scaled_outcome(stats, s, 100.0)
    assert scaled_stats["peak_infections"] == stats["peak_infections"] * 100
    assert scaled_stats["peak_day"] == stats["peak_day"]
    assert scaled_stats["n_agents"] == 10 and scaled_stats["sim_days"] == 3
    assert scaled_series["day"] == [0, 1, 2]
    assert scaled_series["cum_infections"] == [0, 200, 400]
    assert scaled_outcome(stats, s, 1.0)[0] == stats
