# Get Discord bot tokens (≈5 minutes)

You need **two values** in `discord-bot/.env`:

| Variable | What it is |
|----------|------------|
| `DISCORD_TOKEN` | Bot login token (secret) |
| `DISCORD_CLIENT_ID` | Application ID |
| `DISCORD_GUILD_ID` | *(optional)* your test server ID — makes slash commands appear instantly |

Never commit `.env` or paste the token into chat/PRs.

---

## 1. Create the app + bot

1. Open the **[Discord Developer Portal](https://discord.com/developers/applications)** and sign in.
2. Click **New Application** → name it (e.g. `Clocktower`) → **Create**.
3. On **General Information**, copy **Application ID** → that is `DISCORD_CLIENT_ID`.
4. Open the **Bot** tab (left sidebar).
5. Click **Reset Token** / **View Token** → copy it → that is `DISCORD_TOKEN`.
   - If you don’t see a token yet, click **Add Bot** first, then reset/view.
6. On the same Bot page, disable **Public Bot** if this is only for your server (optional).
7. Under **Privileged Gateway Intents**, you can leave them **off** for this groundwork (slash commands + DMs don’t need message-content intent).

Official overview: [Building your first Discord bot](https://docs.discord.com/developers/quick-start/getting-started)

---

## 2. Invite the bot to your server

1. In the Developer Portal, open **OAuth2** → **URL Generator**.
2. Scopes: check **`bot`** and **`applications.commands`**.
3. Bot permissions (minimum that works for this scaffold):
   - **Send Messages**
   - **Embed Links**
   - **Read Message History** *(useful for panels in channels)*
4. Copy the generated URL at the bottom, open it in a browser, pick your server → **Authorize**.

Direct pattern (replace `CLIENT_ID`):

```text
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=2048&scope=bot%20applications.commands
```

(`2048` = Send Messages. Add more permissions in the URL Generator if you want.)

---

## 3. Get your test server ID (`DISCORD_GUILD_ID`)

1. In Discord: **User Settings** → **Advanced** → enable **Developer Mode**.
2. Right-click your server icon → **Copy Server ID**.

That ID makes `npm run bot:deploy` register commands **only on that server** (shows up in seconds). Without it, commands are global and can take up to ~1 hour.

---

## 4. Put them in `.env` and run

```bash
cd discord-bot
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_TOKEN=paste_bot_token_here
DISCORD_CLIENT_ID=paste_application_id_here
DISCORD_GUILD_ID=paste_server_id_here
DEFAULT_SCRIPT=trouble_brewing
```

Then:

```bash
npm install
npm run deploy-commands
npm start
```

In Discord, type `/clocktower` — you should see subcommands (`create`, `join`, …).

**Players need DMs open** for role cards / night prompts: Discord privacy settings → allow DMs from server members (at least while testing).

---

## 5. Quick smoke test (you + alts)

You don’t need five people for a first pass:

1. You: `/clocktower create` in a channel.
2. Join with your main + a few alt accounts (or friends): `/clocktower join`.
3. As ST: `/clocktower select-roles roles:Imp, Poisoner, Empath, Washerwoman, Butler` (match player count).
4. `/clocktower deal` → check DMs for roles.
5. `/clocktower start` → `/clocktower panel` → **Prompt player…**

One Discord account can’t sit as both ST and player in this design (ST is excluded from seats). Use alts or friends for the five seats.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| No `/clocktower` commands | Re-run `npm run deploy-commands` with `DISCORD_GUILD_ID` set; wait a bit; ensure bot was invited with `applications.commands`. |
| `Missing required environment variable` | `.env` missing or empty — path is `discord-bot/.env`. |
| Deal fails / “Could not DM” | Player must allow DMs from server members; bot must share a server with them. |
| Token invalid | Reset token in Developer Portal → Bot → update `.env`. |

If the token ever leaks: **Bot → Reset Token** immediately in the [Developer Portal](https://discord.com/developers/applications).
