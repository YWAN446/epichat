import { describe, expect, it, vi } from "vitest";

import { supabaseFeedbackStore } from "@/lib/db/feedback";
import { supabaseMessageStore } from "@/lib/db/messages";
import { reportRow, supabaseReportStore } from "@/lib/db/reports";
import { runRow, supabaseRunStore } from "@/lib/db/runs";
import { scenarioFromRow, scenarioToJson, supabaseScenarioStore } from "@/lib/db/scenarios";
import { supabaseTurnStore } from "@/lib/db/turns";
import { emptyScenario } from "@/lib/tools/types";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";
import { params, rf } from "../tools/helpers";

const USER = "11111111-1111-1111-1111-111111111111";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const TURN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const STATS = { peak_infections: 9, peak_day: 3, total_infected: 40, total_deaths: 0, n_agents: 1000, sim_days: 365 };

describe("message store", () => {
  it("lists the exact message list in order and surfaces a read failure", async () => {
    const rows = [{ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "text", text: "Hello" }] }];
    const { client, recorded } = fakeAdmin({ messages: [{ data: rows }] });
    expect(await supabaseMessageStore(client).list(CONVERSATION)).toEqual(rows);
    expect(callOn(recorded, "messages", "eq")).toEqual(["conversation_id", CONVERSATION]);
    expect(callOn(recorded, "messages", "order")).toEqual(["seq", { ascending: true }]);
    const failing = fakeAdmin({ messages: [{ data: null, error: { message: "down" } }] });
    await expect(supabaseMessageStore(failing.client).list(CONVERSATION)).rejects.toThrow(/down/);
  });
});

describe("scenario store", () => {
  const row = {
    id: "s1", seq: 2, params: params({ n_agents: 500 }), disease: "measles", country_iso3: "KEN", total_population: 54027487,
    data_sources: [rf("birth_rate", 0.028)], web_sources: [{ title: "WHO", url: "https://www.who.int" }], stage: "ground", stage_reached: "ground", has_run: false, has_report: false, report_current: false,
  };

  it("reads a row back as the live scenario and writes it as finish_turn expects", async () => {
    const { client, recorded } = fakeAdmin({ scenarios: [{ data: row }] });
    const scenario = await supabaseScenarioStore(client).get("s1");
    expect(scenario).toEqual({
      id: "s1", seq: 2, params: params({ n_agents: 500 }), disease: "measles", countryIso3: "KEN", totalPopulation: 54027487,
      dataSources: [rf("birth_rate", 0.028)], webSources: [{ title: "WHO", url: "https://www.who.int" }], stage: "ground", stageReached: "ground", hasRun: false, hasReport: false, reportCurrent: false,
    });
    expect(callOn(recorded, "scenarios", "eq")).toEqual(["id", "s1"]);
    expect(scenarioToJson(scenario!)).toEqual(row);
    expect(scenarioToJson(emptyScenario())).toMatchObject({ id: null, seq: 1, params: null, stage: "understand", stage_reached: "understand", has_run: false });
  });

  it("treats unparseable saved params as absent", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const scenario = scenarioFromRow({ ...row, params: { beta: "not a number" }, stage: "configure", stage_reached: null });
    expect(scenario.params).toBeNull();
    expect(scenario.stage).toBe("configure");
    expect(scenario.stageReached).toBe("configure");
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
    expect(scenarioFromRow({ ...row, stage: "later", data_sources: null }).stage).toBe("understand");
    expect(scenarioFromRow({ ...row, data_sources: null }).dataSources).toEqual([]);
  });

  it("returns null for a missing row", async () => {
    const { client } = fakeAdmin({ scenarios: [{ data: null }] });
    expect(await supabaseScenarioStore(client).get("missing")).toBeNull();
  });
});

