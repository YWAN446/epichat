"""Transmissibility composition (spec 8.4): once per step, after step_state
and before transmission, rel_trans = rel_trans_base × the active modifiers.
Seasonality is the first modifier, with Starsim's own formula on the numeric
day axis (year fraction ti / 365). The interventions spec adds its modifiers
here, so SEIAR's asymptomatic reduction always reaches rel_trans."""
from __future__ import annotations

import math

import numpy as np
import starsim as ss


class TransmissibilityModifiers(ss.Connector):
    def __init__(self, disease: str, seasonality_scale: float = 0.0, seasonality_shift: float = 0.0):
        super().__init__()
        self.disease_name = disease
        self.scale = float(seasonality_scale)
        self.shift = float(seasonality_shift)
        self.factors: list[float] = []

    def factor(self) -> float:
        if self.scale == 0.0:
            return 1.0
        frac_year = (self.ti / 365.0) % 1.0
        return max(0.0, 1.0 + self.scale * math.cos(2 * math.pi * (frac_year - self.shift)))

    def step(self):
        disease = self.sim.diseases[self.disease_name]
        factor = self.factor()
        disease.rel_trans[:] = np.asarray(disease.rel_trans_base) * factor
        self.factors.append(factor)
