# Creator OS API

Go service for Creator OS: CRM, Overview, Brand 360, Inbox, Audience, Automation and Settings. Open http://127.0.0.1:8080/ while it runs for the endpoint list with a “try it” form. See **Go API** in the [project README](../README.md#go-api-backend).

```bash
cd backend
go run ./cmd/server          # demo data; APP_MODE=live for your real data
go test ./...                # tests (build a temporary database from ../drizzle)
go build -o bin/creator-os-api ./cmd/server
```

From the project root you can also use `./start.sh` / `./stop.sh` (API + web app) and `npm run verify:api`
(compares this API with the TypeScript code on the running database).

**MCP for AI assistants:** the API also serves [MCP](https://modelcontextprotocol.io) at `/mcp`, so Claude, Cursor and other
AI apps can use Creator OS by URL. The front page at http://127.0.0.1:8080/ has a **Connect your AI** box with the URL, setup for each
app and the tool list. Every API action is a tool (32: 17 read, 15 write); set `MCP_READ_ONLY=1` to hide the write tools. The tools are defined in
`internal/api/mcp.go` (each one calls an existing endpoint in-process, so behaviour matches `/api/v1`), and `mcp_test.go` covers them.
See **MCP** in the [project README](../README.md#mcp-let-an-ai-assistant-use-creator-os).
