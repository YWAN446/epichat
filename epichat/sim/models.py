"""EpiChat's six compartmental models as thin subclasses of Starsim 3.7's
SIR, SEIR and SIS (spec 7.1, phase 2 behaviour).

Every model carries `rel_trans_base`, which the TransmissibilityModifiers
connector multiplies into `rel_trans` once per step (spec 8.4), and the
`new_deaths_disease` result, which counts the deaths a disease requests so the
service never subtracts background mortality. SEIAR lowers the base, never
`rel_trans`, for asymptomatic agents and draws `p_death` for symptomatic
infections only (7.2: a case fatality ratio). SIS takes its waning and boost
from the parameters (0 and 0 reproduce v1) and never draws deaths.
"""
from __future__ import annotations

import numpy as np
import starsim as ss


class EpiChatDisease:
    """Mixin for every EpiChat model: a transmissibility base state the
    connector composes into rel_trans (spec 8.4), and a disease-death counter."""

    def __init__(self, pars=None, **kwargs):
        super().__init__(pars=pars, **kwargs)
        self.define_states(ss.FloatArr("rel_trans_base", default=1.0, label="Base relative transmission"))

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
    """SEIR with an asymptomatic track: E -> I or A -> R; A transmits at rel_trans_asymp
    (through rel_trans_base) and never dies of the disease (spec 7.2)."""

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
        p = self.pars
        asymp = p.p_asymp.rvs(uids)
        self.asymp_track[uids] = asymp
        dur_inf = p.dur_inf.rvs(uids)
        will_die = p.p_death.rvs(uids) & ~asymp          # p_death is a case fatality ratio: symptomatic cases only
        dead, rec = uids[will_die], uids[~will_die]
        self.ti_dead[dead] = self.ti_infectious[dead] + dur_inf[will_die]
        self.ti_recovered[rec] = self.ti_infectious[rec] + dur_inf[~will_die]

    def step_state(self):
        becoming = (self.exposed & (self.ti_infectious <= self.ti)).uids
        super().step_state()
        asymp = becoming[self.asymp_track[becoming]]
        self.asymptomatic[asymp] = True
        self.rel_trans_base[asymp] = self.pars.rel_trans_asymp

    def clear_infection(self, uids):
        super().clear_infection(uids)
        self.asymptomatic[uids] = False
        self.asymp_track[uids] = False
        self.rel_trans_base[uids] = 1.0


MODELS: dict[str, type] = {"sir": SIR, "seir": SEIR, "sis": SIS, "sirs": SIRS, "seirs": SEIRS, "seiar": SEIAR}
