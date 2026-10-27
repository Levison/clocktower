# Clocktower Discord Bot (groundwork)

Scaffold for running **Blood on the Clocktower** in Discord: players sign in, the storyteller runs the table with structured controls, and private ability traffic goes through DMs / an action inbox.

This is intentionally a **foundation**, not a full rules engine. Night order, nominations, votes, and script-specific logic can build on the session + interaction patterns here. Role data is reused from the repo’s `/roles` JSON scripts.

## What you get

| Area | Capability |
|------|------------|
| **Sign-in** | `/clocktower create` · `/clocktower join` · `/clocktower leave` |
| **Setup** | `/clocktower select-roles` · `/clocktower deal` (DMs role cards) · `/clocktower start` |
| **Player actions** | `/clocktower action` (ephemeral) plus DM buttons / target select / freeform modal |
| **Storyteller** | `/clocktower panel` — advance phase, grimoire, prompt a player, resolve inbox items |
| **Privacy** | Role reveals and ability prompts via DM; ST notified of every submitted action |

## Architecture

```
discord-bot/
  src/
    index.js                 # Gateway client
    deploy-commands.js       # Register slash commands
    config.js
    commands/clocktower.js   # Slash command surface
    game/                    # Discord-agnostic session model
      session.js             # Players, roles, phases, action queue
      store.js               # In-memory games (one active per guild)
      phases.js · actions.js · roles.js
    discord/
      messaging.js           # Player DMs + ST notify
      storytellerPanel.js    # Buttons / resolve menu
      playerPrompt.js        # DM prompts + modals
      interactionRouter.js   # Routes commands & components
```

**Game flow (happy path)**

1. Storyteller: `/clocktower create` in the public table channel  
2. Players: `/clocktower join`  
3. ST: `/clocktower select-roles roles:Imp, Poisoner, …` (count must match players)  
4. ST: `/clocktower deal` → each player gets a role DM; ST sees the grimoire panel  
5. ST: `/clocktower start` → first night  
6. ST panel **Prompt player…** → player picks targets / writes an action in DM  
7. Action lands in the ST inbox → ST resolves it → **Advance phase** for day/night

## Setup

1. Create an application + bot in the [Discord Developer Portal](https://discord.com/developers/applications).  
2. Invite the bot with `applications.commands` and permission to send messages / embed links. Players must allow DMs from server members for role/ability messages.  
3. Copy env and fill in credentials:

```bash
cd discord-bot
cp .env.example .env
# edit DISCORD_TOKEN, DISCORD_CLIENT_ID, optional DISCORD_GUILD_ID
npm install
npm run deploy-commands
npm start
```

Use `DISCORD_GUILD_ID` while developing so slash commands appear immediately.

## Scripts

```bash
npm start              # run the bot
npm run deploy-commands
npm test               # session/unit tests (no Discord token needed)
```

From the repo root you can also use `npm run bot` / `npm run bot:deploy` / `npm run bot:test` once those scripts are wired in the root `package.json`.

## Next steps (not in this groundwork)

- Persist games (SQLite/Redis) and restore ST panels after restart  
- Scripted night-order wake lists and automatic ST prompts  
- Public nomination / vote flows with Discord components  
- Optional private ST text channel creation + permissions  
- Travellers, fabled, and dead-vote tracking  
- Bridge to the existing Express lobby (`server.js`) if you want web + Discord seats

## Notes

- One **active** game per Discord server for now (`GameStore`).  
- The storyteller is **not** seated and does not receive a player role.  
- State is **in-memory**; restarting the process ends active games.
