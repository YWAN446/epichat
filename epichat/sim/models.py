"""EpiChat's six compartmental models as thin subclasses of Starsim 3.7's
SIR, SEIR and SIS (spec 7.1).

Phase 0 reproduces the v1 templates: constant durations arrive from the
builder, deaths are drawn for every infection (seiar included), asymptomatic
agents lower rel_trans directly, and sis has neither immunity (the builder
passes waning 0 and imm_boost 0) nor deaths. The one addition is the
`new_deaths_disease` result, which counts the deaths a disease requests so the
service no longer subtracts background mortality.
"""
from __future__ import annotations

import numpy as np
import starsim as ss


class EpiChatDisease:
    """Mixin for every EpiChat model: counts the deaths this disease requests."""

    def init_results(self):
        super().init_results()
        self.define_results(ss.Result("new_deaths_disease", dtype=int, scale=True, label="Disease deaths"))

    def step_state(self):
        if hasattr(self, "ti_dead"):   # ss.SIS has no deaths
            deaths = (self.ti_dead <= self.ti).uids
            if len(deaths):
                self.results.new_deaths_disease[self.ti] += len(deaths)
        super().step_state()


class SIR(EpiChatDisease, ss.SIR):
    pass


class SEIR(EpiChatDisease, ss.SEIR):
    pass


class SIS(EpiChatDisease, ss.SIS):
    pass


class _Waning:
    """R -> S after dur_immune, for SIRS and SEIRS. `start_state` is the state the
    infectious period is counted from (ti_infected in SIR, ti_infectious in SEIR)."""

    start_state = "ti_infected"

    def _define_waning(self, dur_immune):
        self.define_pars(dur_immune=ss.constant(ss.days(180)))
        if dur_immune is not None:
            self.update_pars(dur_immune=dur_immune)
        self.define_states(ss.FloatArr("ti_susceptible", label="Time immunity wanes"))

    def set_progression(self, uids):
        p = self.pars
        start = getattr(self, self.start_state)
        dur_inf = p.dur_inf.rvs(uids)
        dur_imm = p.dur_immune.rvs(uids)
        will_die = p.p_death.rvs(uids)
        dead, rec = uids[will_die], uids[~will_die]
        self.ti_dead[dead] = start[dead] + dur_inf[will_die]
        self.ti_recovered[dead] = np.nan
        self.ti_recovered[rec] = start[rec] + dur_inf[~will_die]
        self.ti_dead[rec] = np.nan
        self.ti_susceptible[rec] = self.ti_recovered[rec] + dur_imm[~will_die]

    def step_state(self):
        super().step_state()
        waned = (self.recovered & (self.ti_susceptible <= self.ti)).uids
        self.recovered[waned] = False
        self.susceptible[waned] = True


class SIRS(_Waning, SIR):
    def __init__(self, pars=None, dur_immune=None, **kwargs):
        super().__init__(pars=pars, **kwargs)
        self._define_waning(dur_immune)


class SEIRS(_Waning, SEIR):
    start_state = "ti_infectious"

    def __init__(self, pars=None, dur_immune=None, **kwargs):
        super().__init__(pars=pars, **kwargs)
        self._define_waning(dur_immune)


class SEIAR(SEIR):
    """SEIR with an asymptomatic track: E -> I or A -> R; A transmits at rel_trans_asymp."""

    def __init__(self, pars=None, p_asymp=None, rel_trans_asymp=None, **kwargs):
        super().__init__(pars=pars, **kwargs)
        self.define_pars(p_asymp=ss.bernoulli(p=0.3), rel_trans_asymp=0.5)
        if p_asymp is not None:
            self.update_pars(p_asymp=p_asymp)
        if rel_trans_asymp is not None:
            self.update_pars(rel_trans_asymp=rel_trans_asymp)
        self.define_states(
            ss.BoolState("asymptomatic", label="Asymptomatic"),
            ss.BoolArr("asymp_track", label="Will be asymptomatic once infectious"),
        )

    def set_progression(self, uids):
        super().set_progression(uids)                 # phase 0: deaths drawn for every infection, as v1
        self.asymp_track[uids] = self.pars.p_asymp.rvs(uids)

    def step_state(self):
        becoming = (self.exposed & (self.ti_infectious <= self.ti)).uids
        super().step_state()
        asymp = becoming[self.asymp_track[becoming]]
        self.asymptomatic[asymp] = True
        self.rel_trans[asymp] = self.pars.rel_trans_asymp   # phase 0: direct, as v1; phase 2 moves to rel_trans_base

    def clear_infection(self, uids):
        super().clear_infection(uids)
        self.asymptomatic[uids] = False
        self.asymp_track[uids] = False
        self.rel_trans[uids] = 1.0


MODELS: dict[str, type] = {"sir": SIR, "seir": SEIR, "sis": SIS, "sirs": SIRS, "seirs": SEIRS, "seiar": SEIAR}
