"""SimParamsV2: the nested parameter schema (spec 6, revised by 17 and 18).
Defaults and inclusive bounds come from the registry, so the two cannot
disagree; the validators carry the rules the registry cannot express."""
from __future__ import annotations

import math
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from epichat.schema import Intervention

from .registry import LATENT_MODELS, REGISTRY_BY_PATH, WANING_MODELS

Model = Literal["sir", "seir", "sis", "sirs", "seirs", "seiar"]
Dist = Literal["constant", "lognormal", "gamma"]


def sim_days(sim_dur_years: float) -> int:
    return max(1, int(round(365 * sim_dur_years)))


def _field(path: str, **extra):
    spec = REGISTRY_BY_PATH[path]
    kw: dict = {"default": spec.default}
    if spec.bounds is not None:
        kw["ge"], kw["le"] = spec.bounds
    kw.update(extra)
    return Field(**kw)


def _check_bounds(path: str, value: float | None) -> None:
    if value is None:
        return
    lo, hi = REGISTRY_BY_PATH[path].bounds
    if not lo <= value <= hi:
        unit = REGISTRY_BY_PATH[path].unit or ""
        raise ValueError(f"{path} must be between {lo:g} and {hi:g} {unit}".rstrip())


class Duration(BaseModel):
    mean_days: float = Field(gt=0)
    dist: Dist = "constant"
    sd_days: Optional[float] = Field(default=None, gt=0)

    @model_validator(mode="after")
    def check_sd(self) -> "Duration":
        if self.dist != "constant" and self.sd_days is None:
            raise ValueError(f"sd_days is required when dist is '{self.dist}'")
        if self.sd_days is not None and self.sd_days > 2 * self.mean_days:
            raise ValueError("sd_days must be at most 2 × mean_days")
        return self


class Seed(BaseModel):
    mode: Literal["fraction", "count"] = "fraction"
    value: float = Field(gt=0)
    day: int = _field("disease.seed.day")

    @model_validator(mode="after")
    def check_value(self) -> "Seed":
        if self.mode == "fraction" and not 0 < self.value < 1:
            raise ValueError("value must be between 0 and 1 (exclusive) when mode is 'fraction'")
        if self.mode == "count" and (self.value < 1 or self.value != int(self.value)):
            raise ValueError("value must be an integer count of at least 1 when mode is 'count'")
        return self


AGE_GROUPS = ("children", "adults", "elderly")


class AgeMultipliers(BaseModel):
    """One multiplier per age group (Part 2, section 4.1); 1 leaves the group as it is."""
    children: float = _field("disease.rel_sus_age.children")
    adults: float = _field("disease.rel_sus_age.adults")
    elderly: float = _field("disease.rel_sus_age.elderly")

    def as_tuple(self) -> tuple[float, float, float]:
        return (self.children, self.adults, self.elderly)


class AgeFractions(BaseModel):
    """One optional probability per age group; None means the scalar applies."""
    children: Optional[float] = _field("disease.p_death_age.children")
    adults: Optional[float] = _field("disease.p_death_age.adults")
    elderly: Optional[float] = _field("disease.p_death_age.elderly")

    def any_set(self) -> bool:
        return any(v is not None for v in (self.children, self.adults, self.elderly))


