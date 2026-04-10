from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class Intervention(BaseModel):
    type: Literal["vaccine", "quarantine"]
    coverage: float = Field(ge=0.0, le=1.0)
    start_day: int = Field(default=0, ge=0)


class SimParams(BaseModel):
    disease_type: Literal["sir", "seir", "sis"] = "sir"
    n_agents: int = Field(default=10000, ge=10, le=1_000_000)
    n_contacts: int = Field(default=4, ge=1, le=50)
    network_type: Literal["random", "age_clustered"] = "random"
    beta: float = Field(gt=0.0, le=1.0)
    init_prev: float = Field(default=0.01, gt=0.0, lt=1.0)
    dur_inf: float = Field(default=10.0, gt=0.0)   # days
    dur_exp: Optional[float] = Field(default=None, gt=0.0)  # SEIR only
    p_death: float = Field(default=0.0, ge=0.0, le=1.0)
    sim_dur_years: float = Field(default=1.0, gt=0.0, le=20.0)
    interventions: List[Intervention] = []

    @model_validator(mode="after")
    def check_seir_requires_dur_exp(self) -> SimParams:
        if self.disease_type == "seir" and self.dur_exp is None:
            raise ValueError("dur_exp is required when disease_type is 'seir'")
        return self

    @field_validator("beta")
    @classmethod
    def warn_high_r0(cls, v: float) -> float:
        # Not raising — just a soft check; callers may log the warning
        return v

    def approx_r0(self) -> float:
        """Return approximate R0 = beta * dur_inf * n_contacts."""
        return self.beta * self.dur_inf * self.n_contacts

    def to_template_dict(self) -> dict:
        """Return a flat dict suitable for Jinja2 template rendering."""
        d = self.model_dump()
        d["sim_dur_days"] = int(self.sim_dur_years * 365)
        d["has_vaccine"] = any(i.type == "vaccine" for i in self.interventions)
        if d["has_vaccine"]:
            vax = next(i for i in self.interventions if i.type == "vaccine")
            d["vax_coverage"] = vax.coverage
            d["vax_start_day"] = vax.start_day
        return d
