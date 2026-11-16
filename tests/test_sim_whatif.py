"""Follow-up spec 7.2: after a run that had an epidemic, interventions to try, as levers that carry entries and a ready reply."""
import pytest

from epichat.params.schema_v2 import SimParamsV2
from epichat.sim import diagnostics as dx
from epichat.sim.diagnostics import diagnose

N = 10000
DAYS = 366


def params(**over) -> SimParamsV2:
    body = {"disease": {"dur_inf": {"mean_days": 10, "dist": "gamma", "sd_days": 3}, "seed": {"mode": "count", "value": 10}},
            "run": {"n_agents": N, "sim_dur_years": 1.0, "rand_seed": 1}}
    for path, value in over.items():
        node = body
        parts = path.split(".")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = value
    return SimParamsV2.model_validate(body)


def epidemic(total: float = 8600, first: int = 10, anchor: int = 20):
    """New infections: the seeds on day 0, then 1% of the agents reached on `anchor`, the rest spread over the 100 days after."""
    new = [0.0] * DAYS
    new[0] = first
    new[anchor] += 0.01 * N - first
    rest = (total - 0.01 * N) / 100
    for t in range(anchor + 1, anchor + 101):
        new[t] = rest
    infectious = [min(800.0, 20.0 * t) if t < 150 else 0.0 for t in range(DAYS)]
    return infectious, new


def what_if(p: SimParamsV2, total: float = 8600, anchor: int = 20, disease: str | None = None, seeds: int = 10):
    infectious, new = epidemic(total, seeds, anchor)
    series = {"day": list(range(DAYS)), "n_infectious": infectious, "new_infections": new}
    stats = {"total_infected": total, "n_agents": N, "seeds": seeds, "seeds_day0": seeds}
    found = diagnose(p, series, stats, None, seeds, disease)
    return next((d for d in found if d.id == "what_if"), None), found


def entries(d):
    return [lever.interventions[0] for lever in d.levers]


def test_the_candidates_on_the_random_network_are_distancing_masks_and_the_response():
    d, found = what_if(params())
    assert d.severity == "info" and d.title == "Interventions to try" and d.evidence == {"anchor_day": 20, "attack_rate": 0.86}
    assert found[-1].id == "what_if"                                                       # after every other diagnostic
    assert entries(d) == [
        {"type": "contact_reduction", "layer": "all", "scale": 0.3, "start_day": 20, "end_day": 76},
        {"type": "transmission_reduction", "scale": 0.2, "start_day": 20, "end_day": 110},
        {"type": "behavior_response", "scale": 0.5},
    ]
    assert [lever.label for lever in d.levers] == [
        "Cut contacts by 30% from day 20 for eight weeks and rerun",
        "Add masks (20% less transmission) from day 20 for 90 days and rerun",
        "Let people become careful as cases rise and rerun",
    ]
    for lever in d.levers:
        assert lever.patch == {} and lever.current == {} and lever.direction == "change" and lever.basis == "rule"
        assert "illustrative" in lever.rationale and len(lever.label) <= dx.LABEL_MAX and len(lever.interventions) == 1


def test_the_hybrid_network_adds_a_school_closure_and_a_disease_with_an_indicator_adds_a_campaign():
    hybrid = params(**{"network.network_type": "hybrid"})
    d, _ = what_if(hybrid, disease="measles")
    assert [e["type"] for e in entries(d)] == ["vaccine", "contact_reduction", "contact_reduction", "transmission_reduction"]   # four at most: the response is left out
    assert entries(d)[0] == {"type": "vaccine", "kind": "campaign", "coverage": 0.7, "efficacy": 0.9, "start_day": 20, "end_day": 50}
    assert entries(d)[1] == {"type": "contact_reduction", "layer": "school", "scale": 1.0, "start_day": 20, "end_day": 62}
    assert entries(d)[2] == {"type": "contact_reduction", "layer": "community", "scale": 0.3, "start_day": 20, "end_day": 76}
    assert d.levers[0].label == "Vaccinate 70% in a campaign from day 20 to day 50 and rerun"
    assert d.levers[1].label == "Close schools from day 20 for six weeks and rerun"
    assert d.levers[2].label == "Cut community contacts by 30% from day 20 for eight weeks and rerun"
    assert len(d.levers) == dx.WHAT_IF_MAX_LEVERS and all(len(lever.label) <= dx.LABEL_MAX for lever in d.levers)
    no_indicator, _ = what_if(hybrid, disease="covid19")
    assert [e["type"] for e in entries(no_indicator)] == ["contact_reduction", "contact_reduction", "transmission_reduction", "behavior_response"]
    no_children = params(**{"network.network_type": "hybrid", "demographics.age_pct_under18": 0.0, "demographics.age_pct_18_64": 90.0, "demographics.age_pct_over65": 10.0})
    assert [e.get("layer") for e in entries(what_if(no_children)[0])][:1] == ["community"]


