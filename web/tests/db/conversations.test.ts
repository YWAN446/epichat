import { describe, expect, it } from "vitest";

import { listConversations, supabaseConversationStore, titleFrom } from "@/lib/db/conversations";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = "11111111-1111-1111-1111-111111111111";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";

describe("listConversations", () => {
  it("lists the user's undeleted conversations, newest first, mapped to summaries", async () => {
    const { client, recorded } = fakeAdmin({
      conversations: [{ data: [{ id: "c1", title: "Measles in Kenya", updated_at: "2026-10-07T10:00:00Z" }] }],
    });
    expect(await listConversations(client, USER)).toEqual([{ id: "c1", title: "Measles in Kenya", updatedAt: "2026-10-07T10:00:00Z" }]);
    expect(callOn(recorded, "conversations", "eq")).toEqual(["user_id", USER]);
    expect(callOn(recorded, "conversations", "is")).toEqual(["deleted_at", null]);
    expect(callOn(recorded, "conversations", "order")).toEqual(["updated_at", { ascending: false }]);
    expect(callOn(recorded, "conversations", "limit")).toEqual([50]);
  });

  it("returns an empty list when the table cannot be read, so the page still opens", async () => {
    const { client } = fakeAdmin({ conversations: [{ data: null, error: { message: "down" } }] });
    expect(await listConversations(client, USER)).toEqual([]);
  });
});

describe("conversation store", () => {
  it("creates a conversation and returns its id", async () => {
    const { client, recorded } = fakeAdmin({ conversations: [{ data: { id: CONVERSATION } }] });
    expect(await supabaseConversationStore(client).create(USER, "Measles in Kenya")).toBe(CONVERSATION);
    expect(callOn(recorded, "conversations", "insert")).toEqual([{ user_id: USER, title: "Measles in Kenya" }]);
    const failing = fakeAdmin({ conversations: [{ data: null, error: { message: "down" } }] });
    await expect(supabaseConversationStore(failing.client).create(USER, "x")).rejects.toThrow(/down/);
  });

  it("reads only the caller's undeleted conversation", async () => {
    const { client, recorded } = fakeAdmin({ conversations: [{ data: { id: CONVERSATION, title: "T", active_scenario_id: "s1" } }, { data: null }] });
    const store = supabaseConversationStore(client);
    expect(await store.get(CONVERSATION, USER)).toEqual({ id: CONVERSATION, title: "T", activeScenarioId: "s1" });
    expect(recorded[0].calls).toEqual([
      ["select", ["id, title, active_scenario_id"]], ["eq", ["id", CONVERSATION]], ["eq", ["user_id", USER]], ["is", ["deleted_at", null]], ["maybeSingle", []],
    ]);
    expect(await store.get(CONVERSATION, USER)).toBeNull();
  });

  it("soft-deletes the caller's conversation once and reports whether a row was hidden", async () => {
    const now = new Date("2026-10-08T15:00:00Z");
    const { client, recorded } = fakeAdmin({ conversations: [{ data: [{ id: CONVERSATION }] }, { data: [] }] });
    const store = supabaseConversationStore(client);
    expect(await store.softDelete(CONVERSATION, USER, now)).toBe(true);
    expect(callOn(recorded, "conversations", "update")).toEqual([{ deleted_at: "2026-10-08T15:00:00.000Z" }]);
    expect(callOn(recorded, "conversations", "is")).toEqual(["deleted_at", null]);
    expect(await store.softDelete(CONVERSATION, USER, now)).toBe(false);
  });
});

describe("titleFrom", () => {
  it("takes the first 60 characters, cut at a word, on one line", () => {
    expect(titleFrom("Model measles in Kenya")).toBe("Model measles in Kenya");
    expect(titleFrom("Model\n measles   in Kenya ")).toBe("Model measles in Kenya");
    expect(titleFrom("Please simulate a measles outbreak in Kenya with ninety percent vaccination coverage")).toBe("Please simulate a measles outbreak in Kenya with ninety…");
    expect(titleFrom("x".repeat(80))).toBe(`${"x".repeat(60)}…`);
  });
});
