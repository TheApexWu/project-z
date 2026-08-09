package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5"
	"group-grub/server/menu"
)

func main() {
	if len(os.Args) != 2 {
		log.Fatal("usage: ingest <path-to-restaurantmenuchanges.csv>")
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
	stats, err := menu.Import(ctx, conn, os.Args[1])
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("ingestion complete: rows_read=%d latest_rows=%d deleted_skipped=%d malformed_rows=%d items_upserted=%d\n", stats.RowsRead, stats.LatestRows, stats.DeletedSkipped, stats.MalformedRows, stats.ItemsUpserted)
}
