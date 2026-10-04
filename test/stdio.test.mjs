// End-to-end: start the real MCP server over stdio against a local fake SavvyCal API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function fakeSavvyCal() {
  const seen = [];
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      res.setHeader("Content-Type", "application/json");
      const path = req.url.split("?")[0];
      if (path === "/v1/links") return res.end(JSON.stringify({ entries: [{ id: "link_1", name: "Intro call", durations: [30] }], metadata: {} }));
      if (path === "/v1/links/link_1/slots") {
        return res.end(
          JSON.stringify([
            { start_at: "2026-10-06T07:00:00Z", end_at: "2026-10-06T07:30:00Z", duration: 30, rank: 1 },
            { start_at: "2026-10-06T08:00:00Z", end_at: "2026-10-06T08:30:00Z", duration: 30, rank: 1 },
          ]),
        );
      }
      if (path === "/v1/links/link_1/events" && req.method === "POST") return res.end(JSON.stringify({ id: "event_1", state: "confirmed" }));
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not_found" }));
    });
  });
  return { srv, seen };
}

function rpcClient(child) {
  let buf = "";
  const pending = new Map();
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  let id = 0;
  return {
    request(method, params) {
      const myId = ++id;
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
      return new Promise((resolve, reject) => {
        pending.set(myId, resolve);
        setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 10000);
      });
    },
    notify(method, params) {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    },
  };
}

test("MCP handshake, tool listing and a find-then-book flow", async () => {
  const { srv, seen } = fakeSavvyCal();
  srv.listen(0);
  await once(srv, "listening");
  const port = srv.address().port;

  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, SAVVYCAL_TOKEN: "pt_secret_test", SAVVYCAL_BASE_URL: `http://127.0.0.1:${port}` },
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    const rpc = rpcClient(child);
    const init = await rpc.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0.0.0" },
    });
    assert.equal(init.result.serverInfo.name, "savvycal-mcp");
    rpc.notify("notifications/initialized", {});

    const list = await rpc.request("tools/list", {});
    const names = list.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "book_meeting",
      "cancel_meeting",
      "create_webhook",
      "delete_webhook",
      "find_available_slots",
      "get_current_user",
      "get_event",
      "get_scheduling_link",
      "list_events",
      "list_scheduling_links",
      "list_webhooks",
      "toggle_scheduling_link",
    ]);
    assert.equal(list.result.tools.find((t) => t.name === "cancel_meeting").annotations.destructiveHint, true);

    const slots = await rpc.request("tools/call", {
      name: "find_available_slots",
      arguments: { linkId: "link_1", from: "2026-10-06T00:00:00Z", timeZone: "Asia/Jerusalem" },
    });
    const parsed = JSON.parse(slots.result.content[0].text);
    assert.equal(parsed.totalSlots, 2);
    assert.equal(parsed.days["Tue, Oct 6"][0].local, "10:00 AM–10:30 AM");
    const slotReq = seen.find((s) => s.url.startsWith("/v1/links/link_1/slots"));
    const q = new URL(slotReq.url, "http://x").searchParams;
    assert.equal(q.get("from"), "2026-10-06T00:00:00.000Z");
    assert.equal(q.get("until"), "2026-10-13T00:00:00.000Z");

    const booked = await rpc.request("tools/call", {
      name: "book_meeting",
      arguments: {
        linkId: "link_1",
        display_name: "Dana Levi",
        email: "dana@example.com",
        start_at: "2026-10-06T07:00:00Z",
        end_at: "2026-10-06T07:30:00Z",
        time_zone: "Asia/Jerusalem",
      },
    });
    assert.equal(JSON.parse(booked.result.content[0].text).id, "event_1");
    const post = seen.find((s) => s.method === "POST");
    assert.equal(JSON.parse(post.body).email, "dana@example.com");
    assert.ok(seen.every((s) => s.auth === "Bearer pt_secret_test"));

    const bad = await rpc.request("tools/call", { name: "get_event", arguments: { eventId: "nope" } });
    assert.equal(bad.result.isError, true);
    assert.match(bad.result.content[0].text, /SavvyCal API 404/);
  } finally {
    child.kill();
    srv.close();
  }
});
