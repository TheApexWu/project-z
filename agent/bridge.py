#!/usr/bin/env python3
"""Slack DM bridge for one Group Grub participant agent.

Polls the participant's DM channel, feeds new messages to goose (OpenRouter
z-ai/glm-5.2 + the group-grub MCP tools), and posts goose's replies back.

Any DM message whose ts was not posted by this bridge is treated as participant
input. That covers real humans and scripted messages posted with the bot token
(the e2e/milestone verification path), since the bridge records every ts it posts.
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BOT_TOKEN = os.environ["SLACK_BOT_TOKEN"]
DM_CHANNEL = os.environ["DM_CHANNEL_ID"]
ORDER_ID = os.environ["ORDER_ID"]
UID = os.environ["PARTICIPANT_SLACK_ID"]
ORCH = os.environ["ORCHESTRATOR_URL"].rstrip("/")
RESTAURANT = os.environ.get("RESTAURANT", "the restaurant")
SHARE_CENTS = int(os.environ.get("SHARE_CENTS", "0"))
MODEL = os.environ.get("GOOSE_MODEL", "z-ai/glm-5.2")
PROVIDER = os.environ.get("GOOSE_PROVIDER", "openrouter")

POLL_SECONDS = 3
GOOSE_TIMEOUT = 240
MAX_RUNTIME = 3 * 60 * 60

SYSTEM_PROMPT = f"""You are a friendly food-ordering assistant in a Slack DM, helping one participant build their sub-order for a group order at {RESTAURANT}.

Rules:
- The participant's budget share is ${SHARE_CENTS / 100:.2f}. ALWAYS keep the cart total at or under this budget. If an add would exceed it, the server rejects it: explain the budget and suggest what to remove.
- Only offer real items returned by the list_menu/search_menu tools, with their real prices. Never invent items or prices.
- Use add_item with the menu_item_id from search_menu/list_menu results.
- When the user seems finished, call propose_confirmation and present the proposal. Only call submit_confirmation after the user explicitly says yes (or clearly confirms).
- The user may return and modify their order any time before the group order closes; adding or removing items automatically un-confirms them.
- Keep replies short and conversational (Slack DM). Use $ prices, not cents."""

GREETING = (
    "[setup] The participant was just invited to this group order. Greet them in one sentence, "
    "tell them their budget share (use get_budget), and suggest 3-4 menu items with prices "
    "(use list_menu). Keep it short."
)


def log(message):
    print(f"[bridge] {message}", flush=True)


def slack_api(method, payload):
    request = urllib.request.Request(
        "https://slack.com/api/" + method,
        data=json.dumps(payload).encode(),
        headers={"Authorization": "Bearer " + BOT_TOKEN, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        result = json.loads(response.read().decode())
    if not result.get("ok"):
        raise RuntimeError(f"slack {method}: {result.get('error')}")
    return result


def post_message(text):
    result = slack_api("chat.postMessage", {"channel": DM_CHANNEL, "text": text})
    return result["ts"]


def order_state():
    request = urllib.request.Request(ORCH + f"/internal/orders/{ORDER_ID}")
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode()).get("state", "")


def extract_reply(output):
    """Pull the final assistant text out of goose's stream-json events."""
    texts_by_id = {}
    for line in output.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") != "message":
            continue
        message = event.get("message", {})
        if message.get("role") != "assistant":
            continue
        for part in message.get("content", []):
            if part.get("type") == "text":
                texts_by_id.setdefault(message.get("id"), []).append(part.get("text", ""))
    for message_id in reversed(list(texts_by_id.keys())):
        text = "".join(texts_by_id[message_id]).strip()
        if text:
            return text
    return ""


def goose_turn(text, resume):
    command = [
        "goose", "run", "-n", "dm", "--no-profile",
        "--max-turns", "15",
        "--max-tool-repetitions", "3",
        "--output-format", "stream-json",
        "--with-extension", "python3 /opt/agent/mcp_tools.py",
        "--system", SYSTEM_PROMPT,
        "-t", text,
    ]
    if resume:
        command.append("--resume")
    log(f"goose turn start (provider={PROVIDER} model={MODEL} resume={resume}): {text[:80]!r}")
    started = time.time()
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=GOOSE_TIMEOUT)
    except subprocess.TimeoutExpired:
        log(f"goose turn timed out after {GOOSE_TIMEOUT}s")
        return "Sorry, that took me too long to think through — could you try again?"
    elapsed = time.time() - started
    if result.returncode != 0:
        log(f"goose exited {result.returncode} after {elapsed:.1f}s; stderr tail: {result.stderr[-500:]!r}")
    reply = extract_reply(result.stdout)
    log(f"goose turn done in {elapsed:.1f}s via {PROVIDER}/{MODEL}, reply {len(reply)} chars")
    return reply or "Sorry, I drew a blank — could you rephrase that?"


def write_tool_config():
    with open("/tmp/agent-env.json", "w") as handle:
        json.dump({
            "ORCHESTRATOR_URL": ORCH,
            "ORDER_ID": ORDER_ID,
            "PARTICIPANT_SLACK_ID": UID,
            "RESTAURANT": RESTAURANT,
        }, handle)


def main():
    write_tool_config()
    log(f"agent starting: order={ORDER_ID} participant={UID} dm={DM_CHANNEL} restaurant={RESTAURANT!r} share=${SHARE_CENTS / 100:.2f} provider={PROVIDER} model={MODEL}")

    posted_ts = set()
    history = slack_api("conversations.history", {"channel": DM_CHANNEL, "limit": 5})
    last_ts = max((float(m["ts"]) for m in history.get("messages", [])), default=0.0)
    log(f"baselined at ts {last_ts}; {len(history.get('messages', []))} existing messages skipped")

    reply = goose_turn(GREETING, resume=False)
    posted_ts.add(post_message(reply))

    deadline = time.time() + MAX_RUNTIME
    while time.time() < deadline:
        try:
            state = order_state()
        except Exception as error:
            log(f"order state check failed: {error}")
            state = ""
        if state and state not in ("COLLECTING", "GRACE"):
            log(f"order state is {state}; shutting down")
            try:
                if state in ("CANCELLED", "FAILED"):
                    post_message(f"This group order has closed (status: {state}).")
                else:
                    post_message("Your order is in! 🛵 The group order is being submitted — thanks for ordering.")
            except Exception as error:
                log(f"closing message failed: {error}")
            return
        try:
            params = {"channel": DM_CHANNEL, "limit": 50}
            if last_ts > 0:
                params["oldest"] = repr(last_ts)
            history = slack_api("conversations.history", params)
        except Exception as error:
            log(f"history poll failed: {error}")
            time.sleep(POLL_SECONDS)
            continue
        messages = history.get("messages", [])
        fresh = [m for m in messages if float(m["ts"]) > last_ts]
        if messages:
            last_ts = max(last_ts, max(float(m["ts"]) for m in messages))
        pending = [m for m in fresh if m["ts"] not in posted_ts and m.get("subtype") is None]
        pending.sort(key=lambda m: float(m["ts"]))
        for message in pending:
            text = (message.get("text") or "").strip()
            if not text:
                continue
            log(f"incoming message ts={message['ts']}: {text[:80]!r}")
            reply = goose_turn(text, resume=True)
            posted_ts.add(post_message(reply))
        time.sleep(POLL_SECONDS)
    log("max runtime reached; exiting")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log(f"fatal: {error}")
        sys.exit(1)
