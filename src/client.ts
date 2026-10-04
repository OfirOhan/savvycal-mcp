/**
 * Minimal typed client for the SavvyCal REST API (v1).
 * Docs: https://developers.savvycal.com
 */

export const BASE_URL = "https://api.savvycal.com";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SavvyCalClientOptions {
  token: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

export interface PageQuery {
  limit?: number;
  after?: string;
  before?: string;
}

export interface EventQuery extends PageQuery {
  state?: string;
  period?: "past" | "upcoming" | "fixed" | "all";
  from?: string;
  until?: string;
  direction?: "asc" | "desc";
  attendance?: "attending" | "any";
  link?: string;
}

export interface NewEvent {
  display_name: string;
  email: string;
  start_at: string;
  end_at: string;
  time_zone: string;
  phone_number?: string | null;
  fields?: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
}

export interface Slot {
  start_at: string;
  end_at: string;
  duration: number;
  rank: number;
}

export class SavvyCalApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    path: string,
  ) {
    super(`SavvyCal API ${status} on ${path}: ${body.slice(0, 500)}`);
    this.name = "SavvyCalApiError";
  }
}

const enc = encodeURIComponent;

export class SavvyCalClient {
  private token: string;
  private baseUrl: string;
  private fetchImpl: FetchLike;

  constructor(opts: SavvyCalClientOptions) {
    if (!opts.token) throw new Error("A SavvyCal token is required (set SAVVYCAL_TOKEN).");
    this.token = opts.token;
    this.baseUrl = (opts.baseUrl ?? BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  private async request<T>(method: string, path: string, query?: object, body?: unknown): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await this.fetchImpl(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new SavvyCalApiError(res.status, text, path);
    if (!text) return { ok: true } as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return { message: text } as T;
    }
  }

  me() {
    return this.request<Record<string, unknown>>("GET", "/v1/me");
  }

  listLinks(q: PageQuery & { state?: "active" | "disabled" } = {}) {
    return this.request<{ entries: Record<string, unknown>[]; metadata: Record<string, unknown> }>("GET", "/v1/links", q);
  }

  getLink(linkId: string) {
    return this.request<Record<string, unknown>>("GET", `/v1/links/${enc(linkId)}`);
  }

  toggleLink(linkId: string) {
    return this.request<Record<string, unknown>>("POST", `/v1/links/${enc(linkId)}/toggle`);
  }

  getSlots(linkId: string, from?: string, until?: string) {
    return this.request<Slot[]>("GET", `/v1/links/${enc(linkId)}/slots`, { from, until });
  }

  listEvents(q: EventQuery = {}) {
    return this.request<{ entries: Record<string, unknown>[]; metadata: Record<string, unknown> }>("GET", "/v1/events", q);
  }

  getEvent(eventId: string) {
    return this.request<Record<string, unknown>>("GET", `/v1/events/${enc(eventId)}`);
  }

  createEvent(linkId: string, event: NewEvent) {
    return this.request<Record<string, unknown>>("POST", `/v1/links/${enc(linkId)}/events`, undefined, event);
  }

  cancelEvent(eventId: string, cancelReason?: string) {
    return this.request<Record<string, unknown>>("POST", `/v1/events/${enc(eventId)}/cancel`, undefined, {
      cancel_reason: cancelReason ?? null,
    });
  }

  listWebhooks() {
    return this.request<Record<string, unknown>>("GET", "/v1/webhooks");
  }

  createWebhook(url: string) {
    return this.request<Record<string, unknown>>("POST", "/v1/webhooks", undefined, { url });
  }

  deleteWebhook(webhookId: string) {
    return this.request<Record<string, unknown>>("DELETE", `/v1/webhooks/${enc(webhookId)}`);
  }
}

/**
 * Make slots easy for an LLM to reason about: optionally filter by duration,
 * add a human-readable local time, and group by day.
 */
export function summarizeSlots(slots: Slot[], opts: { timeZone?: string; duration?: number; max?: number } = {}) {
  const tz = opts.timeZone ?? "UTC";
  const filtered = slots
    .filter((s) => (opts.duration ? s.duration === opts.duration : true))
    .sort((a, b) => a.start_at.localeCompare(b.start_at) || a.rank - b.rank);
  const durations = [...new Set(slots.map((s) => s.duration))].sort((a, b) => a - b);
  const fmtDay = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
  const fmtTime = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const byDay: Record<string, { start_at: string; end_at: string; duration: number; rank: number; local: string }[]> = {};
  const max = opts.max ?? 200;
  for (const s of filtered.slice(0, max)) {
    const d = new Date(s.start_at);
    const day = fmtDay.format(d);
    const clean = (x: string) => x.replace(/[\u202f\u00a0]/g, " ");
    (byDay[day] ??= []).push({ ...s, local: clean(`${fmtTime.format(d)}–${fmtTime.format(new Date(s.end_at))}`) });
  }
  return {
    timeZone: tz,
    availableDurations: durations,
    totalSlots: filtered.length,
    truncated: filtered.length > max,
    days: byDay,
  };
}
