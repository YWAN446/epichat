import starsim as ss
import matplotlib
matplotlib.use('Agg')
import json
import numpy as np

# ── Disease parameters ────────────────────────────────────────────────────────
disease_pars = dict(
    type='sir',
    init_prev=0.01,
    beta=0.05,
    dur_inf=ss.constant(10.0),
    p_death=0.0,
)

# ── Interventions (non-vaccine) ───────────────────────────────────────────────
interventions_list = []
connectors_list = []


connectors_list.append(ss.seasonality(
    diseases='sir',
    scale=0.2,
    shift=0.1,
))



class _SimpleTreatment(ss.Intervention):
    def __init__(self, prob=1.0, max_capacity=None, start_day=0):
        super().__init__()
        self._prob = prob
        self._max_capacity = max_capacity
        self._start_day = start_day

    def step(self):
        if self.sim.ti < self._start_day:
            return
        disease = list(self.sim.diseases.values())[0]
        infected = disease.infected.uids
        if len(infected) == 0:
            return
        n = int(self._prob * len(infected))
        if self._max_capacity is not None:
            n = min(n, self._max_capacity)
        if n <= 0:
            return
        _rng = np.random.default_rng(int(self.sim.ti))
        _treat_uids = ss.uids(_rng.choice(infected, size=min(n, len(infected)), replace=False))
        if hasattr(disease, 'ti_recovered'):
            disease.ti_recovered[_treat_uids] = self.sim.ti + 1

interventions_list.append(_SimpleTreatment(
    prob=0.5,
    max_capacity=20,
    start_day=3,
))




# ── Network ───────────────────────────────────────────────────────────────────

_network = dict(type='random', n_contacts=6, beta=1.0)


# ── Simulation parameters ─────────────────────────────────────────────────────
pars = dict(
    n_agents=2000,
    networks=_network,
    diseases=disease_pars,

    dur=0.5,
    dt=1/365,

    rand_seed=7,

)

if interventions_list:
    pars['interventions'] = interventions_list

sim = ss.Sim(pars, connectors=connectors_list or None, verbose=0)
sim.init()


_sir = sim.diseases['sir']
_sus = _sir.susceptible.uids
_n_vax = int(0.3 * len(_sus))

_rng = np.random.default_rng(7)

_vax_uids = _rng.choice(_sus, size=_n_vax, replace=False) if _n_vax > 0 else np.array([], dtype=int)
_sir.susceptible[ss.uids(_vax_uids)] = False
_sir.recovered[ss.uids(_vax_uids)] = True




sim.run()

res = sim.results
dr = res[list(sim.diseases.keys())[0]]

n_infected     = dr['n_infected'].values
cum_infections = dr['cum_infections'].values
cum_deaths = res['cum_deaths'].values if 'cum_deaths' in res else np.zeros(len(res['timevec']))

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
if 'new_deaths' in _rs:
    _ax[7].plot(_days, _rs['new_deaths'].values, color='darkred')

# (2,2) Cumulative deaths
_ax[8].set_title('Cumulative deaths')
_ax[8].set_xlabel('Day')
if 'cum_deaths' in _rs:
    _ax[8].plot(_days, _rs['cum_deaths'].values, color='darkred')

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