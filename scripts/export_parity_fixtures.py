"""Export the parity fixture the TypeScript tests pin themselves to: the exact
R0 math on a few hundred seeded v2 parameter sets, the v1 migration on a fixed
set of v1 rows, literature warnings on seeded arguments, and the three
adapters' row mapping on recorded responses.

    py -3.12 scripts/export_parity_fixtures.py   # writes web/tests/fixtures/
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from epichat.adapters.un_wpp import UNWPPAdapter  # noqa: E402
from epichat.adapters.wb_data360 import WorldBankData360Adapter  # noqa: E402
from epichat.adapters.who_gho import WHOGHOAdapter  # noqa: E402
from epichat.disease_db import check_params, load_db  # noqa: E402
from epichat.params import r0  # noqa: E402
from epichat.params.migrate import coerce_params  # noqa: E402
from epichat.params.schema_v2 import SimParamsV2  # noqa: E402
from epichat.resolver import DataQuery, ResolvedField  # noqa: E402

sys.path.insert(0, str(ROOT / "tests"))
from template_cases import cases as template_cases  # noqa: E402

SEED = 20261008
TYPES = ["sir", "seir", "sis", "sirs", "seirs", "seiar"]

UN_HEADER = ("LocationId|Location|Iso3|Iso2|LocationTypeId|IndicatorId|Indicator|IndicatorDisplayName|SourceId|Source|"
             "Revision|VariantId|Variant|VariantShortName|VariantLabel|TimeId|TimeLabel|TimeMid|CategoryId|Category|"
             "EstimateTypeId|EstimateType|EstimateMethodId|EstimateMethod|SexId|Sex|AgeId|AgeLabel|AgeStart|AgeEnd|AgeMid|Value")


def un_row(ind, time_id, year, method, age_id, age_label, value, variant="4", sex="3"):
    return (f"840|United States of America|USA|US|4|{ind}|x|x|27|World Population Prospects|0|{variant}|Median|Median|Median|"
            f"{time_id}|{year}|{year}.5|0|Not applicable|1|Model-based Estimates|{method}|m|{sex}|Both sexes|{age_id}|{age_label}|0|-1|0|{value}")


ADAPTER_FILES = {
    "un_wpp_birth_death.csv": "sep =|\n" + UN_HEADER + "\n" + "\n".join([
        un_row(55, 73, 2022, 2, 188, "Total", "10.981"),
        un_row(55, 74, 2023, 2, 188, "Total", "10.648"),
        un_row(59, 74, 2023, 2, 188, "Total", "8.663"),
    ]) + "\n",
    "un_wpp_age.csv": "sep =|\n" + UN_HEADER + "\n" + "\n".join([
        un_row(71, 74, 2023, 2, 188, "Total", "100"),
        un_row(71, 74, 2023, 2, 901, "0-17", "21.577"),
        un_row(71, 74, 2023, 2, 902, "65+", "17.432"),
    ]) + "\n",
    "un_wpp_population.csv": "sep =|\n" + UN_HEADER + "\n" + "\n".join([
        un_row(49, 73, 2022, 3, 188, "Total", "333287558"),
        un_row(49, 74, 2023, 3, 188, "Total", "334914895"),
    ]) + "\n",
    "un_wpp_combined.csv": "sep =|\r\n" + UN_HEADER + "\r\n" + "\r\n".join([
        un_row(55, 74, 2023, 2, 188, "Total", "10.648"),
        un_row(59, 74, 2023, 2, 188, "Total", "8.663"),
        un_row(59, 74, 2023, 2, 188, "Total", "99", variant="2"),
        un_row(71, 74, 2023, 2, 901, "0-17", "21.577"),
        un_row(71, 74, 2023, 2, 902, "65+", "17.432"),
        un_row(49, 74, 2023, 2, 188, "Total", "334914.895"),
    ]) + "\r\n",
    "un_wpp_rates_only.csv": "sep =|\n" + UN_HEADER + "\n" + "\n".join([
        un_row(55, 74, 2023, 2, 188, "Total", "27.342"),
        un_row(59, 74, 2023, 2, 188, "Total", "7.212"),
    ]) + "\n",
    "who_gho_coverage.json": json.dumps({"value": [
        {"SpatialDimValueCode": "KEN", "TimeDimensionValue": "2021", "NumericValue": 72.0},
        {"SpatialDimValueCode": "KEN", "TimeDimensionValue": "2022", "NumericValue": 76.0},
        {"SpatialDimValueCode": "KEN", "TimeDimensionValue": "2023", "NumericValue": None},
    ]}, indent=1) + "\n",
    "who_gho_mcv2.json": json.dumps({"value": [
        {"SpatialDimValueCode": "KEN", "TimeDimensionValue": "2022", "NumericValue": 61.0},
    ]}, indent=1) + "\n",
    "who_gho_empty.json": json.dumps({"value": []}, indent=1) + "\n",
    "wb_beds.json": json.dumps({"count": 2, "value": [
        {"OBS_VALUE": "2.3", "TIME_PERIOD": "2021", "REF_AREA": "KEN"},
        {"OBS_VALUE": "2.1", "TIME_PERIOD": "2020", "REF_AREA": "KEN"},
    ]}, indent=1) + "\n",
    "wb_physicians.json": json.dumps({"count": 1, "value": [{"OBS_VALUE": "0.2", "TIME_PERIOD": "2021", "REF_AREA": "KEN"}]}, indent=1) + "\n",
    "wb_nurses.json": json.dumps({"count": 1, "value": [{"OBS_VALUE": "1.1", "TIME_PERIOD": "2021", "REF_AREA": "KEN"}]}, indent=1) + "\n",
    "wb_uhc.json": json.dumps({"count": 1, "value": [{"OBS_VALUE": "56.0", "TIME_PERIOD": "2022", "REF_AREA": "KEN"}]}, indent=1) + "\n",
    "wb_null.json": json.dumps({"count": 1, "value": [{"OBS_VALUE": "null", "TIME_PERIOD": "2022", "REF_AREA": "KEN"}]}, indent=1) + "\n",
}

HEALTH_CODES = ["WB_WDI_SH_MED_BEDS_ZS", "WB_WDI_SH_MED_PHYS_ZS", "WB_WDI_SH_MED_NUMW_P3", "WB_WDI_SH_UHC_SRVS_CV_XD"]


def field_json(f: ResolvedField) -> dict:
    return {"field": f.field, "value": f.value, "citation": f.citation, "description": f.description,
            "alternatives": [field_json(a) for a in f.alternatives]}


LATENT = ("seir", "seirs", "seiar")
WANING = ("sirs", "seirs")


def random_duration(rng: random.Random, mean: float) -> dict:
    dist = rng.choice(["constant", "constant", "gamma", "lognormal"])
    sd = None if dist == "constant" else round(mean * rng.uniform(0.1, 0.6), 2)
    return {"mean_days": mean, "dist": dist, "sd_days": sd}


def random_params(rng: random.Random) -> SimParamsV2 | None:
    model = rng.choice(TYPES)
    network_type = rng.choice(["random", "age_structured"])
    disease = {
        "model": model,
        "beta": round(rng.uniform(0.05, 300.0), 4),
        "dur_inf": random_duration(rng, round(rng.uniform(1.0, 30.0), 2)),
        "p_death": round(rng.choice([0.0, 0.001, 0.01, 0.1]), 3),
    }
    if model in LATENT:
        disease["dur_exp"] = random_duration(rng, round(rng.uniform(1.0, 21.0), 2))
    if model in WANING:
        disease["dur_immune"] = random_duration(rng, round(rng.uniform(30.0, 2000.0), 1))
    if model == "seiar":
        disease["p_asymp"] = round(rng.uniform(0.0, 1.0), 2)
        disease["rel_trans_asymp"] = round(rng.uniform(0.0, 1.0), 2)
    network = {"network_type": network_type, "n_contacts": rng.randint(1, 30), "network_beta": rng.choice([1.0, 0.5, 2.0])}
    demographics = {}
    if network_type == "age_structured" and rng.random() < 0.7:
        under = round(rng.uniform(10.0, 45.0), 1)
        over = round(rng.uniform(2.0, 20.0), 1)
        demographics = {"age_pct_under18": under, "age_pct_over65": over, "age_pct_18_64": round(100.0 - under - over, 1)}
    run = {"n_agents": rng.choice([1000, 5000, 10000, 50000])}
    try:
        return SimParamsV2.model_validate({"schema_version": 2, "disease": disease, "network": network, "demographics": demographics, "run": run})
    except Exception:
        return None


def _calibrate(p: SimParamsV2, target: float):
    try:
        return r0.clamp_beta(r0.calibrate_beta(p, target))
    except r0.R0Unreachable:
        return None


def params_cases(rng: random.Random) -> list[dict]:
    cases = []
    while len(cases) < 240:
        p = random_params(rng)
        if p is None:
            continue
        # approx_r0 on the age-structured network uses numpy's eigvals, whose last bits differ between
        # BLAS builds; nine decimals is far below the TypeScript test's 1e-6 tolerance.
        approx = round(r0.approx_r0(p), 9)
        recalibrate = []
        switched = p.model_dump()
        if p.network.network_type == "random":
            switched["network"]["network_type"] = "age_structured"
            switched["demographics"].update({"age_pct_under18": 38.6, "age_pct_18_64": 57.6, "age_pct_over65": 3.8})
        else:
            switched["network"]["network_type"] = "random"
        raised = p.model_dump()
        raised["disease"]["beta"] = round(p.disease.beta * 1.7, 4)
        for after_input in (switched, raised):
            try:
                after = SimParamsV2.model_validate(after_input)
            except Exception:
                continue
            rec = r0.recalibrate_beta(after, approx, p)
            recalibrate.append({"r0_before": approx, "before": p.model_dump(mode="json"), "after_input": after.model_dump(mode="json"), "beta": rec.disease.beta})
        cases.append({
            "input": p.model_dump(mode="json"), "approx_r0": approx, "max_r0": round(r0.max_r0(p), 9),
            "calibrate": [{"target_r0": t, "beta": _calibrate(p, t)} for t in (1.5, 3.0, 15.0)],
            "recalibrate": recalibrate,
        })
    return cases


MIGRATION_INPUTS: list[dict] = [
    {"beta": 22.8125},
    {"disease_type": "sir", "beta": 10.0, "dur_inf": 7, "init_prev": 0.02, "n_agents": 5000, "sim_dur_years": 0.5, "rand_seed": 3,
     "p_death": 0.01, "n_contacts": 6, "network_beta": 0.5},
    {"disease_type": "seir", "beta": 171.09375, "dur_exp": 11, "dur_inf": 8, "country": "KEN", "network_type": "age_structured",
     "age_pct_under18": 38.6, "age_pct_18_64": 57.6, "age_pct_over65": 3.8, "use_demographics": True, "birth_rate": 28.1,
     "death_rate": 7.9, "demographics_source": "UN WPP 2024"},
    {"disease_type": "sis", "beta": 5.0, "interventions": [{"type": "vaccine", "coverage": 0.4, "start_day": 0}]},
    {"disease_type": "sirs", "beta": 5.0, "dur_immune": 180,
     "interventions": [{"type": "vaccination", "coverage": 1.0}, {"type": "treatment", "coverage": 0.5, "capacity": 20.4, "start_day": 3}]},
    {"disease_type": "seirs", "beta": 5.0, "dur_exp": 4, "dur_immune": 90,
     "interventions": [{"type": "vaccine", "coverage": 0.6, "start_day": 60}, {"type": "seasonal", "scale": 0.3, "shift": 0.1}]},
    {"disease_type": "seiar", "beta": 5.0, "dur_exp": 4, "p_asymp": 0.4, "rel_trans_asymp": 0.3,
     "interventions": [{"type": "vaccine", "coverage": 0.2, "start_day": 0}, {"type": "vaccine", "coverage": 0.7, "start_day": 30}]},
]


def migration_cases() -> list[dict]:
    inputs = MIGRATION_INPUTS + [case.model_dump() for case in template_cases().values()]
    return [{"input": v1, "expected": coerce_params(v1).model_dump(mode="json")} for v1 in inputs]


def warning_cases(rng: random.Random) -> list[dict]:
    cases = []
    for disease in load_db()["diseases"]:
        for _ in range(25):
            args = {
                "r0": rng.choice([0.5, 1.3, 3.0, 15.0, 100.0]),
                "dur_inf": rng.choice([1.0, 5.0, 8.0, 12.125, 30.0]),
                "dur_exp": rng.choice([None, 2.0, 11.0, 20.0]),
                "p_death": rng.choice([None, 0.001, 0.05, 0.5]),
                "n_contacts": rng.choice([None, 4, 6, 40]),
                "dur_immune": rng.choice([None, 10.0, 400.0, 36525.0]),
                "p_asymp": rng.choice([None, 0.1, 0.3, 0.99]),
            }
            warnings = check_params(disease, args["r0"], args["dur_inf"], args["dur_exp"], p_death=args["p_death"],
                                    n_contacts=args["n_contacts"], dur_immune=args["dur_immune"], p_asymp=args["p_asymp"])
            cases.append({"disease": disease, **args, "warnings": warnings})
    return cases


def adapter_cases() -> dict:
    un = []
    with patch("epichat.adapters.un_wpp._fetch_text", return_value="sep =|\nId|Name|Iso3|Iso2\n840|United States of America|USA|US\n"):
        adapter = UNWPPAdapter(api_key=None)
    for name in ("un_wpp_birth_death.csv", "un_wpp_age.csv", "un_wpp_population.csv", "un_wpp_combined.csv", "un_wpp_rates_only.csv"):
        with patch("epichat.adapters.un_wpp._fetch_text", return_value=ADAPTER_FILES[name]):
            fields = adapter.fetch(DataQuery(source="un_wpp", indicators=[55, 59, 71, 49], location_id=840))
        un.append({"file": name, "location_id": 840, "fields": [field_json(f) for f in fields]})

    who = []
    for codes, files in (
        (["WHS8_110", "MCV2"], {"WHS8_110": "who_gho_coverage.json", "MCV2": "who_gho_mcv2.json"}),
        (["WHS8_110", "MCV2"], {"WHS8_110": "who_gho_coverage.json", "MCV2": "who_gho_empty.json"}),
        (["WHS3_41"], {"WHS3_41": "who_gho_empty.json"}),
    ):
        def who_fetch(url, files=files):
            for code, file in files.items():
                if f"/{code}?" in url:
                    return ADAPTER_FILES[file]
            raise AssertionError(url)
        with patch("epichat.adapters.who_gho._fetch_text", side_effect=who_fetch):
            fields = WHOGHOAdapter().fetch(DataQuery(source="who_gho", indicator_codes=codes, location_code="KEN"))
        who.append({"codes": codes, "files": files, "iso3": "KEN", "fields": [field_json(f) for f in fields]})

    wb = []
    for files in (
        {"WB_WDI_SH_MED_BEDS_ZS": "wb_beds.json", "WB_WDI_SH_MED_PHYS_ZS": "wb_physicians.json",
         "WB_WDI_SH_MED_NUMW_P3": "wb_nurses.json", "WB_WDI_SH_UHC_SRVS_CV_XD": "wb_uhc.json"},
        {"WB_WDI_SH_MED_BEDS_ZS": "wb_null.json", "WB_WDI_SH_MED_PHYS_ZS": "wb_physicians.json",
         "WB_WDI_SH_MED_NUMW_P3": "wb_nurses.json", "WB_WDI_SH_UHC_SRVS_CV_XD": "wb_uhc.json"},
        {"WB_WDI_SH_MED_BEDS_ZS": "wb_null.json", "WB_WDI_SH_MED_PHYS_ZS": "wb_null.json",
         "WB_WDI_SH_MED_NUMW_P3": "wb_null.json", "WB_WDI_SH_UHC_SRVS_CV_XD": "wb_null.json"},
    ):
        def wb_fetch(url, files=files):
            for code, file in files.items():
                if f"INDICATOR={code}&" in url:
                    return ADAPTER_FILES[file]
            raise AssertionError(url)
        with patch("epichat.adapters.wb_data360._fetch_text", side_effect=wb_fetch):
            fields = WorldBankData360Adapter().fetch(DataQuery(source="wb_data360", indicator_codes=HEALTH_CODES, location_code="KEN"))
        wb.append({"codes": HEALTH_CODES, "files": files, "iso3": "KEN", "fields": [field_json(f) for f in fields]})
    return {"un_wpp": un, "who_gho": who, "wb_data360": wb}


def main(web_dir: Path = ROOT / "web") -> None:
    rng = random.Random(SEED)
    fixtures = web_dir / "tests" / "fixtures"
    (fixtures / "adapters").mkdir(parents=True, exist_ok=True)
    for name, text in ADAPTER_FILES.items():
        (fixtures / "adapters" / name).write_text(text, encoding="utf-8", newline="")
    payload = {"version": 2, "params": params_cases(rng), "migration": migration_cases(), "warnings": warning_cases(rng), "adapters": adapter_cases()}
    (fixtures / "parity.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
    print("wrote web/tests/fixtures/parity.json and web/tests/fixtures/adapters/")