class DiseaseParams(BaseModel):
    model: Model = "sir"
    beta: float = _field("disease.beta")
    dur_exp: Optional[Duration] = None
    dur_inf: Duration = Field(default_factory=lambda: Duration(mean_days=10.0))
    dur_immune: Optional[Duration] = None
    p_death: float = _field("disease.p_death")
    p_asymp: float = _field("disease.p_asymp")
    rel_trans_asymp: float = _field("disease.rel_trans_asymp")
    rel_sus_age: AgeMultipliers = Field(default_factory=AgeMultipliers)
    p_death_age: AgeFractions = Field(default_factory=AgeFractions)
    rel_trans_exposed: float = _field("disease.rel_trans_exposed")
    sis_waning: float = _field("disease.sis_waning")
    sis_imm_boost: float = _field("disease.sis_imm_boost")
    seed: Seed = Field(default_factory=lambda: Seed(value=0.01))
    initial_immune_frac: float = _field("disease.initial_immune_frac")

    def death_probabilities(self) -> tuple[float, float, float]:
        """Each group's case fatality ratio: its own value, or the scalar."""
        a = self.p_death_age
        return tuple(v if v is not None else self.p_death for v in (a.children, a.adults, a.elderly))

    @model_validator(mode="after")
    def check_model_requirements(self) -> "DiseaseParams":
        if self.model in LATENT_MODELS and self.dur_exp is None:
            raise ValueError("disease.dur_exp is required when disease.model is 'seir', 'seirs', or 'seiar'")
        if self.model in WANING_MODELS and self.dur_immune is None:
            raise ValueError("disease.dur_immune is required when disease.model is 'sirs' or 'seirs'")
        for name in ("dur_exp", "dur_inf", "dur_immune"):
            duration = getattr(self, name)
            if duration is not None:
                _check_bounds(f"disease.{name}.mean_days", duration.mean_days)
                _check_bounds(f"disease.{name}.sd_days", duration.sd_days)
        return self


NETWORK_TYPES = ("random", "age_structured", "hybrid")


class ContactMatrix(BaseModel):
    """The nine leaves network.contacts.<source>_<target> (Part 2, 5.3): rows source, columns target, as ss.MixingPools reads them."""
    children_children: float = _field("network.contacts.children_children")
    children_adults: float = _field("network.contacts.children_adults")
    children_elderly: float = _field("network.contacts.children_elderly")
    adults_children: float = _field("network.contacts.adults_children")
    adults_adults: float = _field("network.contacts.adults_adults")
    adults_elderly: float = _field("network.contacts.adults_elderly")
    elderly_children: float = _field("network.contacts.elderly_children")
    elderly_adults: float = _field("network.contacts.elderly_adults")
    elderly_elderly: float = _field("network.contacts.elderly_elderly")

    def as_rows(self) -> list[list[float]]:
        return [[float(getattr(self, f"{s}_{t}")) for t in AGE_GROUPS] for s in AGE_GROUPS]

    @classmethod
    def from_rows(cls, rows) -> "ContactMatrix":
        return cls(**{f"{s}_{t}": float(rows[i][j]) for i, s in enumerate(AGE_GROUPS) for j, t in enumerate(AGE_GROUPS)})


class LayerBeta(BaseModel):
    """Relative transmissibility of each hybrid layer (Part 2, 5.4; Covasim's values)."""
    household: float = _field("network.layer_beta.household")
    school: float = _field("network.layer_beta.school")
    work: float = _field("network.layer_beta.work")
    community: float = _field("network.layer_beta.community")


class NetworkParams(BaseModel):
    network_type: Literal["random", "age_structured", "hybrid"] = "random"
    n_contacts: int = _field("network.n_contacts")
    network_beta: float = _field("network.network_beta")
    contacts_dist: Literal["constant", "poisson"] = "constant"
    contact_duration_days: float = _field("network.contact_duration_days")
    contacts: ContactMatrix = Field(default_factory=ContactMatrix)
    contacts_source: str = "polymod_default"
    household_size: float = _field("network.household_size")
    school_contacts: int = _field("network.school_contacts")
    work_contacts: int = _field("network.work_contacts")
    community_contacts: int = _field("network.community_contacts")
    layer_beta: LayerBeta = Field(default_factory=LayerBeta)
    school_age_min: int = _field("network.school_age_min")
    school_age_max: int = _field("network.school_age_max")
    work_age_min: int = _field("network.work_age_min")
    work_age_max: int = _field("network.work_age_max")

    @model_validator(mode="after")
    def check_age_ranges(self) -> "NetworkParams":
        if self.school_age_min >= self.school_age_max:
            raise ValueError("network.school_age_min must be below network.school_age_max")
        if self.work_age_min >= self.work_age_max:
            raise ValueError("network.work_age_min must be below network.work_age_max")
        return self


