import starsim as ss
import matplotlib
matplotlib.use('Agg')
import json
import numpy as np


class SEIRS(ss.SIR):
    """SEIR with waning immunity: E -> I -> R -> S after dur_immune days."""

    def __init__(self, pars=None, **kwargs):
        dur_exp_val    = kwargs.pop('dur_exp', None)
        dur_immune_val = kwargs.pop('dur_immune', None)
        super().__init__(pars=pars, **kwargs)
        self.define_pars(
            dur_exp    = dur_exp_val    if dur_exp_val    is not None else ss.constant(5),
            dur_immune = dur_immune_val if dur_immune_val is not None else ss.constant(180),
        )
        self.define_states(
            ss.BoolState('susceptible', default=True, label='Susceptible'),
            ss.BoolState('exposed',   label='Exposed'),
            ss.BoolState('infected',  label='Infectious'),
            ss.BoolState('recovered', label='Recovered (immune)'),
            ss.FloatArr('ti_infected'),
            ss.FloatArr('ti_infectious'),
            ss.FloatArr('ti_recovered'),
            ss.FloatArr('ti_susceptible', label='Time of immunity waning'),
            ss.FloatArr('ti_dead'),
            ss.FloatArr('rel_sus',   default=1.0),
            ss.FloatArr('rel_trans', default=1.0),
            reset=True,
        )

    def step_state(self):
        sim = self.sim
        # E -> I
        newly_inf = (self.exposed & (self.ti_infectious <= sim.ti)).uids
        self.exposed[newly_inf]  = False
        self.infected[newly_inf] = True
        # I -> R
        recovered = (self.infected & (self.ti_recovered <= sim.ti)).uids
        self.infected[recovered]  = False
        self.recovered[recovered] = True
        # R -> S (waning immunity)
        waned = (self.recovered & (self.ti_susceptible <= sim.ti)).uids
        self.recovered[waned]   = False
        self.susceptible[waned] = True
        # Deaths
        deaths = (self.ti_dead <= sim.ti).uids
        if len(deaths):
            sim.people.request_death(deaths)

    def set_prognoses(self, uids, sources=None):
        ti = self.t.ti
        self.susceptible[uids] = False
        self.exposed[uids]     = True
        self.ti_infected[uids] = ti
        p = self.pars
        dur_exp = p.dur_exp.rvs(uids)
        dur_inf = p.dur_inf.rvs(uids)
        dur_imm = p.dur_immune.rvs(uids)
        self.ti_infectious[uids] = ti + dur_exp
        will_die  = p.p_death.rvs(uids)
        dead_uids = uids[will_die]
        rec_uids  = uids[~will_die]
        self.ti_dead[dead_uids]       = ti + dur_exp[will_die]  + dur_inf[will_die]
        self.ti_recovered[rec_uids]   = ti + dur_exp[~will_die] + dur_inf[~will_die]
        self.ti_susceptible[rec_uids] = ti + dur_exp[~will_die] + dur_inf[~will_die] + dur_imm[~will_die]

    @property
    def infectious(self):
        return self.infected


# ── Interventions ─────────────────────────────────────────────────────────────
interventions_list = []
connectors_list = []


connectors_list.append(ss.seasonality(
    diseases='seirs',
    scale=0.2,
    shift=0.1,
))



_product = ss.simple_vx(efficacy=1.0)
_vax_start_year = 2000 + 10 / 365
interventions_list.append(ss.routine_vx(
    product=_product,
    prob=0.3,
    start_year=_vax_start_year,
))


# ── Network ───────────────────────────────────────────────────────────────────

_network = dict(type='random', n_contacts=6, beta=1.0)


# ── Simulation parameters ─────────────────────────────────────────────────────
disease = SEIRS(
    init_prev=0.01,
    beta=0.05,
    dur_exp=ss.constant(4.0),
    dur_inf=ss.constant(10.0),
    dur_immune=ss.constant(90.0),
    p_death=0.0,
)

pars = dict(
    n_agents=2000,
    networks=_network,
    diseases=[disease],

    dur=0.5,
    dt=1/365,

    rand_seed=7,

)

