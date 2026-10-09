import type { SimParams } from "@/lib/sim/params";
import type { ConfigPayload } from "./types";

/** The configuration as the configure tool reports it and the panel and the report show it. */
export function configView(params: SimParams, disease: string | null): ConfigPayload["config"] {
  return {
    disease,
    disease_type: params.disease_type,
    country: params.country,
    n_agents: params.n_agents,
    sim_dur_years: params.sim_dur_years,
    dur_inf: params.dur_inf,
    dur_exp: params.dur_exp,
    interventions: params.interventions.map((i) => i.type),
  };
}