class DemographicsParams(BaseModel):
    use_demographics: bool = False
    birth_rate: float = _field("demographics.birth_rate")
    death_rate: float = _field("demographics.death_rate")
    age_pct_under18: Optional[float] = _field("demographics.age_pct_under18")
    age_pct_18_64: Optional[float] = _field("demographics.age_pct_18_64")
    age_pct_over65: Optional[float] = _field("demographics.age_pct_over65")
    country: Optional[str] = None
    auto_demographics: bool = True
    demographics_year: int = _field("demographics.demographics_year")
    demographics_source: Optional[str] = None
    age_source: Literal["default", "shares", "un_wpp"] = "default"

    @model_validator(mode="after")
    def check_age_pcts_sum(self) -> "DemographicsParams":
        pcts = [self.age_pct_under18, self.age_pct_18_64, self.age_pct_over65]
        if all(x is not None for x in pcts):
            total = sum(pcts)
            if abs(total - 100.0) > 1.0:
                raise ValueError(f"age_pct fields must sum to 100 (got {total:.1f})")
        return self

    @field_validator("country")
    @classmethod
    def normalize_country(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip().upper()
        return v if len(v) == 3 and v.isalpha() else None


class Fit(BaseModel):
    """Part 2, 7.7: one outcome the participant knows, reached by moving one lever."""
    target: Literal["attack_rate", "peak_day", "peak_infections"]
    value: float = Field(gt=0.0)
    lever: Literal["disease.beta", "network.network_beta"] = "disease.beta"

    @model_validator(mode="after")
    def check_value(self) -> "Fit":
        if self.target == "attack_rate" and self.value > 1.0:
            raise ValueError("run.fit.value is a fraction for attack_rate")
        if self.target == "peak_day" and self.value < 1:
            raise ValueError("run.fit.value is a day for peak_day")
        return self


class RunParams(BaseModel):
    n_agents: int = _field("run.n_agents")
    sim_dur_years: float = _field("run.sim_dur_years")
    rand_seed: Optional[int] = None
    n_replicates: int = _field("run.n_replicates")
    calibrate_r0: bool = True
    fit: Optional[Fit] = None


class SimParamsV2(BaseModel):
    schema_version: Literal[2] = 2
    disease: DiseaseParams = Field(default_factory=DiseaseParams)
    network: NetworkParams = Field(default_factory=NetworkParams)
    demographics: DemographicsParams = Field(default_factory=DemographicsParams)
    interventions: list[Intervention] = Field(default_factory=list)
    run: RunParams = Field(default_factory=RunParams)

    @model_validator(mode="after")
    def check_cross_fields(self) -> "SimParamsV2":
        seed = self.disease.seed
        if seed.mode == "count" and seed.value > self.run.n_agents:
            raise ValueError(f"disease.seed.value ({seed.value:g}) must not exceed run.n_agents ({self.run.n_agents})")
        days = sim_days(self.run.sim_dur_years)
        if seed.day > days:
            raise ValueError(f"disease.seed.day ({seed.day}) must be within the simulation ({days} days)")
        if self.network.network_beta * (1 - math.exp(-self.disease.beta / 365.0)) > 1.0:
            raise ValueError("network.network_beta × (1 - exp(-disease.beta / 365)) must not exceed 1: lower network.network_beta or disease.beta")
        day0 = [i for i in self.interventions if i.is_day0_immunity()]          # Part 2, 7.1: at full efficacy only
        if day0:
            coverage = min(day0[-1].coverage or 0.0, 0.99)
            if self.disease.initial_immune_frac > 0 and abs(self.disease.initial_immune_frac - coverage) > 1e-9:
                raise ValueError("a vaccine with start_day 0 and disease.initial_immune_frac were both given with different values; set one of them")
            self.disease.initial_immune_frac = coverage
            self.interventions = [i for i in self.interventions if not i.is_day0_immunity()]
        if self.network.network_type != "hybrid":
            for i in self.interventions:
                if i.type == "contact_reduction" and i.layer != "all":
                    raise ValueError(f"interventions[].layer {i.layer} needs the hybrid network; the {self.network.network_type} network has "
                                     "no layers, use all")
        return self