if interventions_list:
    pars['interventions'] = interventions_list

sim = ss.Sim(pars, connectors=connectors_list or None, verbose=0)
sim.init()





sim.run()

res = sim.results
dr = res[list(sim.diseases.keys())[0]]

n_infected     = dr['n_infected'].values
cum_infections = dr['cum_infections'].values
# Deaths the disease caused: every death in the population less the background mortality (ss.Deaths).
_all_deaths = res['new_deaths'].values if 'new_deaths' in res else np.zeros(len(res['timevec']))
_bg_deaths = sim.demographics['deaths'].results['new'].values if 'deaths' in sim.demographics else 0
new_deaths = np.clip(_all_deaths - _bg_deaths, 0, None)
cum_deaths = np.cumsum(new_deaths)

import matplotlib.pyplot as plt

_dis_key = list(sim.diseases.keys())[0]
_dr = sim.results[_dis_key]
_rs = sim.results
_days = np.arange(len(_rs['timevec']))

fig, axes = plt.subplots(3, 3, figsize=(15, 10))
_ax = axes.flatten()

# (0,0) All compartments overview
for _k, _c, _l in [
    ('n_susceptible',  'steelblue',  'Susceptible'),
    ('n_exposed',      'gold',       'Exposed'),
    ('n_infected',     'firebrick',  'Infectious'),
    ('n_asymptomatic', 'darkorange', 'Asymptomatic'),
    ('n_recovered',    'seagreen',   'Recovered'),
]:
    if _k in _dr:
        _ax[0].plot(_days, _dr[_k].values, color=_c, label=_l)
_ax[0].set_title('All compartments')
_ax[0].set_xlabel('Day')
_ax[0].legend(fontsize=7)

# (0,1) Susceptible
_ax[1].set_title('Susceptible')
_ax[1].set_xlabel('Day')
if 'n_susceptible' in _dr:
    _ax[1].plot(_days, _dr['n_susceptible'].values, color='steelblue')

# (0,2) Infectious
_ax[2].set_title('Infectious')
_ax[2].set_xlabel('Day')
if 'n_infected' in _dr:
    _ax[2].plot(_days, _dr['n_infected'].values, color='firebrick')

# (1,0) Recovered
_ax[3].set_title('Recovered')
_ax[3].set_xlabel('Day')
if 'n_recovered' in _dr:
    _ax[3].plot(_days, _dr['n_recovered'].values, color='seagreen')

# (1,1) Prevalence
_ax[4].set_title('Prevalence (%)')
_ax[4].set_xlabel('Day')
if 'prevalence' in _dr:
    _ax[4].plot(_days, _dr['prevalence'].values * 100, color='firebrick')

# (1,2) New infections per day
_ax[5].set_title('New infections / day')
_ax[5].set_xlabel('Day')
if 'new_infections' in _dr:
    _ax[5].plot(_days, _dr['new_infections'].values, color='steelblue')

# (2,0) Cumulative infections
_ax[6].set_title('Cumulative infections')
_ax[6].set_xlabel('Day')
if 'cum_infections' in _dr:
    _ax[6].plot(_days, _dr['cum_infections'].values, color='steelblue')

# (2,1) New deaths per day
_ax[7].set_title('New deaths / day')
_ax[7].set_xlabel('Day')
_ax[7].plot(_days, new_deaths, color='darkred')

# (2,2) Cumulative deaths
_ax[8].set_title('Cumulative deaths')
_ax[8].set_xlabel('Day')
_ax[8].plot(_days, cum_deaths, color='darkred')

fig.suptitle(_dis_key.upper() + ' Simulation', fontsize=13, y=1.01)
fig.tight_layout()
fig.savefig(r'results/sim_fixture.png', dpi=150, bbox_inches='tight')
plt.close(fig)

print(json.dumps({
    'peak_infections': int(n_infected.max()),
    'peak_day':        int(n_infected.argmax()),
    'total_infected':  int(cum_infections[-1]),
    'total_deaths':    int(cum_deaths[-1]),
    'n_agents':        2000,
    'sim_days':        len(res['timevec']),
}))