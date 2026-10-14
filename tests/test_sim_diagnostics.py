"""Spec 10: each rule fires on a constructed series and stays quiet on a normal run; suggested values respect the bounds and the database."""
import json
import math

import pytest

from epichat.params.r0 import approx_r0, calibrate_beta, clamp_beta
from epichat.params.schema_v2 import SimParamsV2
from epichat.sim import diagnostics as dx
from epichat.sim.diagnostics import bounded, db_range, diagnose, final_size, illustrative_sd, realized_seeds

N = 10000
DAYS = 366
GAMMA_10 = {"mean_days": 10, "dist": "gamma", "sd_days": 3}


def params(**over) -> SimParamsV2:
    """Default sir on 10k agents for a year with a gamma 10-day infectious period (R0 about 2.3), plus dotted-path overrides."""
    body = {"disease": {"dur_inf": dict(GAMMA_10)}, "run": {"n_agents": N, "sim_dur_years": 1.0, "rand_seed": 1}}
    for path, value in over.items():
        node = body
        parts = path.split(".")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = value
    return SimParamsV2.model_validate(body)


def curve(peak: float, t_peak: int, width: int, tail: float = 0.0, days: int = DAYS) -> list[float]:
    """A triangular epidemic: up to `peak` at `t_peak`, down over `width` days, then flat at `tail`."""
    out = []
    for t in range(days):
        if t <= t_peak:
            out.append(peak * t / max(t_peak, 1))
        elif t <= t_peak + width:
            out.append(max(tail, peak * (1 - (t - t_peak) / width)))
        else:
            out.append(tail)
    return out


def run(p: SimParamsV2, infectious: list[float], total: float, seeds: int, new: list[float] | None = None, replicates=None, disease=None,
        stats_extra: dict | None = None):
    series = {"day": list(range(len(infectious))), "n_infectious": infectious, "new_infections": new or [0.0] * len(infectious)}
    stats = {"total_infected": total, "n_agents": p.run.n_agents, "seeds": seeds, "seeds_day0": seeds if p.disease.seed.day == 0 else 0,
             **(stats_extra or {})}
    return diagnose(p, series, stats, replicates, seeds, disease)


def ids(found):
    return [d.id for d in found]


def one(found, wanted):
    return next(d for d in found if d.id == wanted)


FADED = [10.0, 4.0, 1.0] + [0.0] * (DAYS - 3)
NORMAL = curve(800, 60, 200)           # ends at 0; 8600 of 10000 infected matches the final size of R0 2.3


def test_early_fadeout_suggests_more_seeds_replicates_and_the_database_r0():
    p = params()
    found = run(p, FADED, total=15, seeds=10)
    assert ids(found) == ["early_fadeout"]
    d = found[0]
    assert d.severity == "warning" and d.evidence["seeds"] == 10 and d.evidence["total_infected"] == 15 and d.evidence["r_eff"] > 1
    assert [lever.patch for lever in d.levers] == [{"disease.seed.mode": "count", "disease.seed.value": 50}, {"run.n_replicates": 5}]
    assert d.levers[0].basis == "rule" and d.levers[0].direction == "increase"
    assert d.levers[0].current == {"disease.seed.mode": "fraction", "disease.seed.value": 0.0005}
    beta = one(run(p, FADED, total=15, seeds=10, disease="measles"), "early_fadeout").levers[2]
    assert beta.basis == "disease_db" and beta.patch == {"disease.beta": clamp_beta(calibrate_beta(p, 15))}
    assert "15" in beta.rationale and "measles" in beta.rationale and beta.current == {"disease.beta": p.disease.beta}
    assert "early_fadeout" not in ids(run(p, NORMAL, total=8600, seeds=100))


def test_early_fadeout_caps_the_seed_suggestion_at_the_agents_and_skips_a_matching_database_r0():
    small = params(**{"run.n_agents": 30})
    d = one(run(small, FADED, total=12, seeds=10), "early_fadeout")
    assert d.levers[0].patch["disease.seed.value"] == 30
    tuned = SimParamsV2.model_validate({**params().model_dump(), "disease": {**params().model_dump()["disease"], "beta": clamp_beta(calibrate_beta(params(), 15))}})
    assert len(one(run(tuned, FADED, total=15, seeds=10, disease="measles"), "early_fadeout").levers) == 2


