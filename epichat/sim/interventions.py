"""EpiChat interventions (spec 8.3 and 8.5; Part 2, 7.1): delayed seeding, initial
immunity, the v1 capacity-limited treatment (kept for v1-shaped entries), the
treatment delivery with a delay and a queue, and the contact reduction. Seeding and immunity draw
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


class VaccineDelivery(ss.Intervention):
    """Part 2, 7.1: vaccinates the eligible agents with a per-day probability from start_day to end_day (inclusive) with the EpiChat
    product. Starsim's routine_vx cannot end on a day (its end_year covers a whole year of daily steps), so windows and campaigns
    use this; a v1-shaped routine vaccine keeps routine_vx for the parity baseline."""

    def __init__(self, product, prob: float, start_day: int, end_day: int | None, eligibility=None):
        super().__init__()
        self.product = product
        self.prob = float(prob)
        self.start_day, self.end_day = int(start_day), end_day
        self.eligibility = eligibility
        self.accepts = ss.bernoulli(p=self.prob)
        self.define_states(ss.BoolArr("vaccinated", default=False), ss.FloatArr("ti_vaccinated"), ss.FloatArr("n_doses", default=0),
                           ss.FloatArr("protected_until", default=np.inf))

    def init_pre(self, sim):
        super().init_pre(sim)
        self.product.init_pre(sim)

    def step(self):
        if self.ti < self.start_day or (self.end_day is not None and self.ti > self.end_day):
            return
        eligible = ss.uids(self.eligibility(self.sim) if self.eligibility is not None else self.sim.people.auids)
        if len(eligible):
            # a dose is not repeated while the last one protects (review I3): coverage × efficacy is what an all-or-nothing window reaches
            covered = np.asarray(self.vaccinated.raw)[eligible] & (np.asarray(self.protected_until.raw)[eligible] > self.ti)
            eligible = eligible[~covered]
        accept = self.accepts.filter(eligible)
        if len(accept):
            self.product.administer(self.sim.people, accept)
            self.vaccinated[accept] = True
            self.ti_vaccinated[accept] = self.ti
            self.n_doses[accept] += 1
            days = getattr(self.product, "protection_days", None)
            self.protected_until[accept] = np.inf if days is None else self.ti + days


class TreatmentDelivery(ss.Intervention):
    """Part 2, 7.1: from start_day to end_day, infectious agents (symptomatic ones only when asked) that became infectious at least
    delay_days ago accept treatment with probability prob each day and queue; while queued their transmissibility is rel_trans_treated;
    up to max_capacity a day leave the queue and get the product. Each agent is treated at most once."""

    def __init__(self, product, prob: float = 1.0, max_capacity: int | None = None, start_day: int = 0, end_day: int | None = None,
                 delay_days: int = 0, rel_trans_treated: float = 1.0, symptomatic_only: bool = False):
        super().__init__()
        self.product = product
        self.accepts = ss.bernoulli(p=float(prob))
        self.max_capacity = max_capacity
        self.start_day, self.end_day, self.delay_days = int(start_day), end_day, int(delay_days)
        self.rel_trans_treated = float(rel_trans_treated)
        self.symptomatic_only = bool(symptomatic_only)
        self.define_states(ss.BoolArr("queued", default=False), ss.BoolArr("treated", default=False))
        self.queue: list[int] = []

    def init_pre(self, sim):
        super().init_pre(sim)
        self.product.init_pre(sim)

    def step(self):
        if self.ti < self.start_day:
            return
        if self.end_day is not None and self.ti > self.end_day:
            if self.queue:                                                           # the window closed: nobody keeps the waiting factor (review I5)
                left = ss.uids(self.queue)
                self.sim.diseases[0].treatment_factor[left] = 1.0
                self.queued[left] = False
                self.queue = []
            return
        disease = self.sim.diseases[0]
        since = disease.ti_infectious if hasattr(disease, "ti_infectious") else disease.ti_infected   # seir family: ti_infectious
        waited = np.asarray(since.raw) <= self.ti - self.delay_days
        eligible = np.asarray(disease.infectious.raw) & ~np.asarray(self.queued.raw) & ~np.asarray(self.treated.raw) & waited
        if self.symptomatic_only and hasattr(disease, "asymptomatic"):
            eligible &= ~np.asarray(disease.asymptomatic.raw)
        newly = self.accepts.filter(ss.uids(np.flatnonzero(eligible)))
        if len(newly):
            self.queued[newly] = True
            disease.treatment_factor[newly] = self.rel_trans_treated
            self.queue += [int(u) for u in newly]
        infectious_now = np.asarray(disease.infectious.raw)
        dropped = [u for u in self.queue if not infectious_now[u]]            # recovered while waiting: out of the queue
        if dropped:
            disease.treatment_factor[ss.uids(dropped)] = 1.0
            self.queued[ss.uids(dropped)] = False
            self.queue = [u for u in self.queue if infectious_now[u]]
        n = len(self.queue) if self.max_capacity is None else min(len(self.queue), int(self.max_capacity))
        if n:
            now = ss.uids(self.queue[:n])
            self.queue = self.queue[n:]
            self.product.administer(now)
            self.queued[now] = False
            self.treated[now] = True


class ContactReduction(ss.Intervention):
    """Part 2, 7.1: scales a network layer's transmissibility (every edge's beta, the pars.beta new edges take, and each mixing pool's
    beta) by 1 − scale from start_day to end_day. Several reductions compose (review I2): the first one in the sim applies, each step,
    the product of every active reduction's factor to each network, from the betas captured before any applied, so a reduction that
    ends restores only its own share and the layers hold their original values after the last window."""

    LAYERS = {"household": "h", "school": "s", "work": "w", "community": "c"}

    def __init__(self, layer: str = "all", scale: float = 0.0, start_day: int = 0, end_day: int | None = None):
        super().__init__()
        self.layer, self.scale, self.start_day, self.end_day = layer, float(scale), int(start_day), end_day
        self.base: dict | None = None
        self.applied: dict = {}

    def inside(self, ti: int) -> bool:
        return self.start_day <= ti and (self.end_day is None or ti <= self.end_day)

    def covers(self, name: str) -> bool:
        return self.layer == "all" or self.LAYERS[self.layer] == name

    def capture(self):
        self.base = {}
        for name, net in self.sim.networks.items():
            if isinstance(net, ss.MixingPools):
                self.base[name] = [float(pool.pars.beta) for pool in net.pools]
            else:
                self.base[name] = (float(net.pars.beta), np.array(net.edges.beta, copy=True))

    def set_factor(self, name: str, net, factor: float):
        base = self.base[name]
        if isinstance(net, ss.MixingPools):
            for pool, b in zip(net.pools, base):
                pool.pars.beta = b * factor
        else:
            net.pars.beta = base[0] * factor                                       # new edges (dynamic networks remake them)
            if len(base[1]) == len(net.edges.beta):
                net.edges.beta[:] = base[1] * factor                                # the edges that exist (static layers keep them)
            else:
                net.edges.beta[:] = base[0] * factor

    def step(self):
        reductions = [i for i in self.sim.interventions.values() if isinstance(i, ContactReduction)]
        if reductions[0] is not self:
            return                                                                 # the first reduction applies for all of them
        if self.base is None:
            self.capture()
        for name, net in self.sim.networks.items():
            factor = 1.0
            for r in reductions:
                if r.inside(self.ti) and r.covers(name):
                    factor *= 1.0 - r.scale
            if self.applied.get(name, 1.0) != factor:
                self.set_factor(name, net, factor)
                self.applied[name] = factor
