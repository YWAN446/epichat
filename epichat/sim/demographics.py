"""Population pieces of Part 2 section 6: people whose ages are written before any module's init_post, from the UN pyramid or the three
shares, and births whose crude rate follows a yearly series on the sim's own year axis (the sims run on numeric days from day 0, so
Starsim's calendar-year lookup cannot be used)."""
from __future__ import annotations

import numpy as np
import starsim as ss


class AgedPeople(ss.People):
    """People whose ages are set in init_vals, before any module's init_post, so the day-0 seeds draw their prognoses on them (Part 2, 4.1).
    `age_data` is Starsim's histogram form (a DataFrame with age and value columns); `ages` an explicit array for the shares path."""

    def __init__(self, n_agents: int, ages: np.ndarray | None = None, age_data=None):
        super().__init__(n_agents, age_data=age_data)
        self._ages = ages

    def init_vals(self):
        super().init_vals()
        if self._ages is not None:
            self.age[:] = self._ages[:len(self)]


class YearlyBirths(ss.Births):
    """Births at rates_per_1000[y] during sim year y (the last value for later years); Part 2, 6.2."""

    def __init__(self, rates_per_1000, **kwargs):
        self.rates = [float(r) for r in rates_per_1000]
        super().__init__(birth_rate=ss.peryear(self.rates[0]), **kwargs)

    def step(self):
        year = min(int(self.ti // 365), len(self.rates) - 1)        # dt is one day
        self.pars.birth_rate = ss.peryear(self.rates[year])
        return super().step()
