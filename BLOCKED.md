# Milestone 0 blocked

Date: 2026-08-08

## DoorDash Drive authentication

`API_KEYS` contains non-empty `DOORDASH_DEVELOPER_ID`, `DOORDASH_KEY_ID`, and `DOORDASH_SIGNING_SECRET`. I generated an HS256 JWT using the documented `DD-JWT-V1` header and `aud`, `iss`, `kid`, `iat`, and `exp` claims, then sent it as `Authorization: Bearer <jwt>` to `https://openapi.doordash.com/drive/v2/quotes` and `/drive/v2/deliveries/not-a-real-id`. Both returned HTTP 401: `The JWT is null, empty, or is just whitespaces`.

Human action required: verify that the three DoorDash sandbox credentials belong together and provide the correct Drive sandbox base URL or authentication requirements for this developer account.

## Slack runtime credentials

The Slack CLI successfully created and installed `Group Grub (local)` (app `A0BPUB0BJ0Y`) in workspace `hello rain xyz` (`T0BP3FGUGCU`). The installed app has `chat:write`, `im:write`, `commands`, `users:read`, and `channels:read`, and registered `/begin-order`.

The CLI-managed local app starts through Socket Mode but does not expose a static bot OAuth token or signing secret. `API_KEYS` cannot be updated with the required `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` from this environment.

Human action required: create or configure a conventional Slack API app from `slack-app/manifest.json`, install it to `hello rain xyz`, then add its bot OAuth token and signing secret to the ignored `API_KEYS` file as `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`.
