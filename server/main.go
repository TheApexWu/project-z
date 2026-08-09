package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"group-grub/server/menu"
)

//go:embed migrations/*.sql
var migrations embed.FS

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer conn.Close(ctx)
	if err := migrate(ctx, conn); err != nil {
		log.Fatal(err)
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	if csvPath := os.Getenv("MENU_CSV_PATH"); csvPath != "" {
		stats, err := menu.Import(ctx, conn, csvPath)
		if err != nil {
			log.Fatalf("menu ingestion failed: %v", err)
		}
		log.Printf("menu ingestion complete: rows_read=%d latest_rows=%d deleted_skipped=%d malformed_rows=%d items_upserted=%d", stats.RowsRead, stats.LatestRows, stats.DeletedSkipped, stats.MalformedRows, stats.ItemsUpserted)
	}

	http.HandleFunc("/healthz", healthz)
	csvSource := menu.CsvSource{DatabaseURL: databaseURL}
	browserUseSource := menu.BrowserUseSource{
		APIKey:          os.Getenv("BROWSER_USER_API_KEY"),
		DeliveryAddress: os.Getenv("BROWSER_USE_DELIVERY_ADDRESS"),
		DatabaseURL:     databaseURL,
	}
	http.HandleFunc("/internal/menu", menuHandler(csvSource, browserUseSource, os.Getenv("MENU_SOURCE")))
	orders := &orderEngine{db: pool, now: time.Now}
	orders.startTicker(ctx)
	http.HandleFunc("/internal/orders/", orderHandler(orders))
	log.Printf("orchestrator listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func migrate(ctx context.Context, conn *pgx.Conn) error {
	files, err := migrations.ReadDir("migrations")
	if err != nil {
		return err
	}
	for _, file := range files {
		if filepath.Ext(file.Name()) != ".sql" {
			continue
		}
		sql, err := migrations.ReadFile("migrations/" + file.Name())
		if err != nil {
			return err
		}
		if _, err := conn.Exec(ctx, string(sql)); err != nil {
			return fmt.Errorf("run migration %s: %w", file.Name(), err)
		}
	}
	return nil
}

func menuHandler(csvSource menu.MenuSource, browserUseSource menu.MenuSource, configuredSource string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		query := strings.TrimSpace(r.URL.Query().Get("restaurant"))
		if query == "" {
			http.Error(w, "restaurant is required", http.StatusBadRequest)
			return
		}
		source := configuredSource
		if requested := r.URL.Query().Get("source"); requested == "browseruse" || requested == "csv" {
			source = requested
		}
		if source == "browseruse" {
			scrapeCtx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
			result, err := browserUseSource.Menu(scrapeCtx, query)
			cancel()
			if err == nil {
				writeMenu(w, result)
				return
			}
			log.Printf("browser-use menu lookup failed; falling back to CSV: %v", err)
		}
		csvCtx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		result, err := csvSource.Menu(csvCtx, query)
		if err != nil {
			http.Error(w, "restaurant not found", http.StatusNotFound)
			return
		}
		writeMenu(w, result)
	}
}

func writeMenu(w http.ResponseWriter, result menu.Result) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
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
