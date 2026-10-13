"""Transmissibility composition (Part 1, 8.4; Part 2, 4.2): once per step, after step_state and before
transmission, rel_trans = rel_trans_base × the agent's treatment factor × the seasonal factor × the
transmission reductions active in the step (Part 2, 7.1). Seasonality uses Starsim's own formula on
the numeric day axis (year fraction ti / 365). The susceptibility composition (rel_sus_base × vaccine
protection × SIS immunity) lives in the disease's own step_state, so it holds with or without this
connector; phase 2C adds the transmission-reduction factor here. With first_generation (the R0 pilot,
Part 2 5.7 as amended) only the day-0 seeds transmit, and not on step 0: each then transmits on exactly
the steps an ordinary case would, and nothing spreads beyond the seeds' own infections."""
from __future__ import annotations

import math

import numpy as np
import starsim as ss


class TransmissionModifiers(ss.Connector):
    def __init__(self, disease: str, seasonality_scale: float = 0.0, seasonality_shift: float = 0.0, reductions=(),
                 first_generation: bool = False):
        super().__init__()
        self.disease_name = disease
        self.first_generation = bool(first_generation)
        self.seed_uids = None
        self.scale = float(seasonality_scale)
        self.shift = float(seasonality_shift)
        self.reductions = [(int(start), None if end is None else int(end), float(scale)) for start, end, scale in reductions]
        self.factors: list[float] = []

    def seasonal(self, ti: int) -> float:
        if self.scale == 0.0:
            return 1.0
        frac_year = (ti / 365.0) % 1.0
        return max(0.0, 1.0 + self.scale * math.cos(2 * math.pi * (frac_year - self.shift)))

    def factor(self) -> float:
        f = self.seasonal(self.ti)
        for start, end, scale in self.reductions:           # Part 2, 7.1: transmission reductions over their windows
            if start <= self.ti and (end is None or self.ti <= end):
                f *= 1.0 - scale
        return f

    def step(self):
        disease = self.sim.diseases[self.disease_name]
        factor = self.factor()
        disease.rel_trans[:] = np.asarray(disease.rel_trans_base) * np.asarray(disease.treatment_factor) * factor
        self.factors.append(factor)
        if self.first_generation:
            if self.seed_uids is None:                       # step 0: the seeds are whoever is infected now, and they stay quiet today
                self.seed_uids = np.array(disease.infected.uids, copy=True)
                disease.rel_trans[:] = 0.0
            else:                                            # afterwards nobody but the seeds transmits
                others = np.ones(len(disease.rel_trans.raw), dtype=bool)
                others[self.seed_uids] = False
                disease.rel_trans.raw[others] = 0.0


TransmissibilityModifiers = TransmissionModifiers   # the Part 1 name, for the tests that use it
