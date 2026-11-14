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
