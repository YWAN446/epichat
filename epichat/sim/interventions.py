"""EpiChat interventions (spec 8.3 and 8.5): delayed seeding, initial
immunity, and the v1 capacity-limited treatment. Seeding and immunity draw
from Starsim distributions, so they are reproducible under common random
numbers; the treatment keeps its v1 numpy draw until the interventions spec
revises it. ss.Sim copies its inputs: read these objects back through
sim.interventions, not through the instance passed in."""
from __future__ import annotations

import numpy as np
import starsim as ss


class SimpleTreatment(ss.Intervention):
    """v1's _SimpleTreatment: each day from start_day, up to prob × (infectious agents),
    capped at max_capacity, recover on the next step."""

    def __init__(self, prob=1.0, max_capacity=None, start_day=0):
        super().__init__()
        self.prob = prob
        self.max_capacity = max_capacity
        self.start_day = start_day

    def step(self):
        if self.ti < self.start_day:
            return
        disease = self.sim.diseases[0]
        infectious = np.asarray(disease.infectious.uids)
        if len(infectious) == 0:
            return
        n = int(self.prob * len(infectious))
        if self.max_capacity is not None:
            n = min(n, self.max_capacity)
        if n <= 0:
            return
        rng = np.random.default_rng(int(self.ti))
        treated = ss.uids(rng.choice(infectious, size=min(n, len(infectious)), replace=False))
        disease.ti_recovered[treated] = self.ti + 1


class SeedInfections(ss.Intervention):
    """Seed(day > 0): on that step, infect susceptible agents by fraction or by count."""

    def __init__(self, day: int, mode: str, value: float):
        super().__init__()
        self.day = int(day)
        self.mode = mode
        self.value = value
        self.chooser = ss.bernoulli(p=float(value)) if mode == "fraction" else ss.choose_n(int(value))
        self.n_seeded = 0

    def step(self):
        if self.ti != self.day:
            return
        disease = self.sim.diseases[0]
        chosen = self.chooser.filter(disease.susceptible.uids)
        if len(chosen):
            disease.set_prognoses(chosen, sources=-1)
        self.n_seeded = int(len(chosen))


class InitialImmunity(ss.Intervention):
    """initial_immune_frac: at step 0 (after step_state, before transmission, so the
    day-0 seeds are already infected and never picked), that share of the susceptible
    agents becomes immune: recovered in the SIR family (waning like everyone else's
    immunity in sirs and seirs), full immunity that wanes at sis_waning in sis."""

    def __init__(self, frac: float):
        super().__init__()
        self.frac = float(frac)
        self.chooser = ss.bernoulli(p=self.frac)
        self.n_immunised = 0

    def step(self):
        if self.ti != 0:
            return
        disease = self.sim.diseases[0]
        chosen = self.chooser.filter(disease.susceptible.uids)
        if hasattr(disease, "recovered"):
            disease.susceptible[chosen] = False
            disease.recovered[chosen] = True
            if hasattr(disease, "ti_susceptible"):
                disease.ti_susceptible[chosen] = self.ti + disease.pars.dur_immune.rvs(chosen)
        else:                                   # sis: immunity 1 wanes through update_immunity; the disease composes rel_sus each step
            disease.immunity[chosen] = 1.0
            disease.rel_sus[chosen] = 0.0       # protected from this step on, before the next composition
        self.n_immunised = int(len(chosen))
