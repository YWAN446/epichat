import { describe, expect, it } from "vitest";
import { listConversations } from "@/lib/conversations";
import { callOn, fakeAdmin } from "../helpers/fakeAdmin";

const USER = "11111111-1111-1111-1111-111111111111";

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
