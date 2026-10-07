import { describe, expect, it, vi } from "vitest";
import { supabaseStepEventSink } from "@/lib/stepEvents";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = "11111111-1111-1111-1111-111111111111";
const SESSION = "44444444-4444-4444-8444-444444444444";

describe("supabaseStepEventSink", () => {
  it("inserts one row per event with fixed columns and an empty meta by default", async () => {
    const { client, recorded } = fakeAdmin();
    await supabaseStepEventSink(client).log(USER, [
      { kind: "consent_given", meta: { participant_type: "other", version: "v1" } },
      { kind: "session_start", sessionId: SESSION },
    ]);
    expect(callOn(recorded, "step_events", "insert")).toEqual([
      [
        { user_id: USER, session_id: null, conversation_id: null, turn_id: null, kind: "consent_given", stage: null, tool: null, meta: { participant_type: "other", version: "v1" } },
        { user_id: USER, session_id: SESSION, conversation_id: null, turn_id: null, kind: "session_start", stage: null, tool: null, meta: {} },
      ],
    ]);
  });

  it("does nothing for an empty list and never throws on a database error", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, recorded } = fakeAdmin({ step_events: [{ error: { message: "down" } }] });
    const sink = supabaseStepEventSink(client);
    await sink.log(USER, []);
    expect(recorded).toEqual([]);
    await expect(sink.log(USER, [{ kind: "turn" }])).resolves.toBeUndefined();
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});
