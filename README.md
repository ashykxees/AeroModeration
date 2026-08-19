# AeroModeration

AeroPulse Studios moderation bot with verification and logging.

## Commands

Restricted to the configured server and staff roles:

- `/ban <user> <reason>` — Bans a user and DMs them the reason.
- `/kick <user> <reason>` — Kicks a user and DMs them the reason.
- `/timeout <user> <duration> <reason>` — Timeouts a user and DMs them the reason/duration.
- `/whitelist <user|user_id>` — Whitelist a user so they bypass the 24h account-age check (server managers only).
- `/unwhitelist <user|user_id>` — Remove a user from the whitelist (server managers only).
- `/appaccept <user>` — Send a staff application acceptance DM with the assessment link.
- `/qaform <user>` — Send a QA agreement form DM.
- `/purge <amount>` — Delete up to 100 messages from the current channel (server admins only).
- `/ping` — Bot latency.

## Features

### Verification

On startup, the bot posts a verification message in `VERIFICATION_CHANNEL_ID`. Users react with ✅ to receive `VERIFIED_ROLE_ID` and have `UNVERIFIED_ROLE_ID` removed. The bot then DMs the user an embed confirming verification.

### Logging

- **Join/leave logs** go to `JOIN_LOG_CHANNEL_ID`.
  - Account created less than 24 hours ago? The user is kicked and logged.
  - If the bot bans/kicks someone, the reason is included in the leave log.
- **Moderation command logs** go to `MOD_LOG_CHANNEL_ID`.
  - Shows the command, variables, target, and moderator.
- **Bot filter channel** `BOT_FILTER_CHANNEL_ID`:
  - Any non-bot message is deleted.
  - First offense: kick + DM warning.
  - Rejoin and talk again: ban.
- **Message edit/delete logs** go to `MESSAGE_LOG_CHANNEL_ID`.

## Environment variables

Required:

- `DISCORD_TOKEN`

Optional (defaults are set to the AeroPulse server/roles/channels):

- `GUILD_ID` — Server the bot operates in.
- `ALLOWED_ROLE_IDS` — Comma-separated role IDs allowed to use moderation commands.
- `VERIFIED_ROLE_ID` — Role given after verification.
- `UNVERIFIED_ROLE_ID` — Role removed after verification (defaults to `1531865262989774908`).
- `VERIFICATION_CHANNEL_ID` — Channel for the verification message.
- `JOIN_LOG_CHANNEL_ID` — Channel for join/leave logs.
- `MOD_LOG_CHANNEL_ID` — Channel for moderation command logs.
- `BOT_FILTER_CHANNEL_ID` — Channel where talking is auto-deleted and triggers kick/ban.
- `MESSAGE_LOG_CHANNEL_ID` — Channel for message edit/delete logs.

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

Generate an invite URL in the Discord Developer Portal, or use this direct link (replace `YOUR_APPLICATION_ID`):

```
https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&permissions=1101927640134&scope=bot+applications.commands
```

This grants the permissions the bot needs for moderation, role management (verification), message deletion (filter channel), logging, and reactions. If you prefer, you can select **Administrator** instead.

> Make sure **Server Members Intent** and **Message Content Intent** are enabled under **Bot → Privileged Gateway Intents** in the Discord Developer Portal.