def test_early_fadeout_names_a_seeding_that_infected_nobody():
    """A fraction seeding is a Bernoulli draw per agent: 0.05% of 10,000 gives nobody in 0.7% of runs (total 0 < 2 × 0 is false)."""
    p = params()
    found = run(p, [0.0] * DAYS, total=0, seeds=0)
    assert "early_fadeout" in ids(found) and "final_size_gap" not in ids(found)
    d = one(found, "early_fadeout")
    assert d.severity == "warning" and d.evidence["seeds"] == 0 and d.evidence["total_infected"] == 0
    assert d.title == "The seeding infected nobody"
    assert d.levers[0].patch == {"disease.seed.mode": "count", "disease.seed.value": 10}
    assert "nobody" in d.levers[0].rationale and "10" in d.levers[0].rationale
    assert d.levers[1].patch == {"run.n_replicates": 5}
    assert one(run(p, FADED, total=15, seeds=10), "early_fadeout").title == "The outbreak died out early"


def test_early_fadeout_also_fires_when_a_few_seeds_die_out_before_one_percent_were_infected():
    """Five seeds that infect sixty and die out are a fade-out (sixty is below 1% of 10,000) though sixty is well above twice the seeds."""
    p = params()
    gone = [5.0, 12.0, 20.0, 15.0, 6.0, 2.0] + [0.0] * (DAYS - 6)
    small = run(p, gone, total=60, seeds=5)
    assert "early_fadeout" in ids(small) and "final_size_gap" not in ids(small)
    assert one(small, "early_fadeout").levers[0].patch == {"disease.seed.mode": "count", "disease.seed.value": 25}
    bigger = run(p, gone, total=150, seeds=5)                          # 1.5% infected before it ended: not a fade-out by this rule
    assert "early_fadeout" not in ids(bigger) and "final_size_gap" in ids(bigger)
    assert dx._faded_out(150, 100, N) and not dx._faded_out(250, 100, N)       # a 1% seeding keeps the old rule, twice its seeds


def test_instant_peak_fires_above_two_percent_seeding_and_not_at_a_one_percent_seeding():
    p = params()
    found = run(p, [300.0, 320.0, 250.0] + curve(200, 20, 60)[3:], total=8600, seeds=300)
    d = one(found, "instant_peak")
    assert d.severity == "warning" and d.evidence == {"peak_day": 1, "seeds": 300, "seed_share": 0.03}
    assert d.levers[0].patch == {"disease.seed.mode": "count", "disease.seed.value": 10} and d.levers[0].direction == "decrease"
    quiet = run(p, [100.0, 110.0, 90.0] + curve(80, 20, 60)[3:], total=8600, seeds=100)
    assert "instant_peak" not in ids(quiet)


def test_unfinished_fires_on_a_tail_or_a_rising_incidence_and_doubles_the_duration():
    p = params()
    d = one(run(p, curve(500, 60, 200, tail=100), total=8600, seeds=100), "unfinished")
    assert d.severity == "warning" and d.evidence == {"last_infectious": 100, "peak": 500, "still_rising": False}
    assert d.levers[0].patch == {"run.sim_dur_years": 2.0} and d.levers[0].current == {"run.sim_dur_years": 1.0} and d.levers[0].direction == "increase"
    sirs = params(**{"disease.model": "sirs", "disease.dur_immune": {"mean_days": 60}})
    rising = one(run(sirs, NORMAL, total=8600, seeds=100, new=[1.0] * 300 + [5.0] * 66), "unfinished")
    assert rising.evidence["still_rising"] is True
    assert "unfinished" not in ids(run(sirs, NORMAL, total=8600, seeds=100, new=[5.0] * 300 + [1.0] * 66))
    at_the_bound = params(**{"run.sim_dur_years": 20.0})
    assert one(run(at_the_bound, curve(500, 60, 200, tail=100), total=8600, seeds=100), "unfinished").levers == []
    assert "unfinished" not in ids(run(p, NORMAL, total=8600, seeds=100))


