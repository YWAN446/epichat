import type { SimParams } from "@/lib/sim/params";
import type { ConfigPayload } from "./types";

/** The configuration as the configure tool reports it and the panel and the report show it. */
export function configView(params: SimParams, disease: string | null): ConfigPayload["config"] {
  return {
    disease,
    disease_type: params.disease.model,
    country: params.demographics.country,
    n_agents: params.run.n_agents,
    sim_dur_years: params.run.sim_dur_years,
    dur_inf: params.disease.dur_inf.mean_days,
    dur_exp: params.disease.dur_exp?.mean_days ?? null,
    interventions: params.interventions.map((i) => i.type),
  };
}
