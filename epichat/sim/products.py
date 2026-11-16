"""The EpiChat vaccine product (Part 2, 4.2 and 7.2): instead of multiplying rel_sus in place as Starsim's
simple_vx does (the connector would overwrite it next step), it writes the vaccine_protection state the
connector composes. Leaky: every recipient keeps 1 − efficacy of its susceptibility; all-or-nothing: a
share efficacy of recipients is fully protected. Waning (protection_days) arrives in phase 2C."""
from __future__ import annotations

import numpy as np
import starsim as ss


class Vaccine(ss.Vx):
    """Part 2, 4.2 and 7.2: writes vaccine_protection (leaky: 1 − efficacy for every recipient; all-or-nothing: 0 for a share efficacy)
    and, with protection_days, the step the protection ends; the disease composes rel_sus from it each step."""

    def __init__(self, efficacy: float = 1.0, leaky: bool = True, protection_days: int | None = None):
        super().__init__()
        self.efficacy = float(efficacy)
        self.leaky = bool(leaky)
        self.protection_days = None if protection_days is None else int(protection_days)
        self.takes = ss.bernoulli(p=self.efficacy)

    def administer(self, people, uids):
        protected = uids if self.leaky else self.takes.filter(uids)
        left = 1.0 - self.efficacy if self.leaky else 0.0
        for disease in self.sim.diseases.values():
            if hasattr(disease, "vaccine_protection"):
                disease.vaccine_protection[protected] = left
                if self.protection_days is not None:
                    disease.vaccine_expires[protected] = self.sim.ti + self.protection_days
                if hasattr(disease, "compose_rel_sus"):
                    disease.compose_rel_sus()                                       # protected from this step on, whatever the dose count
                else:
                    disease.rel_sus[protected] = disease.rel_sus[protected] * left
        return protected


class Treatment(ss.Product):
    """Part 2, 7.2: cures a treated agent with probability efficacy (it recovers on the next step) and ends its waiting factor."""

    def __init__(self, efficacy: float = 1.0):
        super().__init__()
        self.efficacy = float(efficacy)
        self.cures = ss.bernoulli(p=self.efficacy)

    def administer(self, uids):
        disease = self.sim.diseases[0]
        cured = self.cures.filter(uids)
        if len(cured):
            disease.ti_recovered[cured] = self.sim.ti + 1
        disease.treatment_factor[uids] = 1.0
        return {"successful": cured, "unsuccessful": np.setdiff1d(np.asarray(uids), np.asarray(cured))}