def test_final_size_gap_fires_on_a_simple_run_whose_attack_rate_misses_the_final_size():
    p = params()
    z = final_size(approx_r0(p))
    assert 0.8 < z < 0.9
    d = one(run(p, NORMAL, total=3000, seeds=100), "final_size_gap")
    assert d.severity == "info" and d.evidence["attack_rate"] == 0.3 and abs(d.evidence["expected_attack_rate"] - z) < 1e-3 and d.levers == []
    recheck = one(run(p, NORMAL, total=3000, seeds=100, disease="measles"), "final_size_gap").levers[0]
    assert recheck.patch == {"disease.beta": clamp_beta(calibrate_beta(p, 15))} and recheck.basis == "disease_db"
    assert "final_size_gap" not in ids(run(p, NORMAL, total=8600, seeds=100))
    assert "final_size_gap" not in ids(run(p, curve(800, 60, 200, tail=100), total=3000, seeds=100))      # unfinished instead
    assert "final_size_gap" not in ids(run(p, FADED, total=15, seeds=10))                                 # early_fadeout instead
    # With initial immunity the attack rate over everyone is s0 × z, z being the share of the susceptibles (section 19):
    # R0 15 with 80% immune gives R_eff 3, z 0.94 and an expected attack rate of 0.19, not 0.94.
    immune = params(**{"disease.beta": clamp_beta(calibrate_beta(p, 15)), "disease.initial_immune_frac": 0.8})
    assert "final_size_gap" not in ids(run(immune, curve(300, 60, 200), total=1900, seeds=100))
    gap = one(run(immune, curve(300, 60, 200), total=5000, seeds=100), "final_size_gap")
    assert gap.evidence["expected_attack_rate"] == pytest.approx(0.188, abs=0.005) and gap.evidence["susceptible_share"] == pytest.approx(0.2)
    age = params(**{"network.network_type": "age_structured"})
    assert "final_size_gap" not in ids(run(age, NORMAL, total=3000, seeds=100))                          # not a simple run


def test_final_size_is_the_fixed_point_and_zero_at_or_below_one():
    assert final_size(0.9) == 0.0 and final_size(1.0) == 0.0
    z = final_size(2.0)
    assert abs(z - (1 - math.exp(-2.0 * z))) < 1e-9 and abs(z - 0.7968) < 1e-3


def test_sharp_curve_fires_only_with_constant_periods_and_suggests_the_illustrative_sd():
    constant = params(**{"disease.dur_inf": {"mean_days": 10}})
    narrow = curve(800, 10, 6)                                   # 9 days at or above half the peak, below 2 × 10
    d = one(run(constant, narrow, total=8600, seeds=100), "sharp_curve")
    assert d.severity == "info" and d.evidence == {"days_at_half_peak": 9, "dur_inf_mean_days": 10}
    assert d.levers[0].patch == {"disease.dur_inf.dist": "gamma", "disease.dur_inf.sd_days": 3.0} and d.levers[0].basis == "rule"
    assert d.levers[0].current == {"disease.dur_inf.dist": "constant", "disease.dur_inf.sd_days": None}
    flu = one(run(constant, narrow, total=8600, seeds=100, disease="influenza"), "sharp_curve")
    assert flu.levers[0].patch["disease.dur_inf.sd_days"] == 0.5 and flu.levers[0].basis == "disease_db"   # 6–8 days: (8 − 6) / 4
    assert "sharp_curve" not in ids(run(params(), narrow, total=8600, seeds=100))                             # gamma already
    assert "sharp_curve" not in ids(run(constant, curve(800, 30, 10), total=8600, seeds=100))                # 21 days at half peak


def test_cfr_out_of_range_needs_a_known_fatal_disease_and_a_model_with_deaths():
    d = one(run(params(**{"disease.p_death": 0.2}), NORMAL, total=8600, seeds=100, disease="measles"), "cfr_out_of_range")
    assert d.severity == "warning" and d.evidence == pytest.approx({"p_death": 0.2, "db_min": 0.005, "db_max": 0.06})
    assert d.levers[0].patch == pytest.approx({"disease.p_death": 0.015}) and d.levers[0].direction == "decrease" and d.levers[0].basis == "disease_db"
    assert "1.5%" in d.levers[0].rationale
    assert "cfr_out_of_range" in ids(run(params(), NORMAL, total=8600, seeds=100, disease="measles"))        # 0 is below 0.5%
    assert "cfr_out_of_range" not in ids(run(params(**{"disease.p_death": 0.01}), NORMAL, total=8600, seeds=100, disease="measles"))
    sis = params(**{"disease.model": "sis"})
    assert "cfr_out_of_range" not in ids(run(sis, curve(800, 60, 200, tail=300), total=8600, seeds=100, disease="measles"))
    assert "cfr_out_of_range" not in ids(run(params(**{"disease.p_death": 0.2}), NORMAL, total=8600, seeds=100, disease="dengue"))   # no range
    assert "cfr_out_of_range" not in ids(run(params(**{"disease.p_death": 0.2}), NORMAL, total=8600, seeds=100))