describe("turn store", () => {
  it("calls finish_turn with the payload and returns the scenario id", async () => {
    const { client, rpcCalls } = fakeAdmin({ "rpc:finish_turn": [{ data: "s9" }] });
    const payload = { user_id: USER, conversation_id: CONVERSATION } as never;
    expect(await supabaseTurnStore(client).finishTurn(payload)).toBe("s9");
    expect(rpcCalls).toEqual([["finish_turn", { p: payload }]]);
    const failing = fakeAdmin({ "rpc:finish_turn": [{ data: null, error: { message: "boom" } }] });
    await expect(supabaseTurnStore(failing.client).finishTurn(payload)).rejects.toThrow(/boom/);
  });

  it("lists the typed texts in order", async () => {
    const { client, recorded } = fakeAdmin({ turns: [{ data: [{ user_text: "Model measles" }, { user_text: "Run it" }] }] });
    expect(await supabaseTurnStore(client).userTexts(CONVERSATION)).toEqual(["Model measles", "Run it"]);
    expect(callOn(recorded, "turns", "order")).toEqual(["seq", { ascending: true }]);
  });

  it("replays finished turns as blocks, in event order, without thinking", async () => {
    const rows = [{
      id: TURN, seq: 1, user_text: "Model measles", stop: "end_turn",
      turn_events: [
        { seq: 3, kind: "text", payload: { text: "Configured." } },
        { seq: 1, kind: "thinking", payload: { summary: "secret" } },
        { seq: 2, kind: "tool_result", payload: { id: "tu_1", name: "configure_simulation", ok: true, payload: { kind: "config" } } },
      ],
    }];
    const { client, recorded } = fakeAdmin({ turns: [{ data: rows }] });
    const turns = await supabaseTurnStore(client).listForReplay(CONVERSATION);
    expect(turns).toEqual([{
      id: TURN, seq: 1, userText: "Model measles", stop: "end_turn",
      blocks: [
        { kind: "tool_result", id: "tu_1", name: "configure_simulation", ok: true, payload: { kind: "config" } },
        { kind: "text", text: "Configured." },
      ],
    }]);
    expect(callOn(recorded, "turns", "select")).toEqual(["id, seq, user_text, stop, turn_events(seq, kind, payload)"]);
    expect(callOn(recorded, "turns", "in")).toEqual(["stop", ["end_turn", "max_tokens"]]);
    expect(JSON.stringify(turns)).not.toContain("secret");
  });
});

describe("run store", () => {
  const success = {
    ok: true as const, effective_params: params({ n_agents: 1000 }), population: 2500, stats: STATS, stats_agents: STATS, series: { day: [0] },
    pop_scale: 2.5, repairs: [], attempts: 1, duration_ms: 900, cold_start: true, starsim_version: "3.3.2",
  };
  const record = { params: params({ n_agents: 1000 }), popScale: 2.5, warnings: ["w"], dataSources: [rf("birth_rate", 0.028)], result: success };
  const insert = { conversationId: CONVERSATION, userId: USER, turnId: TURN, scenarioId: null, record };

  it("maps a success and a failure to the runs columns and returns the new id", async () => {
    const { client, recorded } = fakeAdmin({ runs: [{ data: { id: "r1" } }] });
    expect(await supabaseRunStore(client).insert(insert)).toBe("r1");
    expect(callOn(recorded, "runs", "insert")).toEqual([runRow(insert)]);
    expect(runRow({ ...insert, scenarioId: "s1" })).toMatchObject({
      conversation_id: CONVERSATION, user_id: USER, turn_id: TURN, scenario_id: "s1", params: params({ n_agents: 1000 }), pop_scale: 2.5,
      stats: STATS, stats_agents: STATS, series: { day: [0] }, duration_ms: 900, sim_cold_start: true, error: null, warnings: ["w"], data_sources: [rf("birth_rate", 0.028)], repairs: [],
    });
    const failed = { ...record, result: { ok: false as const, status: 504, kind: "timeout" as const, detail: "The simulation timed out after 120 seconds.", repairs: [], attempts: 2, seconds: 120 } };
    expect(runRow({ ...insert, record: failed })).toMatchObject({
      effective_params: null, stats: null, stats_agents: null, series: null, duration_ms: null, sim_cold_start: null,
      error: { kind: "timeout", detail: "The simulation timed out after 120 seconds.", status: 504, attempts: 2 },
    });
  });

  it("surfaces an insert failure as an error for onRun to swallow", async () => {
    const { client } = fakeAdmin({ runs: [{ data: null, error: { message: "down" } }] });
    await expect(supabaseRunStore(client).insert(insert)).rejects.toThrow(/down/);
  });
});

