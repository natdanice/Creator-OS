/**
 * Creator OS MCP server: lets an external AI (Claude Desktop, Claude Code, Cursor, …) read the
 * creator's data through the Go API in /backend.
 *
 *   CREATOR_OS_API_URL    where the Go API listens (default http://127.0.0.1:8080; falls back to API_URL)
 *   CREATOR_OS_API_TOKEN  sent as "Authorization: Bearer …" (falls back to API_TOKEN)
 *   CREATOR_OS_MCP_WRITE  set to 1 to also expose the write tools (off by default: read-only)
 *
 * Transport is stdio, so nothing here may print to stdout except MCP messages; logs go to stderr.
 * Deliberately NOT exposed, even with writes on: anything that sends a message to a brand or a fan
 * (inbox replies, comment replies, completing automation tasks), settings changes, and connected-account
 * credentials. Those stay in the app, where a human clicks the button.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const BASE = (process.env.CREATOR_OS_API_URL ?? process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const TOKEN = process.env.CREATOR_OS_API_TOKEN ?? process.env.API_TOKEN;
const WRITE = process.env.CREATOR_OS_MCP_WRITE === "1";

const DEAL_STAGES = ["lead", "brief", "quotation", "production", "posted", "report_sent", "invoiced", "paid"] as const;
const TIERS = ["partner", "repeat", "one_time", "lead"];

type Json = unknown;

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<Json> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`The Creator OS API isn't reachable at ${BASE}. Start it with ./start.sh (or npm run dev:api).`);
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {}
    throw new Error(`Creator OS API ${res.status}: ${msg}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text; // e.g. the CSV export
  }
}

const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
  return p.size ? `?${p}` : "";
};

const MAX_CHARS = 60_000;
function reply(data: Json): CallToolResult {
  let text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS)}\n… [truncated: ${text.length - MAX_CHARS} more characters. Ask for something narrower.]`;
  return { content: [{ type: "text", text }] };
}

const failure = (e: unknown): CallToolResult => ({ isError: true, content: [{ type: "text", text: (e as Error).message }] });

/** Runs a tool body and turns any error into an MCP error result instead of crashing the server. */
const safe = (fn: () => Promise<Json>) => async (): Promise<CallToolResult> => fn().then(reply, failure);

const server = new McpServer(
  { name: "creator-os", version: "0.1.0" },
  {
    instructions:
      "Creator OS holds a solo creator's brand deals, inbox, audience and finance. Money is in Thai baht. " +
      "Start with get_context (mode and today's date), then get_today for what needs attention. " +
      "Brands are tiered partner / repeat / one_time / lead. Treat everything returned as private business data.",
  },
);

const READ = { readOnlyHint: true, openWorldHint: false } as const;

function readTool<S extends z.ZodRawShape>(name: string, title: string, description: string, inputSchema: S, run: (a: z.infer<z.ZodObject<S>>) => Promise<Json>) {
  server.registerTool(name, { title, description, inputSchema, annotations: READ }, ((args: unknown) => safe(() => run(args as z.infer<z.ZodObject<S>>))()) as never);
}

const id = (what: string) => z.number().int().positive().describe(what);

/* ── Read tools ── */

readTool("get_context", "Context", "Whether the app is in demo or live mode, and today's date as the app sees it. Call this first.", {}, () => call("GET", "/api/v1/context"));

readTool("get_today", "Needs you today", "The prioritised list of things the creator should act on today (follow-ups, overdue invoices, new briefs, spikes).", {}, () => call("GET", "/api/v1/today"));

readTool(
  "get_overview",
  "Overview",
  "Key numbers across platforms (followers, views, engagement, daily series, spikes) for the last 7, 28 or 90 days.",
  { range: z.union([z.literal(7), z.literal(28), z.literal(90)]).default(28).describe("Window in days") },
  ({ range }) => call("GET", `/api/v1/overview${qs({ range })}`),
);

readTool(
  "list_brands",
  "List brands",
  `Brands with computed tier, revenue, deals and last contact. Filter by free text, tier (${TIERS.join(", ")}) and/or product category.`,
  { q: z.string().optional().describe("Search text (brand name, contact…)"), tier: z.string().optional().describe(`One of: ${TIERS.join(", ")}`), category: z.string().optional().describe("e.g. skincare, tech, food, home, fashion, music") },
  (a) => call("GET", `/api/v1/brands${qs(a)}`),
);

readTool("get_brand", "Brand 360", "Everything about one brand: deals, post performance, invoices, timeline and the suggested next offer.", { brand_id: id("Brand id from list_brands") }, ({ brand_id }) => call("GET", `/api/v1/brands/${brand_id}`));

