// Command server is the Creator OS API. It serves the CRM and Overview data over HTTP and shares
// the SQLite file with the Next.js app. Run it from /backend: `go run ./cmd/server`.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"creatoros/internal/api"
	"creatoros/internal/config"
	"creatoros/internal/store"
)

func main() {
	cfg := config.Load()
	st, err := store.FromConfig(cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer st.Close()

	if cfg.Token == "" && !isLoopback(cfg.Addr) {
		log.Fatal("API_TOKEN must be set when the API listens beyond this computer")
	}
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           (&api.Server{Store: st, Token: cfg.Token, MCPReadOnly: cfg.MCPReadOnly}).Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	mode := "demo"
	if cfg.Live {
		mode = "LIVE"
	}
	log.Printf("Creator OS API on http://%s · %s mode · today %s · database %s", cfg.Addr, mode, st.Today(), cfg.DBPath)
	if cfg.MCPReadOnly {
		log.Printf("MCP at /mcp: READ-ONLY (MCP_READ_ONLY=1)")
	} else {
		log.Printf("MCP at /mcp: read + WRITE tools (set MCP_READ_ONLY=1 to hide the write tools)")
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func isLoopback(addr string) bool {
	for _, p := range []string{"127.0.0.1:", "localhost:", "[::1]:"} {
		if len(addr) >= len(p) && addr[:len(p)] == p {
			return true
		}
	}
	return false
}
