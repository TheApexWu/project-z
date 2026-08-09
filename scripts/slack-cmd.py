#!/usr/bin/env python3
"""Send a Slack-signed /begin-order command to the orchestrator (milestone 5 verification)."""
import hashlib, hmac, json, os, sys, time, urllib.parse, urllib.request

secret = os.environ["SLACK_SIGNING_SECRET"]
url = sys.argv[1]
text = sys.argv[2]
forged = len(sys.argv) > 3 and sys.argv[3] == "forged"

ts = str(int(time.time()))
form = {
    "command": "/begin-order",
    "text": text,
    "user_id": "U0BNXRCAQ3G",
    "user_name": "sd0bnthdjzs7_user",
    "channel_id": "C0BNXRJV3AS",
    "channel_name": "eats",
    "team_id": "T0BP3FGUGCU",
    "enterprise_id": "E0BNWAG5A4V",
    "response_url": "https://hooks.slack.com/commands/fake",
    "trigger_id": "fake",
}
body = urllib.parse.urlencode(form).encode()
sig = "v0=" + hmac.new(secret.encode(), b"v0:" + ts.encode() + b":" + body, hashlib.sha256).hexdigest()
if forged:
    sig = "v0=" + "0" * 64
req = urllib.request.Request(url, data=body, headers={
    "Content-Type": "application/x-www-form-urlencoded",
    "X-Slack-Request-Timestamp": ts,
    "X-Slack-Signature": sig,
})
try:
    with urllib.request.urlopen(req) as r:
        print("HTTP", r.status)
        print(r.read().decode())
except urllib.error.HTTPError as e:
    print("HTTP", e.code)
    print(e.read().decode())
