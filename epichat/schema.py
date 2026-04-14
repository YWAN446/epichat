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
    scale: float = Field(default=0.2, ge=0.0, le=1.0)
    shift: float = Field(default=0.0, ge=0.0, le=1.0)


class SimParams(BaseModel):
    disease_type: Literal["sir", "seir", "sis", "sirs", "seiar"] = "sir"
    n_agents: int = Field(default=10000, ge=10, le=1_000_000)
    n_contacts: int = Field(default=4, ge=1, le=100)
    network_type: Literal["random", "age_structured"] = "random"
    network_beta: float = Field(default=1.0, gt=0.0, le=10.0)
    beta: float = Field(gt=0.0, le=1000.0)
    init_prev: float = Field(default=0.01, gt=0.0, lt=1.0)
    dur_inf: float = Field(default=10.0, gt=0.0)       # days
    dur_exp: Optional[float] = Field(default=None, gt=0.0)   # SEIR/SEIAR, days
    dur_immune: Optional[float] = Field(default=None, gt=0.0) # SIRS, days of immunity
    p_death: float = Field(default=0.0, ge=0.0, le=1.0)
    p_asymp: float = Field(default=0.3, ge=0.0, le=1.0)      # SEIAR: fraction asymptomatic
    rel_trans_asymp: float = Field(default=0.5, ge=0.0, le=1.0)  # SEIAR: asymp relative transmissibility
    sim_dur_years: float = Field(default=1.0, gt=0.0, le=20.0)
    interventions: List[Intervention] = []
    rand_seed: Optional[int] = None
    use_demographics: bool = False
    birth_rate: float = Field(default=20.0, gt=0.0)
    death_rate: float = Field(default=10.0, gt=0.0)

    @model_validator(mode="after")
    def check_required_params(self) -> SimParams:
        if self.disease_type in ("seir", "seiar") and self.dur_exp is None:
            raise ValueError("dur_exp is required when disease_type is 'seir' or 'seiar'")
        if self.disease_type == "sirs" and self.dur_immune is None:
            raise ValueError("dur_immune is required when disease_type is 'sirs'")
        return self

    @field_validator("beta")
    @classmethod
    def warn_high_r0(cls, v: float) -> float:
        return v

    def approx_r0(self) -> float:
        """Approximate R0. Age-structured uses spectral radius of POLYMOD NGM."""
        # SEIAR: asymptomatics are partially infectious, so effective beta is reduced
        asymp_factor = 1.0
        if self.disease_type == "seiar":
            asymp_factor = 1 - self.p_asymp * (1 - self.rel_trans_asymp)

        if self.network_type == "age_structured":
            import numpy as np
            C = np.array([[7.0, 2.5, 0.5],
                          [2.5, 9.0, 1.5],
                          [0.5, 1.5, 3.5]])
            ngm = self.beta * self.network_beta * asymp_factor * (self.dur_inf / 365.0) * C
            return float(np.linalg.eigvals(ngm).real.max())
        return self.beta * self.network_beta * asymp_factor * (self.dur_inf / 365.0) * self.n_contacts

    def get_vaccine(self) -> Optional[Intervention]:
        return next((i for i in self.interventions if i.type == "vaccine"), None)

    def get_seasonality(self) -> Optional[Intervention]:
        return next((i for i in self.interventions if i.type == "seasonality"), None)

    def get_treatment(self) -> Optional[Intervention]:
        return next((i for i in self.interventions if i.type == "treatment"), None)

    def to_template_dict(self) -> dict:
        d = self.model_dump()
        vax   = self.get_vaccine()
        seas  = self.get_seasonality()
        treat = self.get_treatment()
        d["vaccine"]        = vax.model_dump()   if vax   else None
        d["seasonality_int"]= seas.model_dump()  if seas  else None
        d["treatment_int"]  = treat.model_dump() if treat else None
        return d