def test_fatality_on_all_infections_offers_seiar_with_the_database_asymptomatic_share():
    d = one(run(params(**{"disease.p_death": 0.001}), NORMAL, total=8600, seeds=100, disease="influenza"), "fatality_on_all_infections")
    assert d.severity == "info" and d.evidence == {"p_death": 0.001, "db_asymptomatic_fraction": 0.3}
    assert d.levers[0].patch == {"disease.model": "seiar", "disease.p_asymp": 0.3, "disease.dur_exp.mean_days": 2} and d.levers[0].basis == "disease_db"
    assert d.levers[0].current == {"disease.model": "sir", "disease.p_asymp": 0.3, "disease.dur_exp.mean_days": None}
    seir = params(**{"disease.model": "seir", "disease.dur_exp": {"mean_days": 2}, "disease.p_death": 0.001})
    assert one(run(seir, NORMAL, total=8600, seeds=100, disease="influenza"), "fatality_on_all_infections").levers[0].patch == {"disease.model": "seiar", "disease.p_asymp": 0.3}
    assert "fatality_on_all_infections" not in ids(run(params(), NORMAL, total=8600, seeds=100, disease="influenza"))                     # no deaths configured
    assert "fatality_on_all_infections" not in ids(run(params(**{"disease.p_death": 0.01}), NORMAL, total=8600, seeds=100, disease="measles"))   # no asymptomatic share
    seiar = params(**{"disease.model": "seiar", "disease.dur_exp": {"mean_days": 2}, "disease.p_death": 0.001})
    assert "fatality_on_all_infections" not in ids(run(seiar, NORMAL, total=8600, seeds=100, disease="influenza"))


def test_no_reinfection_when_immunity_outlasts_the_run():
    sirs = params(**{"disease.model": "sirs", "disease.dur_immune": {"mean_days": 1825}})
    d = one(run(sirs, NORMAL, total=8600, seeds=100), "no_reinfection")
    assert d.severity == "info" and d.evidence == {"dur_immune_mean_days": 1825, "sim_days": 365}
    assert d.levers[0].patch == {"run.sim_dur_years": 10} and d.levers[0].direction == "increase" and d.levers[0].basis == "rule"
    forever = params(**{"disease.model": "sirs", "disease.dur_immune": {"mean_days": 36500}})
    assert one(run(forever, NORMAL, total=8600, seeds=100), "no_reinfection").levers == []     # 200 years is past the 20-year bound
    short = params(**{"disease.model": "sirs", "disease.dur_immune": {"mean_days": 180}})
    assert "no_reinfection" not in ids(run(short, NORMAL, total=8600, seeds=100))


def test_high_variance_reports_the_spread_and_the_faded_share():
    p = params(**{"run.n_replicates": 3})
    stats = lambda total: {"total_infected": total, "n_agents": N}      # noqa: E731
    rep = {"n": 3, "seeds": [1, 2, 3], "representative": 2, "stats": [stats(50), stats(5000), stats(9000)], "bands": {}}
    d = one(run(p, curve(500, 60, 200), total=8600, seeds=100, replicates=rep), "high_variance")
    assert d.severity == "info" and d.levers == []
    assert d.evidence["median_total_infected"] == 5000 and d.evidence["n_replicates"] == 3 and d.evidence["spread"] > 0.5
    assert d.evidence["faded_out_share"] == pytest.approx(1 / 3, abs=0.01) and d.evidence["p10_total_infected"] < d.evidence["p90_total_infected"]
    tight = {**rep, "stats": [stats(4900), stats(5000), stats(5100)]}
    assert "high_variance" not in ids(run(p, curve(500, 60, 200), total=8600, seeds=100, replicates=tight))
    assert "high_variance" not in ids(run(params(), curve(500, 60, 200), total=8600, seeds=100))


def test_warnings_come_before_infos_and_the_dict_form_is_json_ready():
    found = run(params(**{"disease.p_death": 0.2}), curve(800, 60, 200, tail=100), total=3000, seeds=100, disease="measles")
    assert ids(found) == ["unfinished", "cfr_out_of_range"]            # the gap stands down when the run is unfinished
    mixed = run(params(**{"disease.model": "sirs", "disease.dur_immune": {"mean_days": 1825}, "disease.p_death": 0.2}),
                NORMAL, total=8600, seeds=100, disease="measles")
    assert ids(mixed) == ["cfr_out_of_range", "no_reinfection", "well_mixed"]        # warning first, then the info
    as_json = dx.as_dicts(found)
    assert as_json[0]["levers"][0]["patch"] == {"run.sim_dur_years": 2.0} and as_json[0]["severity"] == "warning"
    json.dumps(as_json)


def test_bounded_clamps_to_the_registry_and_names_the_database_range():
    assert bounded("run.sim_dur_years", 50, None) == (20.0, "")
    value, note = bounded("disease.p_death", 0.5, "measles")
    assert value == pytest.approx(0.06) and "database range" in note
    assert bounded("disease.p_death", 0.02, "measles") == (0.02, "")
    assert bounded("run.n_replicates", 7.4, None) == (5, "")


