# Milestone 5 Blocked

The Group Grub Slack app is an enterprise install but is not granted access to a Slack workspace. `auth.test` succeeds, while `users.list` and `conversations.list` reject the bot with `team_access_not_granted`, so it cannot discover test users, post an announcement, or open participant DMs.

The configured bot token has only `chat:write, im:write, commands, users:read, channels:read`. An attempted `apps.manifest.update` was rejected with `missing_scope` for `app_configurations:write`, so the slash command cannot be configured to route to the deployed `/slack/commands` endpoint from this environment.

I deployed the implementation successfully to the Railway orchestrator and verified the Go tests. A Slack organization/app administrator must grant app `A0BPUB0BJ0Y` access to the intended workspace, configure `/begin-order` to POST to `https://orchestrator-production-ef93.up.railway.app/slack/commands`, and authorize an app-configuration token with `app_configurations:write` if manifest updates should be automated. They must also add at least one test order creator to the `admins` table before the authorized command verification can run.
