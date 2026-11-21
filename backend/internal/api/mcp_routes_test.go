package api

import (
	"strings"
	"testing"

	"creatoros/internal/testdb"
)

// Every action the API offers must be reachable through an MCP tool, so a new endpoint can't be forgotten
// (and a tool can't point at a route that doesn't exist).
func TestEveryRouteHasAnMCPTool(t *testing.T) {
	s := &Server{Store: testdb.New(t)}
	s.Handler()

	// Routes that are not data actions: liveness (get_context covers the same ground), MCP itself, the front page.
	notTools := map[string]string{
		"GET /api/v1/health": "liveness probe",
		"POST /mcp":          "the MCP endpoint itself",
		"GET /{$}":           "the front page",
	}
	registered := map[string]bool{}
	for _, r := range s.routes {
		registered[r] = true
	}
	covered := map[string]bool{}
	names := map[string]bool{}
	for _, tool := range mcpTools {
		if tool.Route == "" {
			t.Errorf("tool %s has no Route", tool.Name)
			continue
		}
		if names[tool.Name] {
			t.Errorf("duplicate tool name %s", tool.Name)
		}
		names[tool.Name] = true
		if !registered[tool.Route] {
			t.Errorf("tool %s points at %q, which is not a registered route", tool.Name, tool.Route)
		}
		if (strings.HasPrefix(tool.Route, "GET ") && tool.Write) || (!strings.HasPrefix(tool.Route, "GET ") && !tool.Write) {
			t.Errorf("tool %s: Write=%v does not match its route %s", tool.Name, tool.Write, tool.Route)
		}
		covered[tool.Route] = true
	}
	for r := range registered {
		if _, skip := notTools[r]; !skip && !covered[r] {
			t.Errorf("route %q has no MCP tool (add one in mcp.go, or list it in notTools with a reason)", r)
		}
	}
}
