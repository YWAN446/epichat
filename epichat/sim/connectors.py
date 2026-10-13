"""Transmissibility composition (Part 1, 8.4; Part 2, 4.2): once per step, after step_state and before
transmission, rel_trans = rel_trans_base × the agent's treatment factor × the seasonal factor × the
transmission reductions active in the step (Part 2, 7.1). Seasonality uses Starsim's own formula on
the numeric day axis (year fraction ti / 365). The susceptibility composition (rel_sus_base × vaccine
protection × SIS immunity) lives in the disease's own step_state, so it holds with or without this
connector; phase 2C adds the transmission-reduction factor here."""
from __future__ import annotations

import math

import numpy as np
import starsim as ss


class TransmissionModifiers(ss.Connector):
    def __init__(self, disease: str, seasonality_scale: float = 0.0, seasonality_shift: float = 0.0, reductions=()):
        super().__init__()
        self.disease_name = disease
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


TransmissibilityModifiers = TransmissionModifiers   # the Part 1 name, for the tests that use it
