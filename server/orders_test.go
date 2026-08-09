package main

import (
	"errors"
	"testing"
	"time"
)

func TestOrderStateTransitions(t *testing.T) {
	transitions := [][2]string{
		{stateOpen, stateCollecting},
		{stateCollecting, stateGrace},
		{stateGrace, stateMinting},
		{stateMinting, stateSubmitting},
		{stateMinting, stateCancelled},
		{stateSubmitting, stateDeclinedProofCaptured},
		{stateDeclinedProofCaptured, stateClosed},
		{stateCollecting, stateCancelled},
	}
	for _, transition := range transitions {
		if !validTransition(transition[0], transition[1]) {
			t.Errorf("expected transition %s -> %s to be valid", transition[0], transition[1])
		}
	}
	if validTransition(stateGrace, stateCollecting) || validTransition(stateClosed, stateMinting) {
		t.Fatal("terminal or backward transition accepted")
	}
}

func TestBudgetSplitAndCap(t *testing.T) {
	share, err := splitBudget(1001, 3)
	if err != nil || share != 333 {
		t.Fatalf("share = %d, err = %v; want 333, nil", share, err)
	}
	if _, err := splitBudget(maxOrderCents+1, 1); !errors.Is(err, ErrBudgetExceeded) {
		t.Fatalf("cap error = %v, want %v", err, ErrBudgetExceeded)
	}
}

func TestGraceDeadlineUsesInjectedTime(t *testing.T) {
	now := time.Date(2026, time.August, 9, 12, 0, 0, 0, time.FixedZone("test", -7*60*60))
	got := graceDeadline(now)
	want := time.Date(2026, time.August, 9, 19, 2, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("grace deadline = %s, want %s", got, want)
	}
}

func TestCartOverBudgetRejected(t *testing.T) {
	if !cartWithinShare(600, 400, 1, 1000) {
		t.Fatal("cart equal to share was rejected")
	}
	if cartWithinShare(600, 401, 1, 1000) {
		t.Fatal("cart over share was accepted")
	}
}