def test_database_ranges_come_back_in_simulation_units():
    assert db_range("measles", "fatality_rate") == pytest.approx((0.005, 0.06, 0.015))
    assert db_range("influenza", "asymptomatic_fraction") == pytest.approx((0.16, 0.85, 0.3))
    assert db_range("influenza", "immunity_duration") == pytest.approx((1278, 2920, 1825))
    assert db_range("dengue", "fatality_rate") is None and db_range(None, "r0") is None and db_range("not a disease", "r0") is None
    assert illustrative_sd("infectious_days", 8, "measles") == (2.4, "rule")             # 8–8 is not a range
    assert illustrative_sd("infectious_days", 7, "influenza") == (0.5, "disease_db")
    assert illustrative_sd("incubation_days", 1, "measles") == (1.0, "disease_db")      # (21 − 7) / 4 capped at the mean


def test_realized_seeds_prefers_the_stat_and_falls_back_sensibly():
    p = params()
    assert realized_seeds({"seeds": 7, "seeds_day0": 3}, p) == 7
    assert realized_seeds({"seeds_day0": 3}, p) == 3
    assert realized_seeds({}, p) == 5                       # the default fraction 0.0005 of 10,000 agents
    delayed = params(**{"disease.seed": {"mode": "count", "value": 30, "day": 4}})
    assert realized_seeds({"seeds_day0": 0}, delayed) == 30


def test_the_thresholds_are_named_constants():
    for name in ("FADEOUT_SEED_MULTIPLE", "INSTANT_PEAK_DAY", "INSTANT_PEAK_SEED_SHARE", "UNFINISHED_TAIL_SHARE", "UNFINISHED_WINDOW_SHARE",
                 "FINAL_SIZE_GAP", "SHARP_CURVE_WIDTH_MULTIPLE", "FATALITY_ASYMP_SHARE", "HIGH_VARIANCE_SPREAD", "R0_RECHECK_TOLERANCE"):
        assert isinstance(getattr(dx, name), (int, float)), name


def test_a_normal_run_raises_well_mixed_and_the_interventions_to_try():
    from epichat.sim.replicates import run_replicates
    seeded = {"mode": "count", "value": 20}            # the default 0.05% of 2,000 agents is one expected seed: a coin flip, not a normal run
    p = params(**{"run.n_agents": 2000, "disease.seed": seeded})
    out = run_replicates(p)
    assert ids(diagnose(p, out["series"], out["stats"], None, out["stats"]["seeds"], None)) == ["well_mixed", "what_if"]   # nearly everyone was infected, and interventions to try (follow-up spec 7.2)
    immune = params(**{"run.n_agents": 2000, "disease.seed": seeded, "disease.beta": clamp_beta(calibrate_beta(params(), 15)), "disease.initial_immune_frac": 0.8})
    out = run_replicates(immune)
    assert ids(diagnose(immune, out["series"], out["stats"], None, out["stats"]["seeds"], None)) == ["what_if"]   # the fifth still susceptible had their epidemic


def test_cfr_out_of_range_reads_the_population_weighted_fatality():
    # measles range 0.5 to 6%: the scalar 0.1% is out, but 10% of the elderly at 50% with 0.1% elsewhere is 5.09%, in
    p = params(**{"disease.p_death": 0.001, "disease.p_death_age": {"elderly": 0.5},
                  "demographics.age_pct_under18": 40.0, "demographics.age_pct_18_64": 50.0, "demographics.age_pct_over65": 10.0})
    assert "cfr_out_of_range" not in ids(run(p, NORMAL, total=8600, seeds=100, disease="measles"))
    scalar = params(**{"disease.p_death": 0.001})
    d = one(run(scalar, NORMAL, total=8600, seeds=100, disease="measles"), "cfr_out_of_range")
    assert d.evidence["p_death"] == pytest.approx(0.001)
    no_elderly = params(**{"disease.p_death": 0.001, "disease.p_death_age": {"elderly": 0.5}})   # default ages: no elderly
    assert one(run(no_elderly, NORMAL, total=8600, seeds=100, disease="measles"), "cfr_out_of_range").evidence["p_death"] == pytest.approx(0.001)


