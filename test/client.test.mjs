import { test } from "node:test";
import assert from "node:assert/strict";
import { SavvyCalClient, summarizeSlots, BASE_URL } from "../dist/client.js";

function mockFetch(responder) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, ...init });
    const { status = 200, body = {} } = (await responder(url, init)) ?? {};
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  fn.calls = calls;
  return fn;
}

test("authenticates with a bearer token against the v1 API", async () => {
  const f = mockFetch(() => ({ body: { id: "user_1", email: "a@b.co" } }));
  const c = new SavvyCalClient({ token: "pt_secret_x", fetch: f });
  assert.deepEqual(await c.me(), { id: "user_1", email: "a@b.co" });
  assert.equal(f.calls[0].url, `${BASE_URL}/v1/me`);
  assert.equal(f.calls[0].headers.Authorization, "Bearer pt_secret_x");
});

test("lists events with filters and skips empty params", async () => {
  const f = mockFetch(() => ({ body: { entries: [], metadata: {} } }));
  const c = new SavvyCalClient({ token: "t", fetch: f });
  await c.listEvents({ period: "fixed", from: "2026-10-01", until: "2026-10-31", link: "", limit: 50 });
  const u = new URL(f.calls[0].url);
  assert.equal(u.pathname, "/v1/events");
  assert.equal(u.searchParams.get("period"), "fixed");
  assert.equal(u.searchParams.get("limit"), "50");
  assert.equal(u.searchParams.has("link"), false);
});

test("books and cancels events with JSON bodies", async () => {
  const f = mockFetch(() => ({ body: { id: "event_1" } }));
  const c = new SavvyCalClient({ token: "t", fetch: f });
  const ev = {
    display_name: "Dana Levi",
    email: "dana@example.com",
    start_at: "2026-10-06T09:00:00Z",
    end_at: "2026-10-06T09:30:00Z",
    time_zone: "Asia/Jerusalem",
  };
  await c.createEvent("link_123", ev);
  assert.equal(f.calls[0].method, "POST");
  assert.ok(f.calls[0].url.endsWith("/v1/links/link_123/events"));
  assert.deepEqual(JSON.parse(f.calls[0].body), ev);
  await c.cancelEvent("event_1", "Conflict");
  assert.ok(f.calls[1].url.endsWith("/v1/events/event_1/cancel"));
  assert.deepEqual(JSON.parse(f.calls[1].body), { cancel_reason: "Conflict" });
  await c.deleteWebhook("wh_9");
  assert.equal(f.calls[2].method, "DELETE");
  assert.ok(f.calls[2].url.endsWith("/v1/webhooks/wh_9"));
});

test("surfaces API errors with status and body", async () => {
  const f = mockFetch(() => ({ status: 422, body: { errors: { start_at: ["is not available"] } } }));
  const c = new SavvyCalClient({ token: "t", fetch: f });
  await assert.rejects(() => c.createEvent("l", {}), /SavvyCal API 422 .*not available/);
});

test("summarizes slots by day in a target time zone", () => {
  const slots = [
    { start_at: "2026-10-06T07:00:00Z", end_at: "2026-10-06T07:30:00Z", duration: 30, rank: 1 },
    { start_at: "2026-10-06T07:00:00Z", end_at: "2026-10-06T08:00:00Z", duration: 60, rank: 1 },
    { start_at: "2026-10-07T13:00:00Z", end_at: "2026-10-07T13:30:00Z", duration: 30, rank: 2 },
  ];
  const s = summarizeSlots(slots, { timeZone: "Asia/Jerusalem", duration: 30 });
  assert.deepEqual(s.availableDurations, [30, 60]);
  assert.equal(s.totalSlots, 2);
  assert.deepEqual(Object.keys(s.days), ["Tue, Oct 6", "Wed, Oct 7"]);
  assert.equal(s.days["Tue, Oct 6"][0].local, "10:00 AM–10:30 AM");
});
