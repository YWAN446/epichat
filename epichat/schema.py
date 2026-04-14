from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class Intervention(BaseModel):
    type: Literal["vaccine", "treatment", "seasonality"]
    # vaccine / treatment
    coverage: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    start_day: int = Field(default=0, ge=0)
    # treatment
    capacity: Optional[int] = Field(default=None, ge=1)
    # seasonality
    scale: float = Field(default=0.2, ge=0.0, le=1.0)  # strength (0.2 → ±20%)
    shift: float = Field(default=0.0, ge=0.0, le=1.0)  # phase offset (0.5 → 6-month lag)


class SimParams(BaseModel):
    disease_type: Literal["sir", "seir", "sis"] = "sir"
    n_agents: int = Field(default=10000, ge=10, le=1_000_000)
    n_contacts: int = Field(default=4, ge=1, le=50)
    network_type: Literal["random"] = "random"
    beta: float = Field(gt=0.0, le=1000.0)
    init_prev: float = Field(default=0.01, gt=0.0, lt=1.0)
    dur_inf: float = Field(default=10.0, gt=0.0)    # days
    dur_exp: Optional[float] = Field(default=None, gt=0.0)  # SEIR only, days
    p_death: float = Field(default=0.0, ge=0.0, le=1.0)
    sim_dur_years: float = Field(default=1.0, gt=0.0, le=20.0)
    interventions: List[Intervention] = []
    # optional settings
    rand_seed: Optional[int] = None
    use_demographics: bool = False
    birth_rate: float = Field(default=20.0, gt=0.0)   # per 1000/year
    death_rate: float = Field(default=10.0, gt=0.0)   # per 1000/year

    @model_validator(mode="after")
    def check_seir_requires_dur_exp(self) -> SimParams:
        if self.disease_type == "seir" and self.dur_exp is None:
            raise ValueError("dur_exp is required when disease_type is 'seir'")
        return self

    @field_validator("beta")
    @classmethod
    def warn_high_r0(cls, v: float) -> float:
        return v

    def approx_r0(self) -> float:
        """Approximate R0 = beta * (dur_inf / 365) * n_contacts."""
        return self.beta * (self.dur_inf / 365.0) * self.n_contacts

    def get_vaccine(self) -> Optional[Intervention]:
        return next((i for i in self.interventions if i.type == "vaccine"), None)

    def get_seasonality(self) -> Optional[Intervention]:
        return next((i for i in self.interventions if i.type == "seasonality"), None)

    def get_treatment(self) -> Optional[Intervention]:
        return next((i for i in self.interventions if i.type == "treatment"), None)

    def to_template_dict(self) -> dict:
        """Flat dict for Jinja2 template rendering."""
        d = self.model_dump()
        # Pre-compute convenience booleans / values
        vax = self.get_vaccine()
        seas = self.get_seasonality()
        treat = self.get_treatment()
        d["vaccine"] = vax.model_dump() if vax else None
        d["seasonality_int"] = seas.model_dump() if seas else None
        d["treatment_int"] = treat.model_dump() if treat else None
        return d
