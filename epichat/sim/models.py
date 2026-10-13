"""EpiChat's six compartmental models as thin subclasses of Starsim 3.7's
SIR, SEIR and SIS (spec 7.1, phase 2 behaviour).

Every model carries `rel_trans_base`, which the TransmissionModifiers connector
multiplies into `rel_trans` once per step (spec 8.4), composes its own `rel_sus`
from the agents' ages, vaccination and SIS immunity (Part 2, 4.2), and counts the
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
    """Mixin for every EpiChat model: the base states (rel_trans_base for the connector's rel_trans, rel_sus_base,
    rel_sus_ind and vaccine_protection for the disease's own rel_sus composition; Part 1 8.4, Part 2 4.2, follow-up
    spec 4.2) and a disease-death counter."""

    def __init__(self, pars=None, rel_sus_age=None, rel_sus_cv=None, **kwargs):
        super().__init__(pars=pars, **kwargs)
        self.define_pars(rel_sus_age=(1.0, 1.0, 1.0))      # children, adults, elderly (Part 2, 4.1)
        if rel_sus_age is not None:
            self.update_pars(rel_sus_age=tuple(float(v) for v in rel_sus_age))
        cv = float(rel_sus_cv or 0.0)
        # Follow-up spec 4.1: a personal multiplier drawn once per agent (births included) from a gamma with mean 1 and coefficient
        # of variation cv; with no variation it is the constant 1 and nothing is drawn, so no random stream is added.
        personal = ss.gamma(a=1.0 / cv ** 2, scale=cv ** 2) if cv > 0 else 1.0
        self.define_states(
            ss.FloatArr("rel_sus_ind", default=personal, label="Personal susceptibility multiplier"),
        )
        self.define_states(
            ss.FloatArr("rel_trans_base", default=1.0, label="Base relative transmission"),
            ss.FloatArr("rel_sus_base", default=1.0, label="Base relative susceptibility"),
            ss.FloatArr("vaccine_protection", default=1.0, label="Susceptibility left by vaccination"),
            ss.FloatArr("vaccine_expires", default=np.inf, label="Step the vaccine's protection ends"),
            ss.FloatArr("treatment_factor", default=1.0, label="Transmissibility while waiting for treatment"),
        )

    def compose_rel_sus(self):
        """Part 2, 4.2 and follow-up spec 4.2: rel_sus = rel_sus_base (from the agents' ages) × rel_sus_ind (the personal
        multiplier) × vaccine protection × (1 − SIS immunity)."""
        expired = np.asarray(self.vaccine_expires.raw) <= self.ti          # Part 2, 7.1: waning restores the susceptibility
        if expired.any():
            self.vaccine_protection.raw[expired] = 1.0
            self.vaccine_expires.raw[expired] = np.inf
        age = np.asarray(self.sim.people.age)
        children, adults, elderly = self.pars.rel_sus_age
        base = np.select([age < 18, age < 65], [children, adults], default=elderly)
        self.rel_sus_base[:] = base
        immunity = np.clip(1.0 - np.asarray(self.immunity), 0.0, 1.0) if hasattr(self, "immunity") else 1.0
        self.rel_sus[:] = base * np.asarray(self.rel_sus_ind) * np.asarray(self.vaccine_protection) * immunity

    def init_results(self):
        super().init_results()
        self.define_results(ss.Result("new_deaths_disease", dtype=int, scale=True, label="Disease deaths"))

    def step_state(self):
        if hasattr(self, "ti_dead"):   # ss.SIS has no deaths
            deaths = (self.ti_dead <= self.ti).uids
            if len(deaths):
                self.results.new_deaths_disease[self.ti] += len(deaths)
        super().step_state()
        self.compose_rel_sus()


class SIR(EpiChatDisease, ss.SIR):
    pass


class _Presymptomatic:
    """Part 2, 4.3: exposed agents transmit at rel_trans_exposed of the infectious value. Starsim's kernel weights
    the sources by infectious × rel_trans; this one by (infectious + rel_trans_exposed × exposed) × rel_trans, so
    the default 0 changes nothing and the fraction holds with or without the connector. SEIAR's asymptomatic
    value applies once infectious: the exposed transmit at the fraction whatever their track."""

    def __init__(self, pars=None, rel_trans_exposed=None, **kwargs):
        super().__init__(pars=pars, **kwargs)
        self.define_pars(rel_trans_exposed=0.0)
        if rel_trans_exposed is not None:
            self.update_pars(rel_trans_exposed=rel_trans_exposed)

    def infect(self):
        betamap = self.validate_beta()
        weights = (self.infectious.raw + float(self.pars.rel_trans_exposed) * self.exposed.raw) * self.rel_trans.raw
        rel_trans = self.rel_trans.asnew(weights, copy=False)
        rel_sus = self.rel_sus.asnew(self.susceptible.raw * self.rel_sus.raw, copy=False)
        new_cases, sources, networks = [], [], []
        for i, (nkey, route) in enumerate(self.sim.networks.items()):
            betas = betamap[ss.standardize_netkey(nkey)]
            target_uids, source_uids, network_ids = self.infect_route(i, route, betas, rel_trans, rel_sus)
            new_cases.append(target_uids)
            sources.append(source_uids)
            networks.append(network_ids)
        return self.finalize_infections(new_cases, sources, networks)


class SEIR(EpiChatDisease, _Presymptomatic, ss.SEIR):
    pass


class SIS(EpiChatDisease, ss.SIS):
    def update_immunity(self):
        # Starsim writes rel_sus here; compose_rel_sus derives it from immunity each step instead (Part 2, 4.2).
        waning = self.pars.waning.to_prob()
        has_imm = (self.immunity > 0).uids
        self.immunity[has_imm] *= (1 - waning)


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
