package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"group-grub/server/menu"
)

type testMenuSource func(context.Context, string) (menu.Result, error)

func (s testMenuSource) Menu(ctx context.Context, restaurant string) (menu.Result, error) {
	return s(ctx, restaurant)
}

func TestMenuHandlerFallsBackToCSV(t *testing.T) {
	csv := testMenuSource(func(context.Context, string) (menu.Result, error) {
		return menu.Result{Restaurant: "Subway", Items: []menu.Item{{Name: "Sandwich", PriceCents: 599}}}, nil
	})
	browserUse := testMenuSource(func(context.Context, string) (menu.Result, error) {
		return menu.Result{}, errors.New("network unavailable")
	})
	request := httptest.NewRequest(http.MethodGet, "/internal/menu?restaurant=Subway", nil)
	recorder := httptest.NewRecorder()
	menuHandler(csv, browserUse, "browseruse")(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Body.String(); got != "{\"restaurant\":\"Subway\",\"items\":[{\"name\":\"Sandwich\",\"description\":\"\",\"price_cents\":599,\"category\":\"\"}]}\n" {
		t.Fatalf("unexpected fallback result: %s", got)
	}
}
