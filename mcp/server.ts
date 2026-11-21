/**
 * Creator OS MCP server over stdio: for AI apps that can only launch a local command.
 *
 * It holds no tools of its own. It forwards everything to the Go API's MCP endpoint (POST /mcp), where
 * every tool is defined once, so the stdio and URL routes can never disagree. Which tools exist (reads
 * only, or reads and writes) is decided by the API (MCP_READ_ONLY), not here.
 *
 *   CREATOR_OS_API_URL    where the Go API listens (default http://127.0.0.1:8080; falls back to API_URL)
 *   CREATOR_OS_API_TOKEN  sent as "Authorization: Bearer …" (falls back to API_TOKEN)
 *
 * Transport is stdio, so nothing here may print to stdout except MCP messages; logs go to stderr.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const BASE = (process.env.CREATOR_OS_API_URL ?? process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const TOKEN = process.env.CREATOR_OS_API_TOKEN ?? process.env.API_TOKEN;

let upstream: Client | null = null;

/** Connects to the API on first use (and again after a failure), so this process can start before the API does. */
async function api(): Promise<Client> {
  if (upstream) return upstream;
  const client = new Client({ name: "creator-os-stdio", version: "0.2.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), TOKEN ? { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } } : undefined);
  try {
    await client.connect(transport);
  } catch (e) {
    throw new Error(`Can't reach the Creator OS API at ${BASE}/mcp (${(e as Error).message}). Start it with ./start.sh or Creator OS API.app; if it has an API_TOKEN, set CREATOR_OS_API_TOKEN.`);
  }
  transport.onclose = () => (upstream = null);
  upstream = client;
  return client;
}

const server = new Server(
  { name: "creator-os", version: "0.2.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "Creator OS holds a solo creator's brand deals, inbox, audience and finance. Start with get_context, then get_today. " +
      "The write tools change real records: confirm before anything hard to undo. Replies are only recorded, never sent.",
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  try {
    return await (await api()).listTools();
  } catch (e) {
    upstream = null;
    throw e;
  }
});

server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
  try {
    return (await (await api()).callTool(req.params)) as CallToolResult;
  } catch (e) {
    upstream = null; // reconnect on the next call
    return { isError: true, content: [{ type: "text", text: (e as Error).message }] };
  }
});

server
  .connect(new StdioServerTransport())
  .then(() => console.error(`[creator-os-mcp] stdio proxy ready · forwarding to ${BASE}/mcp`))
  .catch((e) => {
    console.error("[creator-os-mcp] failed to start:", e);
    process.exit(1);
  });
