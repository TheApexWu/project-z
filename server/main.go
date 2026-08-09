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
	if csvPath := os.Getenv("MENU_CSV_PATH"); csvPath != "" {
		stats, err := menu.Import(ctx, conn, csvPath)
		if err != nil {
			log.Fatalf("menu ingestion failed: %v", err)
		}
		log.Printf("menu ingestion complete: rows_read=%d latest_rows=%d deleted_skipped=%d malformed_rows=%d items_upserted=%d", stats.RowsRead, stats.LatestRows, stats.DeletedSkipped, stats.MalformedRows, stats.ItemsUpserted)
	}

	http.HandleFunc("/healthz", healthz)
	http.HandleFunc("/internal/menu", menuHandler(databaseURL))
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

func menuHandler(databaseURL string) http.HandlerFunc {
	type item struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		PriceCents  int    `json:"price_cents"`
		Category    string `json:"category"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		query := strings.TrimSpace(r.URL.Query().Get("restaurant"))
		if query == "" {
			http.Error(w, "restaurant is required", http.StatusBadRequest)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		conn, err := pgx.Connect(ctx, databaseURL)
		if err != nil {
			http.Error(w, "database unavailable", http.StatusServiceUnavailable)
			return
		}
		defer conn.Close(ctx)
		const normalized = "regexp_replace(lower(r.name), '[^a-z0-9]+', '', 'g')"
		var restaurant string
		err = conn.QueryRow(ctx, "WITH query AS (SELECT regexp_replace(lower($1), '[^a-z0-9]+', '', 'g') AS name) SELECT r.name FROM restaurants r CROSS JOIN query q WHERE "+normalized+" LIKE '%' || q.name || '%' OR q.name LIKE '%' || "+normalized+" || '%' ORDER BY CASE WHEN "+normalized+" = q.name THEN 0 WHEN "+normalized+" LIKE '%' || q.name || '%' THEN 1 ELSE 2 END, length(r.name) LIMIT 1", query).Scan(&restaurant)
		if err != nil {
			http.Error(w, "restaurant not found", http.StatusNotFound)
			return
		}
		rows, err := conn.Query(ctx, `SELECT mi.name, mi.description, mi.price_cents, mi.category FROM menu_items mi JOIN restaurants r ON r.id = mi.restaurant_id WHERE r.name = $1 ORDER BY mi.category, mi.name`, restaurant)
		if err != nil {
			http.Error(w, "query menu: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		items := []item{}
		for rows.Next() {
			var i item
			if err := rows.Scan(&i.Name, &i.Description, &i.PriceCents, &i.Category); err != nil {
				http.Error(w, "read menu: "+err.Error(), http.StatusInternalServerError)
				return
			}
			items = append(items, i)
		}
		if err := rows.Err(); err != nil {
			http.Error(w, "read menu: "+err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(struct {
			Restaurant string `json:"restaurant"`
			Items      []item `json:"items"`
		}{restaurant, items})
	}
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