def test_well_mixed_fires_on_every_network_and_offers_the_two_limits_on_spread():
    # follow-up spec 7.6: every network infects nearly everyone at the same R0, so the diagnostic no longer blames the random one
    d = one(run(params(), NORMAL, total=8600, seeds=100), "well_mixed")             # R0 2.3, attack rate 0.86
    assert d.severity == "info" and d.evidence == {"attack_rate": 0.86, "r_eff": pytest.approx(dx.approx_r0(params()), abs=0.01)}
    assert d.title == "Nearly everyone was infected: only the depletion of susceptibles limits this epidemic"
    variation, response, hybrid = d.levers
    assert variation.patch == {"disease.rel_sus_cv": 1.0} and variation.current == {"disease.rel_sus_cv": 0.0} and variation.basis == "rule"
    assert variation.label == "Add variation between people (CV 1) and rerun" and "illustrative" in variation.rationale and variation.interventions == []
    assert response.patch == {} and response.interventions == [{"type": "behavior_response", "scale": 0.5}]
    assert response.label == "Let people become careful as cases rise and rerun" and "illustrative" in response.rationale
    assert hybrid.patch == {"network.network_type": "hybrid"} and hybrid.basis == "rule" and "same measured R0" in hybrid.rationale
    assert hybrid.label == "Switch to the hybrid network and rerun" and "final size is lower" not in hybrid.rationale
    for lever in d.levers:
        assert len(lever.label) <= dx.LABEL_MAX
    for network in ("hybrid", "age_structured"):
        other = one(run(params(**{"network.network_type": network}), NORMAL, total=8600, seeds=100), "well_mixed")
        assert [l.label for l in other.levers] == [variation.label, response.label]            # the hybrid network is offered on the random one only
    assert "well_mixed" not in ids(run(params(), NORMAL, total=6000, seeds=100))                       # attack rate 0.6
    assert "well_mixed" not in ids(run(params(**{"disease.initial_immune_frac": 0.3}), NORMAL, total=8600, seeds=100))   # R_eff 1.6
    assert "well_mixed" not in ids(run(params(**{"disease.rel_sus_cv": 0.5}), NORMAL, total=8600, seeds=100))            # a limit on spread is already set
    assert "well_mixed" not in ids(run(params(interventions=[{"type": "behavior_response", "scale": 0.2}]), NORMAL, total=8600, seeds=100))


def test_r0_gap_fires_on_a_mismatch_beyond_the_noise_and_stands_down_when_calibrated():
    approx = dx.approx_r0(params())                                                                     # about 2.3
    gap = one(run(params(), NORMAL, total=8600, seeds=500, stats_extra={"r0_measured": 1.2}, disease="measles"), "r0_gap")
    assert gap.severity == "info" and gap.evidence["r0_measured"] == 1.2 and gap.evidence["approx_r0"] == pytest.approx(approx, abs=0.01)
    assert gap.levers and gap.levers[0].patch.keys() == {"disease.beta"}                               # the Part 1 recheck on an exact network
    assert "r0_gap" not in ids(run(params(), NORMAL, total=8600, seeds=500, stats_extra={"r0_measured": approx * 0.9}))
    assert "r0_gap" not in ids(run(params(), NORMAL, total=8600, seeds=500, stats_extra={"r0_measured": None}))
    assert dx.r0_gap_threshold(2.3, 500) == 0.25 and dx.r0_gap_threshold(2.3, 20) == pytest.approx(3 * (2.3 / 20) ** 0.5 / 2.3)
    assert "r0_gap" not in ids(run(params(), NORMAL, total=8600, seeds=20, stats_extra={"r0_measured": 1.6}))       # 30% gap, 20 seeds: noise
    assert "r0_gap" in ids(run(params(), NORMAL, total=8600, seeds=500, stats_extra={"r0_measured": 1.6}))
    # with initial immunity the seeds meet fewer susceptibles: the measured value is compared with R_eff, not R0
    assert "r0_gap" not in ids(run(params(**{"disease.initial_immune_frac": 0.5}), NORMAL, total=4300, seeds=500, stats_extra={"r0_measured": approx * 0.5}))
    calibrated = run(params(**{"network.network_type": "hybrid"}), NORMAL, total=8600, seeds=500,
                     stats_extra={"r0_measured": 1.2, "r0_calibration": {"target": approx, "measured": 1.2, "corrections": 3}})
    assert one(calibrated, "r0_gap").levers == [] and one(calibrated, "r0_gap").evidence["calibrated"] is True
    off = run(params(**{"network.network_type": "hybrid", "run.calibrate_r0": False}), NORMAL, total=8600, seeds=500, stats_extra={"r0_measured": 1.2})
    assert one(off, "r0_gap").levers == []


