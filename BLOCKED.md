# Milestone 0 blocked

## Missing Slack runtime credentials

`Group Grub` app `A0BPUB0BJ0Y` is installed in `rain-hackathon-sand` and its remote manifest confirms `/begin-order` plus the required bot scopes. `slack auth list`, `slack app list`, and `slack manifest info --source remote --app A0BPUB0BJ0Y` all succeed.

The CLI-managed local installation does not expose a static bot OAuth token or request-signing secret. `API_KEYS` is missing the required `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`, so the preflight intentionally exits nonzero after all other checks pass.

Human action required: open the Slack app settings for `A0BPUB0BJ0Y`, install/configure it as a conventional Slack API app if necessary, then add its bot user OAuth token (`xoxb-...`) as `SLACK_BOT_TOKEN` and its request signing secret as `SLACK_SIGNING_SECRET` to the ignored `API_KEYS` file. Re-run `./scripts/preflight.sh` afterward.
