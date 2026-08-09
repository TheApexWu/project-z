# Milestone 0 blocked

## Missing Slack runtime credentials

`./scripts/preflight.sh` passes Kubernetes (three Ready nodes), Rain, OpenRouter, authenticated DoorDash (404 rather than 401/403), Browser Use, the Docker registry smoke push, and Railway project linking. It then exits 1 because `API_KEYS` has neither `SLACK_BOT_TOKEN` nor `SLACK_SIGNING_SECRET`.

The locally authenticated Slack CLI only proves organization-level auth; it does not expose a static bot OAuth token or request-signing secret for the installed Group Grub app (`A0BPUB0BJ0Y`). `slack app list` also cannot inspect it from this repository because it is not a Slack app project directory.

Human action required: open the app's Slack API settings, install or configure it as a conventional Slack API app if necessary, and add the bot user OAuth token (`xoxb-...`) as `SLACK_BOT_TOKEN` plus the request-signing secret as `SLACK_SIGNING_SECRET` to the ignored `API_KEYS` file. Then rerun `./scripts/preflight.sh`.
