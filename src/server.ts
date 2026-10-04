import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SavvyCalClient, summarizeSlots } from "./client.js";

export const VERSION = "0.1.0";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
}

const linkId = z.string().min(1).describe("Scheduling link ID, e.g. link_01J5KC2G... (from list_scheduling_links)");
const eventId = z.string().min(1).describe("Event ID or UUID (from list_events)");
const page = {
  limit: z.number().int().min(1).max(100).optional().describe("Page size, 1-100 (default 20)"),
  after: z.string().optional().describe("Pagination cursor from a previous response's metadata"),
  before: z.string().optional().describe("Pagination cursor from a previous response's metadata"),
};
const RO = { readOnlyHint: true, openWorldHint: true } as const;

export function createServer(client: SavvyCalClient, now: () => Date = () => new Date()): McpServer {
  const server = new McpServer({ name: "savvycal-mcp", version: VERSION });

  server.registerTool(
    "get_current_user",
    {
      title: "Get current user",
      description: "Get the authenticated SavvyCal user (name, email, time zone, etc).",
      inputSchema: {},
      annotations: RO,
    },
    async () => run(() => client.me()),
  );

  server.registerTool(
    "list_scheduling_links",
    {
      title: "List scheduling links",
      description: "List the user's scheduling links (id, name, slug, url, durations, state).",
      inputSchema: { ...page, state: z.enum(["active", "disabled"]).optional() },
      annotations: RO,
    },
    async (q) => run(() => client.listLinks(q)),
  );

  server.registerTool(
    "get_scheduling_link",
    {
      title: "Get scheduling link",
      description: "Get one scheduling link with its settings and booking form fields.",
      inputSchema: { linkId },
      annotations: RO,
    },
    async ({ linkId }) => run(() => client.getLink(linkId)),
  );

  server.registerTool(
    "toggle_scheduling_link",
    {
      title: "Enable/disable link",
      description: "Toggle a scheduling link between active and disabled.",
      inputSchema: { linkId },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ linkId }) => run(() => client.toggleLink(linkId)),
  );

  server.registerTool(
    "find_available_slots",
    {
      title: "Find available slots",
      description:
        "Find bookable time slots on a scheduling link, grouped by day with readable local times. Defaults to the next 7 days (max 31). Use the exact start_at/end_at of a slot when calling book_meeting.",
      inputSchema: {
        linkId,
        from: z.string().optional().describe("ISO 8601 start of the search window (default: now)"),
        until: z.string().optional().describe("ISO 8601 end of the window (default: from + 7 days, max 31 days)"),
        timeZone: z.string().optional().describe("Olson time zone to display local times in, e.g. America/New_York (default UTC)"),
        duration: z.number().int().positive().optional().describe("Only return slots of this length in minutes"),
        raw: z.boolean().optional().describe("Return SavvyCal's raw slot array instead"),
      },
      annotations: RO,
    },
    async ({ linkId, from, until, timeZone, duration, raw }) =>
      run(async () => {
        const start = from ? new Date(from) : now();
        const end = until ? new Date(until) : new Date(start.getTime() + 7 * 24 * 3600 * 1000);
        const slots = await client.getSlots(linkId, start.toISOString(), end.toISOString());
        return raw ? slots : summarizeSlots(slots, { timeZone, duration });
      }),
  );

  server.registerTool(
    "list_events",
    {
      title: "List meetings",
      description: "List scheduled meetings. Filter by state, period (upcoming/past/fixed date range), link, and sort direction.",
      inputSchema: {
        ...page,
        state: z
          .enum([
            "all",
            "confirmed",
            "canceled",
            "awaiting_reschedule",
            "awaiting_checkout",
            "checkout_expired",
            "awaiting_approval",
            "declined",
            "tentative",
          ])
          .optional()
          .describe("Default: confirmed"),
        period: z.enum(["past", "upcoming", "fixed", "all"]).optional().describe("Default: upcoming. Use fixed with from/until"),
        from: z.string().optional().describe("YYYY-MM-DD lower bound (period=fixed)"),
        until: z.string().optional().describe("YYYY-MM-DD upper bound (period=fixed)"),
        direction: z.enum(["asc", "desc"]).optional(),
        attendance: z.enum(["attending", "any"]).optional(),
        link: z.string().optional().describe("Only events booked through this link ID"),
      },
      annotations: RO,
    },
    async (q) => run(() => client.listEvents(q)),
  );

  server.registerTool(
    "get_event",
    {
      title: "Get meeting",
      description: "Get one meeting with attendees, conferencing details and form answers.",
      inputSchema: { eventId },
      annotations: RO,
    },
    async ({ eventId }) => run(() => client.getEvent(eventId)),
  );

  server.registerTool(
    "book_meeting",
    {
      title: "Book a meeting",
      description:
        "Book a meeting on a scheduling link for someone. start_at/end_at must exactly match an available slot from find_available_slots. Sends real calendar invites, so confirm details with the user first.",
      inputSchema: {
        linkId,
        display_name: z.string().min(1).describe("The scheduler's full name"),
        email: z.string().email().describe("The scheduler's email"),
        start_at: z.string().describe("ISO 8601 start, exactly as returned by find_available_slots"),
        end_at: z.string().describe("ISO 8601 end, exactly as returned by find_available_slots"),
        time_zone: z.string().describe("The scheduler's Olson time zone, e.g. Europe/London"),
        phone_number: z.string().optional().describe("E.164 phone, e.g. +15555555555 (only if the link requires it)"),
        fields: z.array(z.record(z.any())).optional().describe("Answers to the link's custom booking form fields"),
        metadata: z.record(z.any()).optional().describe("Arbitrary metadata to store on the event"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ linkId, ...event }) => run(() => client.createEvent(linkId, event)),
  );

  server.registerTool(
    "cancel_meeting",
    {
      title: "Cancel a meeting",
      description: "Cancel a scheduled meeting. Attendees are notified, and this cannot be undone, so confirm with the user first.",
      inputSchema: { eventId, cancel_reason: z.string().optional().describe("Optional reason shared with attendees") },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ eventId, cancel_reason }) => run(() => client.cancelEvent(eventId, cancel_reason)),
  );

  server.registerTool(
    "list_webhooks",
    { title: "List webhooks", description: "List configured webhooks.", inputSchema: {}, annotations: RO },
    async () => run(() => client.listWebhooks()),
  );

  server.registerTool(
    "create_webhook",
    {
      title: "Create webhook",
      description: "Register a URL that receives SavvyCal event notifications (bookings, cancellations, etc).",
      inputSchema: { url: z.string().url().describe("HTTPS endpoint URL") },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ url }) => run(() => client.createWebhook(url)),
  );

  server.registerTool(
    "delete_webhook",
    {
      title: "Delete webhook",
      description: "Delete a webhook by id.",
      inputSchema: { webhookId: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ webhookId }) => run(() => client.deleteWebhook(webhookId)),
  );

  return server;
}
