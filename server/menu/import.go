package menu

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type Stats struct {
	RowsRead       int
	LatestRows     int
	DeletedSkipped int
	MalformedRows  int
	ItemsUpserted  int
}

type record struct {
	createdOn              time.Time
	changeOperation        string
	market, city           string
	itemName, description  string
	priceCents             int
	itemImageURL, category string
	averageRating          *float64
	ratingCount            *int
	restaurantName         string
	restaurantDescription  string
	restaurantAddress      string
	restaurantImageURL     string
	priceRange             string
	latitude, longitude    *float64
}

func Import(ctx context.Context, conn *pgx.Conn, path string) (Stats, error) {
	f, err := os.Open(path)
	if err != nil {
		return Stats{}, fmt.Errorf("open CSV: %w", err)
	}
	defer f.Close()

	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	if _, err := r.Read(); err != nil {
		return Stats{}, fmt.Errorf("read CSV header: %w", err)
	}

	latest := make(map[string]record)
	stats := Stats{}
	for {
		row, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return stats, fmt.Errorf("read CSV row: %w", err)
		}
		stats.RowsRead++
		if len(row) < 19 {
			stats.MalformedRows++
			continue
		}
		rec, err := parseRecord(row)
		if err != nil {
			stats.MalformedRows++
			continue
		}
		if rec.restaurantName == "" || rec.itemName == "" {
			continue
		}
		key := strings.ToLower(rec.restaurantName) + "\x00" + strings.ToLower(rec.itemName)
		if old, ok := latest[key]; !ok || rec.createdOn.After(old.createdOn) {
			latest[key] = rec
		}
	}

	stats.LatestRows = len(latest)
	tx, err := conn.Begin(ctx)
	if err != nil {
		return stats, err
	}
	defer tx.Rollback(ctx)
	for _, rec := range latest {
		if strings.EqualFold(rec.changeOperation, "delete") {
			stats.DeletedSkipped++
			continue
		}
		var restaurantID int64
		err := tx.QueryRow(ctx, `INSERT INTO restaurants (name, description, address, city, market, image_url, price_range, latitude, longitude)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, address = EXCLUDED.address, city = EXCLUDED.city,
market = EXCLUDED.market, image_url = EXCLUDED.image_url, price_range = EXCLUDED.price_range, latitude = EXCLUDED.latitude,
longitude = EXCLUDED.longitude, updated_at = now() RETURNING id`, rec.restaurantName, rec.restaurantDescription,
			rec.restaurantAddress, rec.city, rec.market, rec.restaurantImageURL, rec.priceRange, rec.latitude, rec.longitude).Scan(&restaurantID)
		if err != nil {
			return stats, fmt.Errorf("upsert restaurant %q: %w", rec.restaurantName, err)
		}
		_, err = tx.Exec(ctx, `INSERT INTO menu_items (restaurant_id, name, description, price_cents, image_url, category, average_rating, rating_count, source_created_on)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
ON CONFLICT (restaurant_id, name) DO UPDATE SET description = EXCLUDED.description, price_cents = EXCLUDED.price_cents,
image_url = EXCLUDED.image_url, category = EXCLUDED.category, average_rating = EXCLUDED.average_rating,
rating_count = EXCLUDED.rating_count, source_created_on = EXCLUDED.source_created_on, updated_at = now()`, restaurantID,
			rec.itemName, rec.description, rec.priceCents, rec.itemImageURL, rec.category, rec.averageRating, rec.ratingCount, rec.createdOn)
		if err != nil {
			return stats, fmt.Errorf("upsert menu item %q: %w", rec.itemName, err)
		}
		stats.ItemsUpserted++
	}
	if err := tx.Commit(ctx); err != nil {
		return stats, err
	}
	return stats, nil
}

func parseRecord(row []string) (record, error) {
	if len(row) < 19 {
		return record{}, fmt.Errorf("CSV row has %d columns, expected 19", len(row))
	}
	createdOn, err := time.Parse("2006-01-02 15:04:05.0000000", row[0])
	if err != nil {
		return record{}, fmt.Errorf("parse createdOn %q: %w", row[0], err)
	}
	priceCents, err := priceInCents(row[6])
	if err != nil {
		return record{}, fmt.Errorf("parse price %q: %w", row[6], err)
	}
	return record{createdOn: createdOn, changeOperation: row[1], market: row[2], city: row[3], itemName: row[4], description: row[5], priceCents: priceCents, itemImageURL: row[8], category: row[9], averageRating: optionalFloat(row[10]), ratingCount: optionalInt(row[11]), restaurantName: row[12], restaurantDescription: row[13], restaurantAddress: row[14], restaurantImageURL: row[15], priceRange: row[16], latitude: optionalFloat(row[17]), longitude: optionalFloat(row[18])}, nil
}

func priceInCents(value string) (int, error) {
	value = strings.TrimSpace(strings.TrimPrefix(value, "$"))
	if value == "" {
		return 0, nil
	}
	parts := strings.SplitN(value, ".", 2)
	dollars, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, err
	}
	cents := 0
	if len(parts) == 2 {
		fraction := (parts[1] + "00")[:2]
		cents, err = strconv.Atoi(fraction)
		if err != nil {
			return 0, err
		}
	}
	return dollars*100 + cents, nil
}

func optionalFloat(value string) *float64 {
	v, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || strings.TrimSpace(value) == "" {
		return nil
	}
	return &v
}

func optionalInt(value string) *int {
	v, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || strings.TrimSpace(value) == "" {
		return nil
	}
	return &v
}
