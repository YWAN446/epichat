"""Parameter sets that exercise every branch of the six templates. Shared by
the fixture-capture script and the template tests so both render the same
thing."""
from epichat.schema import SimParams

OUTPUT_PATH = "results/sim_fixture.png"


def _common(vaccine_start: int) -> dict:
    return dict(
        beta=0.05, n_agents=2000, sim_dur_years=0.5, rand_seed=7, n_contacts=6,
        interventions=[
            {"type": "vaccine", "coverage": 0.3, "start_day": vaccine_start},
            {"type": "treatment", "coverage": 0.5, "capacity": 20, "start_day": 3},
            {"type": "seasonality", "scale": 0.2, "shift": 0.1},
        ],
    )


def cases() -> dict[str, SimParams]:
    return {
        "sir": SimParams(disease_type="sir", **_common(0)),
        "seir": SimParams(disease_type="seir", dur_exp=4.0, **_common(10)),
        "sis": SimParams(disease_type="sis", **_common(10)),
        "sirs": SimParams(disease_type="sirs", dur_immune=90.0, **_common(0)),
        "seirs": SimParams(disease_type="seirs", dur_exp=4.0, dur_immune=90.0, **_common(10)),
        "seiar": SimParams(
            disease_type="seiar", dur_exp=4.0, p_asymp=0.4, rel_trans_asymp=0.5,
            network_type="age_structured", age_pct_under18=30.0, age_pct_18_64=60.0, age_pct_over65=10.0,
            use_demographics=True, birth_rate=25.0, death_rate=8.0, **_common(10),
        ),
    }
