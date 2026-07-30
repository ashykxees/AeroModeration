# AeroModeration

AeroPulse Studios moderation bot with verification and logging.

## Commands

Restricted to the configured server and staff roles:

- `/ban <user> <reason>` — Bans a user and DMs them the reason.
- `/kick <user> <reason>` — Kicks a user and DMs them the reason.
- `/timeout <user> <duration> <reason>` — Timeouts a user and DMs them the reason/duration.
- `/ping` — Bot latency.

## Features

### Verification

On startup, the bot posts a verification message in `VERIFICATION_CHANNEL_ID`. Users react with ✅ to receive `VERIFIED_ROLE_ID`. The bot then DMs the user an embed confirming verification.

### Logging

- **Join/leave logs** go to `JOIN_LOG_CHANNEL_ID`.
  - Account created less than 24 hours ago? The user is kicked and logged.
  - If the bot bans/kicks someone, the reason is included in the leave log.
- **Moderation command logs** go to `MOD_LOG_CHANNEL_ID`.
  - Shows the command, variables, target, and moderator.

## Environment variables

Required:

- `DISCORD_TOKEN`

Optional (defaults are set to the AeroPulse server/roles/channels):

- `GUILD_ID` — Server the bot operates in.
- `ALLOWED_ROLE_IDS` — Comma-separated role IDs allowed to use moderation commands.
- `VERIFIED_ROLE_ID` — Role given after verification.
- `VERIFICATION_CHANNEL_ID` — Channel for the verification message.
- `JOIN_LOG_CHANNEL_ID` — Channel for join/leave logs.
- `MOD_LOG_CHANNEL_ID` — Channel for moderation command logs.

## Hosting

### Railway

1. Connect the `ashykxees/AeroModeration` GitHub repo.
2. Create a new service and set the start command to `npm start`.
3. Add the environment variables.
4. Make the service private (no public domain/port).

### Render

This repo includes `render.yaml` for a **Background Worker**.

1. In Render, choose **Blueprint** and select this repo.
2. Enter the environment variables when prompted.
3. Deploy.

The bot does not need a public port. A lightweight health server listens on `process.env.PORT || 3000` for hosts that expect one.

## Discord invite URL

Generate an invite URL in the Discord Developer Portal:

1. OAuth2 → URL Generator.
2. Check **bot** and **applications.commands**.
3. Select **Administrator** under Bot Permissions.
4. Copy the URL and open it in your browser.