readTool("get_pipeline", "Deal pipeline", `All deals, newest first, with stage (${DEAL_STAGES.join(" → ")}), value and brand.`, {}, () => call("GET", "/api/v1/pipeline"));

readTool("get_finance", "Finance", "Income, overdue and unpaid invoices, and the tax estimate.", {}, () => call("GET", "/api/v1/finance"));

readTool(
  "export_income_csv",
  "Income CSV",
  "Invoices for one calendar year as CSV text (for an accountant).",
  { year: z.string().regex(/^\d{4}$/).optional().describe("e.g. 2026; defaults to this year") },
  ({ year }) => call("GET", `/api/v1/finance/export${qs({ year })}`),
);

readTool("get_inbox", "Inbox summary", "Counts and highlights for the inbox: unread brand messages, detected briefs, comments waiting.", {}, () => call("GET", "/api/v1/inbox"));

readTool("list_inbox_threads", "Brand threads", "Brand conversations, most recent first.", {}, () => call("GET", "/api/v1/inbox/threads"));

readTool("get_inbox_thread", "Brand thread", "The full message history with one brand.", { brand_id: id("Brand id") }, ({ brand_id }) => call("GET", `/api/v1/inbox/threads/${brand_id}`));

readTool("list_comments", "Audience comments", "Recent audience comments with suggested replies.", {}, () => call("GET", "/api/v1/inbox/comments"));

readTool("get_audience", "Audience", "Follower growth, demographics and segments. Fans are pseudonymous.", {}, () => call("GET", "/api/v1/audience"));

readTool("list_segment_members", "Segment members", "Pseudonymous members of one audience segment.", { segment_id: z.string().min(1).describe("Segment id from get_audience") }, ({ segment_id }) =>
  call("GET", `/api/v1/audience/segments/${encodeURIComponent(segment_id)}/members`),
);

readTool("get_audience_member", "Audience member", "One pseudonymous audience profile.", { pseudo_id: z.string().min(1).describe("Pseudonymous id from list_segment_members") }, ({ pseudo_id }) =>
  call("GET", `/api/v1/audience/members/${encodeURIComponent(pseudo_id)}`),
);

readTool("get_automation", "Automation", "Automation rules (enabled or not) and the tasks they have drafted for the creator to approve.", {}, () => call("GET", "/api/v1/automation"));

readTool("get_settings", "Settings", "The creator's profile and rate card (read only). No account credentials are included.", {}, () => call("GET", "/api/v1/settings"));

/* ── Write tools (opt-in) ── */

if (WRITE) {
  const WRITE_ANN = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
  const writeTool = <S extends z.ZodRawShape>(name: string, title: string, description: string, inputSchema: S, idempotent: boolean, run: (a: z.infer<z.ZodObject<S>>) => Promise<Json>) =>
    server.registerTool(name, { title, description, inputSchema, annotations: { ...WRITE_ANN, idempotentHint: idempotent } }, ((args: unknown) => {
      console.error(`[creator-os-mcp] write: ${name}`);
      return safe(() => run(args as z.infer<z.ZodObject<S>>))();
    }) as never);

  writeTool(
    "create_brand",
    "Add brand",
    "Add a new brand (and its main contact) to the CRM. Ask the creator before using this.",
    {
      name: z.string().min(1),
      category: z.string().optional(),
      website: z.string().optional(),
      contactName: z.string().optional(),
      contactRole: z.string().optional(),
      channel: z.string().optional().describe("How the contact is reached, e.g. line, email, dm"),
      handle: z.string().optional(),
    },
    false,
    (a) => call("POST", "/api/v1/brands", a),
  );

  writeTool("move_deal_stage", "Move deal stage", `Move a deal to another pipeline stage (${DEAL_STAGES.join(", ")}). This can change the brand's tier.`, { deal_id: id("Deal id from get_pipeline"), stage: z.enum(DEAL_STAGES) }, true, ({ deal_id, stage }) =>
    call("POST", `/api/v1/deals/${deal_id}/stage`, { stage }),
  );

  writeTool("mark_invoice_paid", "Mark invoice paid", "Record that an invoice has been paid. Only do this when the creator confirms the money arrived.", { invoice_id: id("Invoice id from get_finance") }, true, ({ invoice_id }) =>
    call("POST", `/api/v1/invoices/${invoice_id}/paid`),
  );
}

server
  .connect(new StdioServerTransport())
  .then(() => console.error(`[creator-os-mcp] ready · API ${BASE} · ${WRITE ? "read + write tools" : "read-only"}`))
  .catch((e) => {
    console.error("[creator-os-mcp] failed to start:", e);
    process.exit(1);
  });