def test_r0_gap_accounts_for_the_day_zero_seasonal_factor_the_calibration_target_and_a_day_zero_treatment():
    approx = dx.approx_r0(params())
    seasonal = params(**{"interventions": [{"type": "seasonality", "scale": 0.3}]})               # day 0 sits at the peak: transmission × 1.3
    assert "r0_gap" not in ids(run(seasonal, NORMAL, total=8600, seeds=500, stats_extra={"r0_measured": approx * 1.3}))
    assert "r0_gap" in ids(run(seasonal, NORMAL, total=8600, seeds=500, stats_extra={"r0_measured": approx * 0.6}))
    assert one(run(seasonal, NORMAL, total=8600, seeds=500, stats_extra={"r0_measured": approx * 0.6}), "r0_gap").evidence["reference"] == pytest.approx(approx * 1.3, abs=0.01)
    hybrid = params(**{"network.network_type": "hybrid"})
    calibrated = run(hybrid, NORMAL, total=8600, seeds=500,
                     stats_extra={"r0_measured": 2.45, "r0_calibration": {"target": 2.5, "measured": 2.45, "corrections": 1}})
    assert "r0_gap" not in ids(calibrated)                                                           # the reference is the target the user set, not the formula at the corrected beta
    treated = params(**{"interventions": [{"type": "treatment", "coverage": 1.0, "start_day": 0}]})
    assert "r0_gap" not in ids(run(treated, NORMAL, total=8600, seeds=500, stats_extra={"r0_measured": approx * 0.5}))   # treatment cuts the seeds' transmission


def test_fitted_runs_stand_down_the_final_size_and_r0_gaps_and_a_contact_reduction_stands_down_well_mixed():
    fitted = run(params(), NORMAL, total=3000, seeds=100, stats_extra={"fit": {"target": "attack_rate", "wanted": 0.3, "achieved": 0.3, "lever": "disease.beta", "value": 9.0, "runs": 4}, "r0_measured": 1.1})
    assert "final_size_gap" not in ids(fitted) and "r0_gap" not in ids(fitted)
    assert "final_size_gap" in ids(run(params(), NORMAL, total=3000, seeds=100))
    closed = run(params(interventions=[{"type": "contact_reduction", "layer": "all", "scale": 0.5, "start_day": 10, "end_day": 40}]), NORMAL, total=8600, seeds=100)
    assert "well_mixed" not in ids(closed)


def test_final_size_gap_expects_the_size_the_variation_gives():
    # follow-up spec 4.4: a run with variation that infects what its own closed form predicts raises nothing
    varied = params(**{"disease.rel_sus_cv": 1.0})
    expected = final_size(approx_r0(varied), 1.0)
    assert 0.5 < expected < 0.62 and final_size(approx_r0(varied)) > 0.8
    assert "final_size_gap" not in ids(run(varied, NORMAL, total=round(expected * N), seeds=100))
    gap = one(run(params(), NORMAL, total=round(expected * N), seeds=100), "final_size_gap")              # the same total without variation
    assert gap.evidence["expected_attack_rate"] == pytest.approx(final_size(approx_r0(params())), abs=1e-3)
    high = one(run(varied, NORMAL, total=8600, seeds=100), "final_size_gap")                              # and the homogeneous total with it
    assert high.evidence["expected_attack_rate"] == pytest.approx(expected, abs=1e-3)


def test_a_calibrated_runs_r0_is_its_target():
    # its beta was corrected, so the formula on the effective parameters is no longer the R0 the run was set to
    p = params(**{"network.network_type": "hybrid"})
    found = run(p, NORMAL, total=8600, seeds=500, stats_extra={"r0_measured": 1.0, "r0_calibration": {"target": 3.3, "measured": 3.2, "se": 0.1, "corrections": 1, "reached": True}})
    assert one(found, "r0_gap").evidence["approx_r0"] == 3.3


def test_r0_gap_stands_down_while_a_behaviour_response_is_engaged_from_the_start():
    # follow-up spec 5.4: with 500 seeds (5%) the response is already lowering transmission on day 0, so the seeds pass on less
    low = {"r0_measured": 1.2}
    assert "r0_gap" in ids(run(params(), NORMAL, total=8600, seeds=500, stats_extra=low))
    engaged = params(**{"interventions": [{"type": "behavior_response", "scale": 0.5}]})
    assert "r0_gap" not in ids(run(engaged, NORMAL, total=8600, seeds=500, stats_extra=low))
    later = params(**{"interventions": [{"type": "behavior_response", "scale": 0.5, "start_day": 60}]})
    assert "r0_gap" in ids(run(later, NORMAL, total=8600, seeds=500, stats_extra=low))               # the seeds had finished before it began


