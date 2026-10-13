"""ParamSpec entries: the single source of truth for every simulation parameter
(spec 5.1). schema_v2 generates its bounds and defaults from this module and
scripts/export_web_data.py writes it to web/data/param_registry.json for the
TypeScript side. Registry order is the order describe_parameters lists."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

Module = Literal["disease", "network", "demographics", "interventions", "run"]
Kind = Literal["number", "integer", "bool", "enum", "string"]
Tier = Literal["core", "advanced", "expert"]
Affects = Literal["timing", "peak", "final_size", "deaths", "duration", "endemicity", "stochasticity"]

MODELS = ("sir", "seir", "sis", "sirs", "seirs", "seiar")
LATENT_MODELS = ("seir", "seirs", "seiar")
WANING_MODELS = ("sirs", "seirs")
DEATH_MODELS = ("sir", "seir", "sirs", "seirs", "seiar")
DISTS = ("constant", "lognormal", "gamma")
DB_FIELDS = ("r0", "incubation_days", "infectious_days", "fatality_rate",
             "average_contacts_daily", "immunity_duration", "asymptomatic_fraction")
CONTACT_GROUPS = ("children", "adults", "elderly")
GROUP_LABELS = {"children": "children (under 18)", "adults": "adults (18 to 64)", "elderly": "elderly (65 and over)"}
CONTACT_DEFAULTS = ((7.0, 2.5, 0.5), (2.5, 9.0, 1.5), (0.5, 1.5, 3.5))     # POLYMOD-like; rows source, columns target (Part 2, 5.3)
ALL_EFFECTS: tuple[Affects, ...] = ("timing", "peak", "final_size", "deaths", "duration", "endemicity", "stochasticity")


@dataclass(frozen=True)
class ParamSpec:
    path: str
    module: Module
    label: str
    description: str
    kind: Kind
    unit: str | None
    default: Any
    bounds: tuple[float, float] | None
    choices: tuple[str, ...] | None
    models: tuple[str, ...]
    tier: Tier
    db_field: str | None
    starsim_target: str
    affects: tuple[Affects, ...]
    requires: tuple[str, ...] = field(default=())

    def applies_to(self, model: str) -> bool:
        return not self.models or model in self.models

    def as_dict(self) -> dict:
        return {
            "path": self.path, "module": self.module, "label": self.label, "description": self.description,
            "kind": self.kind, "unit": self.unit, "default": self.default,
            "bounds": list(self.bounds) if self.bounds is not None else None,
            "choices": list(self.choices) if self.choices is not None else None,
            "models": list(self.models), "tier": self.tier, "db_field": self.db_field,
            "starsim_target": self.starsim_target, "affects": list(self.affects), "requires": list(self.requires),
        }


def _duration(name: str, label: str, models: tuple[str, ...], default_mean: float | None, mean_bounds: tuple[float, float],
              sd_bounds: tuple[float, float], db_field: str, target: str, affects: tuple[Affects, ...], about: str) -> list[ParamSpec]:
    base = f"disease.{name}"
    return [
        ParamSpec(f"{base}.mean_days", "disease", f"{label} (mean)", about, "number", "days", default_mean, mean_bounds, None,
                  models, "core", db_field, target, affects),
        ParamSpec(f"{base}.dist", "disease", f"{label} (distribution)",
                  "How the period varies between people: constant (everyone the same), gamma or lognormal (needs sd_days). "
                  "Migrated scenarios are constant; new scenarios use gamma with an illustrative sd.",
                  "enum", None, "constant", None, DISTS, models, "advanced", None, target, affects, (f"{base}.sd_days",)),
        ParamSpec(f"{base}.sd_days", "disease", f"{label} (sd)",
                  "Standard deviation of the period between people, in days; at most twice the mean. Realized periods are "
                  "about half a day longer than configured because transitions happen on whole days.",
                  "number", "days", None, sd_bounds, None, models, "advanced", None, target, affects),
    ]


REGISTRY: tuple[ParamSpec, ...] = tuple([
    ParamSpec("disease.model", "disease", "Model", "Which compartments the disease has: sir, seir (latent period), sis (no lasting immunity), "
              "sirs and seirs (immunity wanes), seiar (an asymptomatic track).", "enum", None, "sir", None, MODELS, (), "core", None,
              "ss.SIR, ss.SEIR, ss.SIS and the EpiChat subclasses in epichat/sim/models.py", ALL_EFFECTS),
    ParamSpec("disease.beta", "disease", "Transmission rate", "Per-contact transmission rate per year; the configure tool sets it from R0. "
              "Starsim turns it into a daily probability 1 - exp(-beta / 365).", "number", "per year", 22.8125, (0.001, 1000.0), None, (),
              "advanced", None, "disease.pars.beta = ss.peryear(beta)", ("peak", "final_size")),
    *_duration("dur_exp", "Latent period", LATENT_MODELS, None, (0.1, 1000.0), (0.01, 2000.0), "incubation_days", "ss.SEIR(dur_exp=...)", ("timing",),
               "Days between infection and becoming infectious. Required for seir, seirs and seiar; the database incubation period is the usual source."),
    *_duration("dur_inf", "Infectious period", (), 10.0, (0.5, 365.0), (0.01, 730.0), "infectious_days", "ss.SIR(dur_inf=...)", ("peak", "final_size", "timing"),
               "Days an infected person transmits. The database infectious period is the usual source."),
    *_duration("dur_immune", "Immunity duration", WANING_MODELS, None, (7.0, 36500.0), (0.1, 73000.0), "immunity_duration", "EpiChat SIRS/SEIRS dur_immune",
               ("endemicity",), "Days of immunity after recovery before a person can be infected again. Required for sirs and seirs."),
    ParamSpec("disease.p_death", "disease", "Case fatality ratio", "Share of cases that die at the end of the infectious period. In seiar only "
              "symptomatic infections are cases; in the other models every infection is, so a surveillance CFR overstates deaths for "
              "diseases with many mild or unreported infections. Surveillance CFRs also carry their own biases.", "number", "fraction", 0.0,
              (0.0, 1.0), None, DEATH_MODELS, "core", "fatality_rate", "ss.bernoulli(p=p_death) drawn at infection", ("deaths",)),
    ParamSpec("disease.p_asymp", "disease", "Asymptomatic share", "Share of infections that never show symptoms; they still transmit, at "
              "rel_trans_asymp of a symptomatic case, and never die of the disease.", "number", "fraction", 0.3, (0.0, 1.0), None, ("seiar",),
              "core", "asymptomatic_fraction", "SEIAR p_asymp = ss.bernoulli(p=...)", ("peak", "final_size")),
    ParamSpec("disease.rel_trans_asymp", "disease", "Asymptomatic transmissibility", "Transmissibility of an asymptomatic infection relative "
              "to a symptomatic one.", "number", "fraction", 0.5, (0.0, 1.0), None, ("seiar",), "advanced", None,
              "SEIAR rel_trans_base for asymptomatic agents", ("peak", "final_size")),
    *[ParamSpec(f"disease.rel_sus_age.{group}", "disease", f"Susceptibility, {label}",
                f"Multiplier on the susceptibility of {label} (1 leaves it as it is). Applies through the agents' ages, so "
                "fetch the demographics first for the elderly to exist; an illustrative assumption unless the database carries it.",
                "number", "multiplier", 1.0, (0.0, 10.0), None, (), "advanced", None,
                "rel_sus_base of the agents in the group, composed by the TransmissionModifiers connector", ("peak", "final_size"))
      for group, label in (("children", "children (under 18)"), ("adults", "adults (18 to 64)"), ("elderly", "the elderly (65 and over)"))],
    *[ParamSpec(f"disease.p_death_age.{group}", "disease", f"Case fatality ratio, {label}",
                f"Share of cases among {label} that die; unset means the overall p_death. An illustrative assumption until the "
                "database carries fatality by age.",
                "number", "fraction", None, (0.0, 1.0), None, DEATH_MODELS, "advanced", None,
                "the per-agent death draw (ss.bernoulli with an age-dependent probability)", ("deaths",))
      for group, label in (("children", "children (under 18)"), ("adults", "adults (18 to 64)"), ("elderly", "the elderly (65 and over)"))],
    ParamSpec("disease.rel_trans_exposed", "disease", "Presymptomatic transmissibility",
              "Transmissibility of an agent in the latent period as a fraction of the infectious value; 0 means no transmission "
              "before symptoms. Raises the effective infectious days the R0 formula uses.",
              "number", "fraction", 0.0, (0.0, 1.0), None, LATENT_MODELS, "advanced", None,
              "rel_trans_base of exposed agents, who become transmission sources", ("peak", "timing")),
    ParamSpec("disease.sis_waning", "disease", "Immunity waning (sis)", "Rate per year at which immunity after an sis infection decays; 0 "
              "reproduces the classic SIS with no immunity.", "number", "per year", 0.0, (0.0, 52.0), None, ("sis",), "advanced", None,
              "ss.SIS(waning=ss.peryear(...))", ("endemicity",)),
    ParamSpec("disease.sis_imm_boost", "disease", "Immunity boost (sis)", "How much immunity an sis infection adds (0 to 1); 0 means none.",
              "number", None, 0.0, (0.0, 1.0), None, ("sis",), "advanced", None, "ss.SIS(imm_boost=...)", ("endemicity",)),
    ParamSpec("disease.seed.mode", "disease", "Seeding mode", "fraction: each agent starts infected with probability value; count: exactly "
              "value agents start infected.", "enum", None, "fraction", None, ("fraction", "count"), (), "advanced", None,
              "init_prev = ss.bernoulli or ss.choose_n", ("stochasticity",)),
    ParamSpec("disease.seed.value", "disease", "Seed size", "A fraction between 0 and 1 (mode fraction) or a whole number of agents from 1 "
              "to n_agents (mode count).", "number", None, 0.01, (0.0, 1_000_000.0), None, (), "core", None,
              "init_prev, or SeedInfections when day > 0", ("timing", "stochasticity")),
    ParamSpec("disease.seed.day", "disease", "Seeding day", "Day the seed infections happen; 0 means at the start.", "integer", "days", 0,
              (0, 7300), None, (), "advanced", None, "SeedInfections intervention", ("timing",)),
    ParamSpec("disease.initial_immune_frac", "disease", "Initially immune", "Share of the non-seeded population that starts immune (a past "
              "epidemic or a vaccination campaign before day 0). In sirs and seirs this immunity wanes like everyone else's; in sis at "
              "sis_waning.", "number", "fraction", 0.0, (0.0, 0.99), None, (), "advanced", None, "InitialImmunity intervention", ("final_size",)),
    ParamSpec("network.network_type", "network", "Contact network", "random: everyone has n_contacts fresh random contacts a day; "
              "age_structured: three age groups mixing by a contact matrix (POLYMOD-like by default, the country's Prem 2021 matrix after "
              "fetch_demographics); hybrid: households, schools, workplaces and community as in Covasim, the structure layer interventions "
              "act on. At the same R0 the final size is close on every network.", "enum", None, "random", None,
              ("random", "age_structured", "hybrid"), (), "core", None,
              "ss.RandomNet, ss.MixingPools or ss.HybridNet", ("peak", "final_size")),
    ParamSpec("network.n_contacts", "network", "Contacts per day", "Mean number of contacts per person per day on the random network; "
              "no effect on the age-structured and hybrid networks.", "integer", "per day", 4, (1, 100), None, (), "core", "average_contacts_daily",
              "ss.RandomNet(n_contacts=...)", ("peak", "final_size")),
    ParamSpec("network.contacts_dist", "network", "Contacts distribution", "constant: everyone has exactly n_contacts a day; poisson: the daily "
              "number varies around n_contacts. Random network only; the R0 is unchanged.", "enum", None, "constant", None,
              ("constant", "poisson"), (), "advanced", None, "ss.RandomNet(n_contacts=ss.constant or ss.poisson)", ("stochasticity",)),
    ParamSpec("network.contact_duration_days", "network", "Contact duration", "Days a random-network contact lasts before it is replaced; 0 "
              "remakes every contact daily. Longer contacts slow spread by local depletion, so the R0 shown is approximate and the measured R0 "
              "is the one to quote.", "number", "days", 0.0, (0.0, 365.0), None, (), "advanced", None, "ss.RandomNet(dur=ss.days(...))",
              ("peak", "final_size")),
    ParamSpec("network.network_beta", "network", "Network transmission multiplier", "Multiplies the per-contact probability on the network; "
              "1 leaves beta as it is.", "number", None, 1.0, (0.01, 10.0), None, (), "advanced", None,
              "ss.RandomNet(beta=...) or the mixing matrix scale", ("peak", "final_size")),
    *[ParamSpec(f"network.contacts.{s}_{t}", "network", f"Contacts, {GROUP_LABELS[s]} to {GROUP_LABELS[t]}",
                f"Contacts per day a target among the {GROUP_LABELS[t]} has with sources among the {GROUP_LABELS[s]} on the age-structured "
                "network (rows source, columns target; POLYMOD-like default, the country's Prem 2021 value after fetch_demographics).",
                "number", "per day", CONTACT_DEFAULTS[i][j], (0.0, 50.0), None, (), "advanced", None, "ss.MixingPools(n_contacts=...)",
                ("peak", "final_size"))
      for i, s in enumerate(CONTACT_GROUPS) for j, t in enumerate(CONTACT_GROUPS)],
    ParamSpec("network.contacts_source", "network", "Contact matrix source", "Where the contact matrix came from: polymod_default (European), "
              "prem_2021:<ISO3> (the country's synthetic matrix) or user.", "string", None, "polymod_default", None, None, (), "expert", None,
              "fetch_demographics", ()),
    ParamSpec("network.household_size", "network", "Household size", "Mean household size on the hybrid network (Poisson); the country's value "
              "after fetch_demographics.", "number", "people", 2.0, (1.0, 10.0), None, (), "core", None,
              "ss.HybridNet(household_size=ss.poisson(...))", ("peak", "final_size")),
    ParamSpec("network.school_contacts", "network", "School contacts", "Mean daily contacts in the school layer of the hybrid network "
              "(Covasim's value, illustrative).", "integer", "per day", 20, (0, 100), None, (), "advanced", None,
              "ss.HybridNet(contacts=dict(s=...))", ("peak", "final_size")),
    ParamSpec("network.work_contacts", "network", "Workplace contacts", "Mean daily contacts in the workplace layer of the hybrid network "
              "(Covasim's value, illustrative).", "integer", "per day", 16, (0, 100), None, (), "advanced", None,
              "ss.HybridNet(contacts=dict(w=...))", ("peak", "final_size")),
    ParamSpec("network.community_contacts", "network", "Community contacts", "Mean daily contacts in the community layer of the hybrid network "
              "(Covasim's value, illustrative).", "integer", "per day", 20, (0, 100), None, (), "advanced", None,
              "ss.HybridNet(contacts=dict(c=...))", ("peak", "final_size")),
    ParamSpec("network.layer_beta.household", "network", "Household transmissibility", "Relative transmissibility of a household contact on the "
              "hybrid network (Covasim's value, illustrative).", "number", "multiplier", 3.0, (0.0, 10.0), None, (), "advanced", None,
              "ss.HybridNet(beta=dict(h=...))", ("peak", "final_size")),
    ParamSpec("network.layer_beta.school", "network", "School transmissibility", "Relative transmissibility of a school contact on the hybrid "
              "network (Covasim's value, illustrative).", "number", "multiplier", 0.6, (0.0, 10.0), None, (), "advanced", None,
              "ss.HybridNet(beta=dict(s=...))", ("peak", "final_size")),
    ParamSpec("network.layer_beta.work", "network", "Workplace transmissibility", "Relative transmissibility of a workplace contact on the hybrid "
              "network (Covasim's value, illustrative).", "number", "multiplier", 0.6, (0.0, 10.0), None, (), "advanced", None,
              "ss.HybridNet(beta=dict(w=...))", ("peak", "final_size")),
    ParamSpec("network.layer_beta.community", "network", "Community transmissibility", "Relative transmissibility of a community contact on the "
              "hybrid network (Covasim's value, illustrative).", "number", "multiplier", 0.3, (0.0, 10.0), None, (), "advanced", None,
              "ss.HybridNet(beta=dict(c=...))", ("peak", "final_size")),
    ParamSpec("network.school_age_min", "network", "School age, from", "Youngest age in the school layer of the hybrid network.", "integer",
              "years", 6, (0, 100), None, (), "advanced", None, "ss.HybridNet(school_ages=...)", ("peak",)),
    ParamSpec("network.school_age_max", "network", "School age, to", "Age at which agents leave the school layer (excluded).", "integer",
              "years", 22, (0, 100), None, (), "advanced", None, "ss.HybridNet(school_ages=...)", ("peak",)),
    ParamSpec("network.work_age_min", "network", "Working age, from", "Youngest age in the workplace layer of the hybrid network.", "integer",
              "years", 22, (0, 100), None, (), "advanced", None, "ss.HybridNet(work_ages=...)", ("peak",)),
    ParamSpec("network.work_age_max", "network", "Working age, to", "Age at which agents leave the workplace layer (excluded).", "integer",
              "years", 65, (0, 100), None, (), "advanced", None, "ss.HybridNet(work_ages=...)", ("peak",)),
    ParamSpec("demographics.use_demographics", "demographics", "Births and deaths", "Whether people are born and die of other causes "
              "during the run.", "bool", None, False, None, None, (), "core", None, "ss.Births and ss.Deaths", ("endemicity",)),
    ParamSpec("demographics.birth_rate", "demographics", "Birth rate", "Births per 1,000 people per year.", "number", "per 1,000 per year",
              20.0, (0.1, 1000.0), None, (), "advanced", None, "ss.Births(birth_rate=ss.peryear(...))", ("endemicity",)),
    ParamSpec("demographics.death_rate", "demographics", "Death rate", "Deaths from other causes per 1,000 people per year.", "number",
              "per 1,000 per year", 10.0, (0.1, 1000.0), None, (), "advanced", None, "ss.Deaths(death_rate=ss.peryear(...))", ("endemicity",)),
    ParamSpec("demographics.age_pct_under18", "demographics", "Share under 18", "Percent of the population aged 0 to 17; with the other two "
              "shares it assigns ages on the age-structured network.", "number", "percent", None, (0.0, 100.0), None, (), "advanced", None,
              "age assignment after sim.init()", ("peak", "final_size")),
    ParamSpec("demographics.age_pct_18_64", "demographics", "Share 18 to 64", "Percent of the population aged 18 to 64.", "number", "percent",
              None, (0.0, 100.0), None, (), "advanced", None, "age assignment after sim.init()", ("peak", "final_size")),
    ParamSpec("demographics.age_pct_over65", "demographics", "Share 65 and over", "Percent of the population aged 65 or more.", "number",
              "percent", None, (0.0, 100.0), None, (), "advanced", None, "age assignment after sim.init()", ("peak", "final_size")),
    ParamSpec("demographics.country", "demographics", "Country", "ISO3 code of the country whose demographics are used.", "string", None,
              None, None, None, (), "core", None, "resolve_demographics", ("endemicity",)),
    ParamSpec("demographics.auto_demographics", "demographics", "Fill demographics from the country", "Whether the service fills birth "
              "and death rates and contacts from country data when they are still at their defaults.", "bool", None, True, None, None, (),
              "expert", None, "resolve_demographics", ("endemicity",)),
    ParamSpec("demographics.demographics_year", "demographics", "Demographics year", "Year of the country data used.", "integer", "year",
              2022, (1950, 2100), None, (), "expert", None, "resolve_demographics", ("endemicity",)),
    ParamSpec("demographics.demographics_source", "demographics", "Demographics source", "Where the filled demographics came from.",
              "string", None, None, None, None, (), "expert", None, "resolve_demographics", ()),
    ParamSpec("demographics.age_source", "demographics", "Age source", "Where the simulated ages come from: default (Starsim's uniform 0 to "
              "60), shares (uniform ages within the three shares) or un_wpp (the country's single-year age pyramid, bundled from UN WPP 2024).",
              "enum", None, "default", None, ("default", "shares", "un_wpp"), (), "expert", None, "ss.People(age_data=...)",
              ("peak", "final_size", "deaths")),
    ParamSpec("interventions[].type", "interventions", "Intervention type", "vaccine (routine or campaign, with efficacy, age range and "
              "waning), treatment (capacity-limited, with a delay and an efficacy), seasonality (a yearly cycle in transmission), "
              "contact_reduction (a layer's contacts scaled over a window: school closure, distancing), transmission_reduction (every "
              "contact's transmissibility scaled over a window: masks).", "enum", None, None, None,
              ("vaccine", "treatment", "seasonality", "contact_reduction", "transmission_reduction"), (), "core", None,
              "ss.routine_vx, TreatmentDelivery, TransmissionModifiers, ContactReduction", ("peak", "final_size", "timing")),
    ParamSpec("interventions[].coverage", "interventions", "Coverage", "Vaccine: yearly probability each susceptible person is vaccinated; "
              "treatment: share of infectious people treated each day.", "number", "fraction", None, (0.0, 1.0), None, (), "core", None,
              "ss.routine_vx(prob=...) or SimpleTreatment(prob=...)", ("peak", "final_size")),
    ParamSpec("interventions[].start_day", "interventions", "Start day", "Day the intervention begins. A vaccine starting on day 0 is "
              "stored as disease.initial_immune_frac instead.", "integer", "days", 0, (0, 7300), None, (), "core", None,
              "ss.routine_vx(start_year=start_day / 365)", ("timing",)),
    ParamSpec("interventions[].capacity", "interventions", "Treatment capacity", "Most people treated per day.", "integer", "agents per day",
              None, (1, 1_000_000), None, (), "core", None, "SimpleTreatment(max_capacity=...)", ("peak", "final_size")),
    ParamSpec("interventions[].scale", "interventions", "Scale", "Seasonality: size of the yearly cycle (0.2 means transmission moves "
              "between 80% and 120% of beta); contact_reduction and transmission_reduction: the fraction removed over the window (0.3 "
              "keeps 70%; 1 removes everything).", "number", None, 0.2, (0.0, 1.0), None, (), "core", None,
              "TransmissionModifiers or ContactReduction", ("timing", "peak", "final_size")),
    ParamSpec("interventions[].shift", "interventions", "Seasonal shift", "Fraction of a year by which the cycle is shifted.", "number",
              None, 0.0, (0.0, 1.0), None, (), "advanced", None, "TransmissibilityModifiers", ("timing",)),
    ParamSpec("interventions[].end_day", "interventions", "End day", "Day the intervention ends; unset means the run's end.", "integer",
              "days", None, (0, 7300), None, (), "core", None, "ss.routine_vx(end_year=...), the window of a reduction", ("timing",)),
    ParamSpec("interventions[].kind", "interventions", "Vaccine delivery", "routine: coverage is the yearly probability each eligible "
              "person is vaccinated; campaign: the coverage is reached uniformly over the window.", "enum", None, "routine", None,
              ("routine", "campaign"), (), "advanced", None, "ss.routine_vx(prob=..., annual_prob=...)", ("timing", "final_size")),
    ParamSpec("interventions[].efficacy", "interventions", "Efficacy", "Vaccine: protection against infection, 1 means full; treatment: "
              "the share of treated cases cured. Illustrative unless the database carries it.", "number", "fraction", 1.0, (0.0, 1.0),
              None, (), "advanced", None, "Vaccine(efficacy=...) or Treatment(efficacy=...)", ("final_size", "peak")),
    ParamSpec("interventions[].leaky", "interventions", "Leaky protection", "true: every recipient keeps 1 - efficacy of their "
              "susceptibility; false: a share efficacy of recipients is fully protected.", "bool", None, True, None, None, (), "expert",
              None, "Vaccine(leaky=...)", ("final_size",)),
    ParamSpec("interventions[].age_min", "interventions", "Vaccine age, from", "Youngest age vaccinated; unset means everyone.", "integer",
              "years", None, (0, 120), None, (), "advanced", None, "ss.routine_vx(eligibility=...)", ("final_size",)),
    ParamSpec("interventions[].age_max", "interventions", "Vaccine age, to", "Age at which vaccination stops (excluded); unset means "
              "everyone.", "integer", "years", None, (0, 120), None, (), "advanced", None, "ss.routine_vx(eligibility=...)", ("final_size",)),
    ParamSpec("interventions[].protection_days", "interventions", "Protection duration", "Days the vaccine's protection lasts; unset means "
              "permanent.", "integer", "days", None, (1, 36500), None, (), "advanced", None, "Vaccine(protection_days=...)", ("final_size",)),
    ParamSpec("interventions[].delay_days", "interventions", "Treatment delay", "Days after becoming infectious before treatment can "
              "start.", "integer", "days", 0, (0, 365), None, (), "advanced", None, "TreatmentDelivery(delay_days=...)", ("peak", "final_size")),
    ParamSpec("interventions[].rel_trans_treated", "interventions", "Transmissibility while waiting", "Relative transmissibility of an "
              "agent waiting for treatment (0.5 halves it).", "number", "multiplier", 1.0, (0.0, 1.0), None, (), "advanced", None,
              "TreatmentDelivery(rel_trans_treated=...)", ("peak", "final_size")),
    ParamSpec("interventions[].symptomatic_only", "interventions", "Treat symptomatic only", "seiar: leave asymptomatic agents untreated.",
              "bool", None, False, None, None, ("seiar",), "advanced", None, "TreatmentDelivery(symptomatic_only=...)", ("final_size",)),
    ParamSpec("interventions[].layer", "interventions", "Layer", "Which hybrid layer a contact reduction scales: household, school, work, "
              "community, or all; the random and age-structured networks take all only.", "enum", None, "all", None,
              ("all", "household", "school", "work", "community"), (), "core", None, "ContactReduction(layer=...)", ("peak", "final_size")),
    ParamSpec("run.n_agents", "run", "Agents", "Number of simulated people; results scale to the real population.", "integer", None, 10000,
              (10, 1_000_000), None, (), "core", None, "ss.Sim(n_agents=...)", ("stochasticity",)),
    ParamSpec("run.sim_dur_years", "run", "Duration", "Length of the run in years.", "number", "years", 1.0, (0.01, 20.0), None, (), "core",
              None, "ss.Sim(dur=ss.days(round(365 * years)))", ("duration",)),
    ParamSpec("run.n_replicates", "run", "Replicates", "How many seeds to run; the result shows the median run with 10 to 90% bands.",
              "integer", None, 1, (1, 5), None, (), "advanced", None, "run_replicates", ("stochasticity",)),
    ParamSpec("run.rand_seed", "run", "Random seed", "Seed of the first replicate; unset means 1.", "integer", None, None, None, None, (),
              "expert", None, "ss.Sim(rand_seed=...)", ("stochasticity",)),
    ParamSpec("run.calibrate_r0", "run", "Calibrate beta by measurement", "On the hybrid network, or with a contact duration above 0, the R0 "
              "formula is approximate: a short pilot in which only the seeds transmit measures R0 and corrects beta until the measurement is "
              "within 5% of the target (or within its own standard error when that is larger), at most three times. Off, the formula's "
              "beta runs as it is.", "bool", None, True, None, None, (),
              "advanced", None, "epichat.sim.calibrate", ("peak", "final_size")),
    ParamSpec("run.fit.target", "run", "Fit target", "The outcome the run is fitted to: attack_rate (share infected), peak_day or "
              "peak_infections (in agents).", "enum", None, None, None, ("attack_rate", "peak_day", "peak_infections"), (), "advanced",
              None, "epichat.sim.fit", ("peak", "final_size", "timing")),
    ParamSpec("run.fit.value", "run", "Fit value", "The value to reach: a fraction for attack_rate, a day for peak_day, agents for "
              "peak_infections.", "number", None, None, (0.0, 1_000_000.0), None, (), "advanced", None, "epichat.sim.fit",
              ("peak", "final_size", "timing")),
    ParamSpec("run.fit.lever", "run", "Fit lever", "The parameter the fit moves within its bounds: disease.beta or network.network_beta.",
              "enum", None, "disease.beta", None, ("disease.beta", "network.network_beta"), (), "advanced", None, "epichat.sim.fit", ("peak",)),
])

REGISTRY_BY_PATH: dict[str, ParamSpec] = {s.path: s for s in REGISTRY}


def spec_for(path: str) -> ParamSpec:
    return REGISTRY_BY_PATH[path]


def applicable(model: str) -> tuple[ParamSpec, ...]:
    return tuple(s for s in REGISTRY if s.applies_to(model))


def export() -> dict:
    return {"version": 4, "params": [s.as_dict() for s in REGISTRY]}
