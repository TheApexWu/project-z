# Browser Use Menu Spike

- Verdict: failed. Browser Use V4 accepted both DoorDash tasks with stealth enabled by default and a US residential proxy, but neither returned a structured menu before the required 90-second deadline. CSV remains the default and permanent menu source.
- 2026-08-09 attempt 1: McDonald's near `1 Apple Park Way, Cupertino, CA 95014`; run `262c0a99-67e7-44b3-bfa2-7304cbd7c637`; timed out at 90s with no result.
- 2026-08-09 attempt 2: Burger King near `1 Apple Park Way, Cupertino, CA 95014`; run `75403a1e-d347-4f2e-984c-171f10f84414`; timed out at 90s with no result.
- `grok-4.5` returned HTTP 403 for this Browser Use key, so the run requests used the credential's accepted default model instead.
