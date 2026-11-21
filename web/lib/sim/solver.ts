/**
 * How a scenario runs: as agents or as a compartmental model (docs/superpowers/specs/2026-11-20-run-mode-choice-design.md).
 * The exact mirror of epichat/params/solver.py, texts included: the parity fixture compares the two on every case.
 */
import { approxR0, simDays, WANING_MODELS, type SimParams } from "./params";
import { pyRound } from "./pyformat";

export const REQUIRED_CODES = ["hybrid_network", "lasting_contacts", "poisson_contacts", "treatment_delay"] as const;
export const AGENT_CODES = ["waning", "births", "temporary_measure", "early_dieout", "replicates"] as const;
const EARLY_DIEOUT_CHANCE = 0.05;
const BIRTHS_FACTOR = 3.0;
const WANING_FACTOR = 2.5;

export type SolverReason = { code: string; text: string };
export type SolverAdvice = { recommended: "abm" | "ode"; required: boolean; reasons: SolverReason[] };

const TEXTS: Record<string, string> = {
  hybrid_network: "The hybrid network puts people in households, schools and workplaces, which only agents can represent.",
  lasting_contacts: "Contacts last for days, so who meets whom has to be followed person by person.",
  poisson_contacts: "The number of contacts varies from person to person, which only agents can represent.",
  treatment_delay: "The treatment starts some days after each person becomes infectious, which needs each person's own clock.",
  waning: "Immunity wanes within the run, so infections fall low between waves: agents can die out there, while a compartmental model always comes back.",
  births: "Births bring back enough susceptible people within the run for infections to return: agents can die out first, while a compartmental model always comes back.",
  temporary_measure: "A temporary measure holds R below 1 for a while: agents can end the outbreak, while a compartmental model always rebounds when the measure ends.",
  replicates: "Several replicates are asked for, and only agents vary from run to run.",
  same_answer: "Nothing here depends on chance, so both give the same epidemic: agents show it as individual people, a compartmental model as its exact average curve.",
};

function requiredCodes(p: SimParams): string[] {
  const n = p.network;
  const fired: Record<string, boolean> = {
    hybrid_network: n.network_type === "hybrid",
    lasting_contacts: n.network_type === "random" && n.contact_duration_days > 0,
    poisson_contacts: n.network_type === "random" && n.contacts_dist === "poisson",
    treatment_delay: p.interventions.some((i) => i.type === "treatment" && i.delay_days > 0),
  };
  return REQUIRED_CODES.filter((code) => fired[code]);
}

/** The root below 1 of s = exp(-R0 (1 - s)), 1 when R0 <= 1: the same loop as the Python. */
export function escapeRoot(r0: number): number {
  if (r0 <= 1) return 1.0;
  let s = 0.0;
  for (let k = 0; k < 10_000; k++) {
    const next = Math.exp(-r0 * (1.0 - s));
    if (Math.abs(next - s) < 1e-12) return next;
    s = next;
  }
  return s;
}

/** The chance that every seed's chain dies out: s ** n for a count, exp(-n (1 - s)) for a fraction drawn per agent. */
function dieoutChance(p: SimParams, rStart: number, seeds: number): number {
  const s = escapeRoot(rStart);
  return p.disease.seed.mode === "count" ? s ** seeds : Math.exp(-seeds * (1.0 - s));
}

function agentReasons(p: SimParams): SolverReason[] {
  const R0 = approxR0(p);
  const d = p.disease;
  const runDays = simDays(p.run.sim_dur_years);
  const rStart = R0 * (1 - d.initial_immune_frac);
  const out: string[] = [];
  if (R0 > 1 && WANING_MODELS.includes(d.model) && d.dur_immune !== null && runDays > WANING_FACTOR * d.dur_immune.mean_days) out.push("waning");
  const g = p.demographics;
  if (R0 > 1 && g.use_demographics && p.run.sim_dur_years > 1 && p.run.sim_dur_years > (BIRTHS_FACTOR * (1 / R0 - escapeRoot(R0))) / (g.birth_rate / 1000)) out.push("births");
  if (p.interventions.some((i) => (i.type === "contact_reduction" || i.type === "transmission_reduction") && i.end_day !== null && i.end_day < runDays
    && i.end_day - i.start_day >= d.dur_inf.mean_days && rStart > 1 && rStart * (1 - i.scale) < 1)) out.push("temporary_measure");
  const seeds = d.seed.mode === "count" ? d.seed.value : d.seed.value * p.run.n_agents;
  const chance = dieoutChance(p, rStart, seeds);
  if (rStart > 1 && chance >= EARLY_DIEOUT_CHANCE) out.push("early_dieout");
  if (p.run.n_replicates > 1) out.push("replicates");
  const texts: Record<string, string> = { ...TEXTS, early_dieout: `With ${pyRound(seeds)} initial infections, about ${pyRound(100 * chance)} in 100 outbreaks die out early by chance, which only agents show.` };
  return out.map((code) => ({ code, text: texts[code] }));
}

/** {recommended, required, reasons}: agents are recommended for every scenario (the owner's decision, 2026-11-20). */
export function recommendSolver(p: SimParams): SolverAdvice {
  const required = requiredCodes(p);
  if (required.length > 0) return { recommended: "abm", required: true, reasons: required.map((code) => ({ code, text: TEXTS[code] })) };
  const reasons = agentReasons(p);
  return { recommended: "abm", required: false, reasons: reasons.length > 0 ? reasons : [{ code: "same_answer", text: TEXTS.same_answer }] };
}
