package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	http.HandleFunc("/healthz", healthz)
	log.Printf("orchestrator listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func healthz(w http.ResponseWriter, r *http.Request) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		http.Error(w, "database ping: DATABASE_URL is not configured", http.StatusServiceUnavailable)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, databaseURL)
	if err == nil {
		err = conn.Ping(ctx)
		conn.Close(ctx)
	}
	if err != nil {
		http.Error(w, fmt.Sprintf("database ping: failed: %v", err), http.StatusServiceUnavailable)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintln(w, "ok; database ping: succeeded")
}
