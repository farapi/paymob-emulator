import { describe, expect, it } from "vitest";
import { openDatabase, type OpenedDatabase } from "../database/connect.js";
import { runMigrations } from "../database/migrate.js";
import { createCheckoutSession } from "./checkout-sessions-repository.js";
import { createBrowserEvent, listBrowserEventsAfter } from "./browser-events.js";

function setup(): OpenedDatabase {
  const opened = openDatabase({ filePath: ":memory:" });
  runMigrations(opened);
  return opened;
}

describe("createBrowserEvent", () => {
  it("is a no-op when no checkout session ever existed (headless completion)", () => {
    const opened = setup();
    const event = createBrowserEvent(opened.db, undefined, { type: "browser.redirect", payload: {} }, new Date());
    expect(event).toBeUndefined();
    opened.close();
  });

  it("marks a due navigation event as missed when no browser is active", () => {
    const opened = setup();
    const now = new Date("2026-08-14T12:00:00.000Z");
    const { row } = createCheckoutSession(opened.db, { kind: "modern", expiresAt: new Date(now.getTime() + 60_000) }, new Date(now.getTime() - 60_000));

    const later = new Date(now.getTime() + 30_000); // 30s after createdAt with no heartbeat => stale
    const event = createBrowserEvent(opened.db, row, { type: "browser.redirect", payload: { status: "success" } }, later);
    expect(event?.status).toBe("missed_no_active_browser");
    opened.close();
  });

  it("marks a due navigation event as delivered when the session is active", () => {
    const opened = setup();
    const now = new Date("2026-08-14T12:00:00.000Z");
    const { row } = createCheckoutSession(opened.db, { kind: "modern", expiresAt: new Date(now.getTime() + 60_000) }, now);

    const event = createBrowserEvent(opened.db, row, { type: "browser.redirect", payload: { status: "success" } }, now);
    expect(event?.status).toBe("delivered");
    opened.close();
  });

  it("assigns monotonically increasing eventSeq per session and lists events after a cursor", () => {
    const opened = setup();
    const now = new Date();
    const { row } = createCheckoutSession(opened.db, { kind: "modern", expiresAt: new Date(now.getTime() + 60_000) }, now);

    const e1 = createBrowserEvent(opened.db, row, { type: "browser.show_result", payload: { status: "pending" } }, now)!;
    const e2 = createBrowserEvent(opened.db, row, { type: "browser.show_result", payload: { status: "success" } }, now)!;
    expect(e2.eventSeq).toBe(e1.eventSeq + 1);

    const after = listBrowserEventsAfter(opened.db, row.id, e1.eventSeq);
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(e2.id);
    opened.close();
  });
});
