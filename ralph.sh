#!/usr/bin/env bash
# Ralph loop: one milestone per iteration, driven by PRD.JSON, until every milestone is completed.
set -u

cd "$(dirname "$0")"

ONCE=0
if [ "${1:-}" = "--once" ]; then
  ONCE=1
fi

# OpenRouter routing for this model is pinned to the baseten/fp8 endpoint in
# ./opencode.json; the loop cd's here first, so opencode picks that config up.
MODEL="openrouter/moonshotai/kimi-k3"
LOG_DIR="logs"
MAX_RETRIES_PER_MILESTONE=5

mkdir -p "$LOG_DIR"

# --- helpers -----------------------------------------------------------------

next_milestone() {
  # prints "<id>\t<name>" of first milestone with completed == false, or nothing if all done
  python3 - <<'EOF'
import json
prd = json.load(open("PRD.JSON"))
for m in prd["milestones"]:
    if not m.get("completed", False):
        print(f"{m['id']}\t{m['name']}")
        break
EOF
}

milestone_completed() {
  # exit 0 if milestone $1 is completed
  python3 - "$1" <<'EOF'
import json, sys
prd = json.load(open("PRD.JSON"))
mid = int(sys.argv[1])
m = next(m for m in prd["milestones"] if m["id"] == mid)
sys.exit(0 if m.get("completed", False) else 1)
EOF
}

update_ralph_md() {
  local last_finished="$1" current="$2"
  {
    echo "# RALPH loop status"
    echo
    echo "- updated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "- last finished: ${last_finished}"
    echo "- currently working on: ${current}"
    echo
    echo "## Iteration history"
    [ -f RALPH.md ] && sed -n '/^## Iteration history$/,$p' RALPH.md | tail -n +2
  } > RALPH.md.tmp
  mv RALPH.md.tmp RALPH.md
}

append_history() {
  echo "- $(date -u +%Y-%m-%dT%H:%M:%SZ) $1" >> RALPH.md
}

commit_and_push() {
  local msg="$1"
  git add -A
  if ! git diff --cached --quiet; then
    git commit -m "$msg"
  fi
  git push || append_history "WARN: git push failed for '$msg' (will retry next iteration)"
}

write_blocked() {
  local mid="$1" reason="$2" log="$3"
  {
    echo "# BLOCKED"
    echo
    echo "- time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "- milestone: $mid"
    echo "- reason: $reason"
    echo
    echo "## Last agent output (tail)"
    echo '```'
    tail -n 80 "$log" 2>/dev/null
    echo '```'
  } > BLOCKED.md
  commit_and_push "ralph: BLOCKED on milestone $mid"
}

# --- main loop ---------------------------------------------------------------

iteration=0
retries=0
last_mid=""
last_finished="(nothing yet)"

while true; do
  # blocked? stop.
  if [ -f BLOCKED.md ]; then
    echo "BLOCKED.md exists — halting Ralph loop. Resolve it and delete BLOCKED.md to resume."
    exit 2
  fi

  target="$(next_milestone)"
  if [ -z "$target" ]; then
    update_ralph_md "$last_finished" "ALL MILESTONES COMPLETE"
    append_history "ALL MILESTONES COMPLETE"
    commit_and_push "ralph: all milestones complete"
    echo "All milestones complete."
    exit 0
  fi

  mid="$(printf '%s' "$target" | cut -f1)"
  mname="$(printf '%s' "$target" | cut -f2-)"

  # retry accounting: same milestone as last attempt => retry, else fresh
  if [ "$mid" = "$last_mid" ]; then
    retries=$((retries + 1))
  else
    retries=0
    last_mid="$mid"
  fi

  if [ "$retries" -ge "$MAX_RETRIES_PER_MILESTONE" ]; then
    write_blocked "$mid ($mname)" \
      "Milestone attempted $retries times without being marked completed. Likely persistently failing verifications or repeated context exhaustion." \
      "$LOG_DIR/milestone-$mid-attempt-$((retries)).log"
    continue
  fi

  iteration=$((iteration + 1))
  log="$LOG_DIR/milestone-$mid-attempt-$((retries + 1)).log"

  update_ralph_md "$last_finished" "milestone $mid: $mname (iteration $iteration, attempt $((retries + 1)))"
  append_history "START iteration $iteration -> milestone $mid ($mname), attempt $((retries + 1))"

  prompt="You are one iteration of the Ralph loop for this project.

Read PRD.JSON in full first — project.full_context is the source of truth and hard_rules are non-negotiable.

Your ONLY job this iteration: milestone $mid — \"$mname\".

Rules for this iteration:
1. Work ONLY on milestone $mid. Do NOT touch, re-run, or re-verify any milestone already marked completed:true — trust them.
2. Run ./scripts/preflight.sh first if it exists and milestone $mid > 0; if it fails due to environment drift, fix the environment, but do not redo completed milestones.
3. Read ./docs-notes/*.md and RALPH.md for context left by previous iterations. Leave terse notes there for the next iteration.
4. Complete every task in the milestone, then run EVERY item in its verifications array and make them pass.
5. When (and only when) all verifications pass: edit PRD.JSON to set this milestone's completed to true and add an 'evidence' field (one line per verification describing proof).
6. Commit all work with message 'ralph: milestone $mid complete — $mname' and push.
7. If you become COMPLETELY blocked (missing credential you cannot obtain, external service permanently failing, contradiction in requirements), create BLOCKED.md explaining exactly what is blocking you, what you tried, and what a human must do — then stop.
8. Keep code comments minimal and only where they inform the next loop iteration. Do not write exhaustive tests; only test what the PRD says to test."

  # Run the agent. Stream everything (including thinking deltas) to console + per-attempt log.
  opencode run \
    --model "$MODEL" \
    --thinking \
    --auto \
    --title "ralph: milestone $mid attempt $((retries + 1))" \
    "$prompt" 2>&1 | tee "$log"
  rc=${PIPESTATUS[0]}

  if [ -f BLOCKED.md ]; then
    echo "Agent reported BLOCKED — halting."
    append_history "BLOCKED on milestone $mid (see BLOCKED.md)"
    commit_and_push "ralph: BLOCKED on milestone $mid"
    exit 2
  fi

  if milestone_completed "$mid"; then
    last_finished="milestone $mid: $mname"
    retries=0
    last_mid=""
    append_history "DONE milestone $mid ($mname)"
    update_ralph_md "$last_finished" "(between milestones)"
    # ensure the milestone landed in git even if the agent forgot to commit/push
    commit_and_push "ralph: milestone $mid complete — $mname"
  else
    # not completed: context window filled, crash, or verifications failed — retry same milestone
    append_history "RETRY milestone $mid (exit=$rc, not marked completed; attempt $((retries + 1)) logged to $log)"
    sleep 15
  fi

  if [ "$ONCE" -eq 1 ]; then
    echo "--once requested: stopping after single iteration."
    exit 0
  fi
done