def test_nothing_the_scenario_already_has_is_offered():
    has = params(**{"network.network_type": "hybrid", "interventions": [
        {"type": "vaccine", "coverage": 0.5, "start_day": 30}, {"type": "contact_reduction", "layer": "school", "scale": 1.0, "start_day": 5, "end_day": 30},
        {"type": "transmission_reduction", "scale": 0.1, "start_day": 0, "end_day": 10}, {"type": "behavior_response", "scale": 0.3}]})
    d, _ = what_if(has, disease="measles")
    assert entries(d) == [{"type": "contact_reduction", "layer": "community", "scale": 0.3, "start_day": 20, "end_day": 76}]
    everything = params(**{"interventions": [{"type": "contact_reduction", "layer": "all", "scale": 0.2, "start_day": 0, "end_day": 10},
                                             {"type": "transmission_reduction", "scale": 0.1, "start_day": 0, "end_day": 10}, {"type": "behavior_response", "scale": 0.3}]})
    assert what_if(everything)[0] is None                                                   # nothing left to offer


def test_it_waits_for_an_epidemic():
    assert what_if(params(), total=400)[0] is None                                          # an attack rate under 5%
    faded = diagnose(params(), {"day": list(range(DAYS)), "n_infectious": [10.0, 4.0, 1.0] + [0.0] * (DAYS - 3), "new_infections": [10.0, 5.0] + [0.0] * (DAYS - 2)},
                     {"total_infected": 15, "n_agents": N, "seeds": 10, "seeds_day0": 10}, None, 10, None)
    assert [d.id for d in faded] == ["early_fadeout"]
    assert what_if(params(), total=600)[0] is not None


def test_the_anchor_is_the_day_one_percent_were_infected_and_a_one_percent_seeding_is_day_zero():
    assert what_if(params(), anchor=45)[0].evidence["anchor_day"] == 45
    seeded = what_if(params(**{"disease.seed": {"mode": "fraction", "value": 0.01}}), anchor=0, seeds=100)[0]
    assert seeded.evidence["anchor_day"] == 0 and entries(seeded)[0]["start_day"] == 0 and entries(seeded)[0]["end_day"] == 56
    assert seeded.levers[0].label == "Cut contacts by 30% from day 0 for eight weeks and rerun"
    cumulative = {"day": [0, 1, 2], "n_infectious": [1.0, 2.0, 3.0], "new_infections": [0.0, 0.0, 0.0], "cum_infections": [50.0, 120.0, 300.0]}
    run = dx._Run(params(), cumulative, {"total_infected": 300, "n_agents": N}, None, 50, None)
    assert dx.anchor_day(run) == 1                                                          # the series' own cumulative count when it is there
    assert dx.anchor_day(dx._Run(params(), {"n_infectious": [1.0], "new_infections": [0.0]}, {"total_infected": 0}, None, 1, None)) is None


def test_a_window_never_passes_the_end_of_the_run():
    short = params(**{"run.sim_dur_years": 60 / 365})
    infectious, new = epidemic(8600, 10, 20)
    series = {"day": list(range(61)), "n_infectious": infectious[:61], "new_infections": new[:61]}
    d = next(x for x in diagnose(short, series, {"total_infected": 4000, "n_agents": N, "seeds": 10, "seeds_day0": 10}, None, 10, None) if x.id == "what_if")
    assert entries(d)[0]["end_day"] == 60 and entries(d)[1]["end_day"] == 60


@pytest.mark.parametrize("network,disease", [("random", None), ("hybrid", "measles"), ("age_structured", "pertussis")])
def test_every_entry_is_one_the_schema_accepts(network, disease):
    p = params(**{"network.network_type": network})
    d, _ = what_if(p, disease=disease)
    assert d.levers
    for lever in d.levers:
        body = p.model_dump()
        body["interventions"] = lever.interventions
        SimParamsV2.model_validate(body)                                                    # the validator the tool applies
