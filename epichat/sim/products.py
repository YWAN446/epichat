"""The EpiChat vaccine product (Part 2, 4.2 and 7.2): instead of multiplying rel_sus in place as Starsim's
simple_vx does (the connector would overwrite it next step), it writes the vaccine_protection state the
connector composes. Leaky: every recipient keeps 1 − efficacy of its susceptibility; all-or-nothing: a
share efficacy of recipients is fully protected. Waning (protection_days) arrives in phase 2C."""
from __future__ import annotations

import starsim as ss


class Vaccine(ss.Vx):
    def __init__(self, efficacy: float = 1.0, leaky: bool = True):
        super().__init__()
        self.efficacy = float(efficacy)
        self.leaky = bool(leaky)
        self.takes = ss.bernoulli(p=self.efficacy)

    def administer(self, people, uids):
        protected = uids if self.leaky else self.takes.filter(uids)
        left = 1.0 - self.efficacy if self.leaky else 0.0
        for disease in self.sim.diseases.values():
            if hasattr(disease, "vaccine_protection"):
                disease.vaccine_protection[protected] = left
                disease.rel_sus[protected] = disease.rel_sus[protected] * left    # protected from this step on; composed from the next
        return protected