def test_r0_gap_treats_a_calibrated_run_like_any_other():
    # review of the follow-up's phase A: the calibration's target was returned before the stand-downs, the day-0 seasonal factor and
    # the initial immunity, although the pilot measures without any of them and the live measurement with all of them
    calibration = {"r0_calibration": {"target": 2.5, "measured": 2.48, "se": 0.08, "corrections": 1, "reached": True}}

    def hybrid(**over):
        return params(**{"network.network_type": "hybrid", **over})

    def gap(p, measured):
        return "r0_gap" in ids(run(p, NORMAL, total=8600, seeds=500, stats_extra={"r0_measured": measured, **calibration}))

    assert gap(hybrid(), 1.7) and not gap(hybrid(), 2.4)
    assert not gap(hybrid(interventions=[{"type": "behavior_response", "scale": 0.5}]), 1.7)            # the response was engaged from day 0
    assert not gap(hybrid(interventions=[{"type": "treatment", "coverage": 1.0, "start_day": 0}]), 1.25)
    seasonal = hybrid(interventions=[{"type": "seasonality", "scale": 0.3}])
    assert not gap(seasonal, 3.2) and gap(seasonal, 2.3)                                                 # the seeds transmit at 1.3 times the target
    immune = hybrid(**{"disease.initial_immune_frac": 0.3})
    assert not gap(immune, 1.75) and gap(immune, 2.5)                                                    # the live measurement reads R_eff


def test_r0_gap_stands_down_for_as_long_as_the_seeds_transmit_in_a_latent_model():
    # a seed of a latent model is exposed first, so it transmits until about the latent plus the infectious period
    latent = {"disease.model": "seir", "disease.dur_exp": {"mean_days": 6.0, "dist": "gamma", "sd_days": 2.0}}
    low = {"r0_measured": 1.2}
    during = params(**latent, interventions=[{"type": "behavior_response", "scale": 0.5, "start_day": 13}])
    assert "r0_gap" not in ids(run(during, NORMAL, total=8600, seeds=500, stats_extra=low))
    after = params(**latent, interventions=[{"type": "behavior_response", "scale": 0.5, "start_day": 40}])
    assert "r0_gap" in ids(run(after, NORMAL, total=8600, seeds=500, stats_extra=low))


def test_a_lever_may_carry_entries_and_a_label_and_serializes_as_before_without_them():
    # follow-up spec 7.1: a suggestion is a lever, so it travels where levers travel
    plain = dx.Lever({"disease.beta": 9.0}, {"disease.beta": 22.8}, "decrease", "why", "rule")
    assert plain.interventions == [] and plain.label is None
    carrying = dx.Lever({}, {}, "change", "why", "rule", interventions=[{"type": "behavior_response", "scale": 0.5}], label="Let people become careful and rerun")
    out = dx.as_dicts([dx.Diagnostic("x", "info", "t", {}, [plain, carrying])])[0]["levers"]
    assert out[0] == {"patch": {"disease.beta": 9.0}, "current": {"disease.beta": 22.8}, "direction": "decrease", "rationale": "why", "basis": "rule"}
    assert out[1]["interventions"] == [{"type": "behavior_response", "scale": 0.5}] and out[1]["label"] == "Let people become careful and rerun"
    json.dumps(out)


def test_r0_gap_stands_down_while_a_dated_reduction_covers_the_seeds():
    # review of phase B: what_if's windows start the day 1% were infected, day 0 with 500 seeds, so the seeds pass on less
    low = {"r0_measured": 1.5}
    assert "r0_gap" in ids(run(params(), NORMAL, total=8600, seeds=500, stats_extra=low))
    for entry in ({"type": "contact_reduction", "layer": "all", "scale": 0.3, "start_day": 0, "end_day": 56},
                  {"type": "transmission_reduction", "scale": 0.2, "start_day": 1, "end_day": 91}):
        assert "r0_gap" not in ids(run(params(interventions=[entry]), NORMAL, total=8600, seeds=500, stats_extra=low)), entry
    later = params(interventions=[{"type": "transmission_reduction", "scale": 0.2, "start_day": 60, "end_day": 150}])
    assert "r0_gap" in ids(run(later, NORMAL, total=8600, seeds=500, stats_extra=low))               # the seeds had finished before it began


def test_well_mixed_stands_down_on_a_fitted_run():
    # review of phase B: on a run fitted to a known outcome the size is what the user said it was, and a lever would be fitted away
    fitted = {"fit": {"target": "attack_rate", "wanted": 0.86, "achieved": 0.86, "lever": "disease.beta", "value": 22.0, "runs": 3}}
    assert "well_mixed" in ids(run(params(), NORMAL, total=8600, seeds=100))
    assert "well_mixed" not in ids(run(params(), NORMAL, total=8600, seeds=100, stats_extra=fitted))
