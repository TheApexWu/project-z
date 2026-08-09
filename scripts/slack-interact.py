#!/usr/bin/env python3
"""Send a Slack-signed block_actions (button click) payload to the orchestrator.

Usage: slack-interact.py <url> <order-id> [user_id] [forged]
Defaults to the admin user; pass another workspace user id to test the
non-admin path, or 'forged' to test signature rejection.
"""
import hashlib, hmac, json, os, sys, time, urllib.parse, urllib.request

secret = os.environ["SLACK_SIGNING_SECRET"]
url = sys.argv[1]
order_id = sys.argv[2]
user_id = sys.argv[3] if len(sys.argv) > 3 else "U0BNXRCAQ3G"
forged = len(sys.argv) > 4 and sys.argv[4] == "forged"

payload = {
    "type": "block_actions",
    "user": {"id": user_id},
    "response_url": "https://hooks.slack.com/actions/fake",
    "channel": {"id": "C0BNXRJV3AS"},
    "message": {"ts": "0.0"},
    "actions": [{"action_id": "end_order", "value": order_id, "type": "button"}],
}
body = urllib.parse.urlencode({"payload": json.dumps(payload)}).encode()

ts = str(int(time.time()))
sig = "v0=" + hmac.new(secret.encode(), b"v0:" + ts.encode() + b":" + body, hashlib.sha256).hexdigest()
if forged:
    sig = "v0=forged"

req = urllib.request.Request(url, data=body, headers={
    "Content-Type": "application/x-www-form-urlencoded",
    "X-Slack-Request-Timestamp": ts,
    "X-Slack-Signature": sig,
})
try:
    with urllib.request.urlopen(req, timeout=15) as response:
        print("HTTP", response.status)
        print(response.read().decode() or "(empty body)")
except urllib.error.HTTPError as error:
    print("HTTP", error.code)
    print(error.read().decode())
