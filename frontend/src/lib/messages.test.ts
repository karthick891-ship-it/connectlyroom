import { describe, expect, it } from "vitest";
import { maxConfirmedId, newClientId, upsertMessage } from "./messages";
import type { Message } from "./types";

const base: Message = {
  id: 1, conversation_id: 1, sender_id: 1, client_id: "c1", type: "text", content: "hi",
  created_at: "2026-01-01T10:00:00.000Z", edited_at: null, deleted: false, attachments: [],
};

describe("upsertMessage", () => {
  it("replaces an optimistic message when the server copy arrives (same client_id)", () => {
    const pending: Message = { ...base, id: -1, status: "sending" };
    const out = upsertMessage([pending], { ...base, id: 10 });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(10);
    expect(out[0].status).toBe("sent");
  });

  it("is idempotent for the same server message", () => {
    const once = upsertMessage([], base);
    expect(upsertMessage(once, base)).toHaveLength(1);
  });

  it("keeps confirmed messages by id and pending ones last", () => {
    let list = upsertMessage([], { ...base, id: 5, client_id: "a" });
    list = upsertMessage(list, { ...base, id: -1, client_id: "p", status: "sending" });
    list = upsertMessage(list, { ...base, id: 3, client_id: "b" });
    expect(list.map((m) => m.id)).toEqual([3, 5, -1]);
    expect(maxConfirmedId(list)).toBe(5);
  });
});

describe("newClientId", () => {
  it("looks like a UUID", () => {
    expect(newClientId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