describe("feedback store", () => {
  it("checks that the turn is in the conversation and inserts one row per press", async () => {
    const { client, recorded } = fakeAdmin({ turns: [{ data: { id: TURN } }, { data: null }] });
    const store = supabaseFeedbackStore(client);
    expect(await store.turnBelongs(TURN, CONVERSATION)).toBe(true);
    expect(recorded[0].calls).toEqual([["select", ["id"]], ["eq", ["id", TURN]], ["eq", ["conversation_id", CONVERSATION]], ["maybeSingle", []]]);
    expect(await store.turnBelongs(TURN, CONVERSATION)).toBe(false);
    await store.insert({ userId: USER, conversationId: CONVERSATION, turnId: TURN, rating: "down", comment: "Too slow" });
    expect(callOn(recorded, "feedback", "insert")).toEqual([{ user_id: USER, conversation_id: CONVERSATION, turn_id: TURN, rating: "down", comment: "Too slow" }]);
    const failing = fakeAdmin({ feedback: [{ data: null, error: { message: "down" } }] });
    await expect(supabaseFeedbackStore(failing.client).insert({ userId: USER, conversationId: CONVERSATION, turnId: TURN, rating: "up", comment: null })).rejects.toThrow(/down/);
  });
});

describe("scenario report flags", () => {
  it("carries the report flags both ways", () => {
    const s = { ...emptyScenario(), hasReport: true, reportCurrent: true, stage: "report" as const, stageReached: "report" as const };
    const json = scenarioToJson(s);
    expect(json).toMatchObject({ has_report: true, report_current: true, stage: "report" });
    expect(scenarioFromRow({ ...json, id: "s1" })).toMatchObject({ hasReport: true, reportCurrent: true, stage: "report", stageReached: "report" });
    expect(scenarioFromRow({ ...scenarioToJson(emptyScenario()), id: "s2" })).toMatchObject({ hasReport: false, reportCurrent: false });
  });
});

describe("report store and the report reads", () => {
  const INSERT = { conversationId: "c1", userId: "u1", turnId: "t1", scenarioId: null, version: 2, title: "Measles in Kenya", language: "en", narrative: { summary: "s", meaning: "m", limitations: "l", next_steps: "n" }, document: { version: 1 as const, title: "Measles in Kenya", subtitle: "", generatedAt: "", language: "en", sections: [] } };

  it("inserts a version, counts, and reads one back", async () => {
    const admin = fakeAdmin({ reports: [{ data: { id: "r1" } }, { count: 2 }, { data: { id: "r1", user_id: "u1", conversation_id: "c1", version: 2, title: "T", document: INSERT.document } }] });
    const store = supabaseReportStore(admin.client);
    expect(await store.insert(INSERT)).toBe("r1");
    expect(callOn(admin.recorded, "reports", "insert")).toEqual([reportRow(INSERT)]);
    expect(reportRow(INSERT)).toMatchObject({ conversation_id: "c1", user_id: "u1", turn_id: "t1", scenario_id: null, version: 2, title: "Measles in Kenya", language: "en" });
    expect(await store.count("c1")).toBe(2);
    expect(await store.get("r1")).toMatchObject({ id: "r1", version: 2 });
  });

  it("lists the scenario's successful runs plus this turn's unlinked ones, oldest first", async () => {
    const row = (id: string, scenario_id: string | null, turn_id: string) => ({ id, created_at: `2026-10-09T0${id.at(-1)}:00:00Z`, scenario_id, turn_id, effective_params: {}, stats: {}, stats_agents: {}, pop_scale: 2, series: { day: [0] }, repairs: [], warnings: [], data_sources: [] });
    const admin = fakeAdmin({ runs: [{ data: [row("run-1", "s1", "t1"), row("run-2", "s0", "t0"), row("run-3", null, "t9"), row("run-4", null, "t2")] }] });
    const runs = await supabaseRunStore(admin.client).listForReport("c1", "s1", "t9");
    expect(runs.map((r) => r.id)).toEqual(["run-1", "run-3"]);
    expect(runs[0]).toMatchObject({ popScale: 2, series: { day: [0] }, repairs: [], warnings: [], dataSources: [] });
    expect(callOn(admin.recorded, "runs", "eq")).toEqual(["conversation_id", "c1"]);
    expect(callOn(admin.recorded, "runs", "is")).toEqual(["error", null]);
  });

  it("reads the latest finished turn's recap", async () => {
    const admin = fakeAdmin({ turns: [{ data: { id: "t2", turn_events: [{ kind: "text", payload: { text: "hi" } }, { kind: "recap", payload: { items: ["Measles in Kenya", "Run 1 done"] } }] } }] });
    expect(await supabaseTurnStore(admin.client).lastRecap("c1")).toEqual(["Measles in Kenya", "Run 1 done"]);
    expect(await supabaseTurnStore(fakeAdmin({ turns: [{ data: null }] }).client).lastRecap("c1")).toEqual([]);
  });
});
