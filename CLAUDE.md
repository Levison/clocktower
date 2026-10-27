# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
npm start      # Start the development server (port 7105)
npm run dev    # Same as npm start
node server.js # Direct server execution
```

The server runs on `http://localhost:7105` by default, or the port specified by `process.env.PORT`.

## Architecture

This is a **Blood on the Clocktower** online lobby application built with Node.js/Express backend and vanilla JavaScript frontend.

### Backend Structure (`server.js`)
- **Express server** with Socket.io for real-time communication
- **In-memory storage** using Maps for rooms, players, and role assignments
- **RESTful API** for room management, role assignment, and player authentication
- **Cookie-based sessions** with UUID player IDs (7-day expiration)
- **Host-based rooms** with 4-letter codes (excluding I/O to avoid confusion)

### Frontend Structure (`public/`)
- **Single-page application** (`app.js`) with screen-based navigation
- **Socket.io client** for real-time updates (player joins/leaves, role assignments)
- **ClockTowerApp class** manages all client state and API interactions
- **Gothic theme** with CSS custom properties and monospace Hack font

### Key Data Flow
1. **Session Management**: Players get persistent IDs via cookies, assigned random animal emojis
2. **Room Lifecycle**: Host creates room → players join → roles selected → roles assigned → game begins
3. **Role System**: Host excludes themselves from role assignment, sees "Grimoire" with all player roles
4. **Real-time Events**: Socket.io broadcasts player updates, role assignments, host changes

### Core Features
- **Room Management**: Create/join with 4-letter codes, automatic host transfer on leave
- **Role Selection**: Host picks from categorized roles (Townsfolk/Outsiders/Minions/Demons)  
- **Role Assignment**: Random 1:1 mapping of selected roles to non-host players
- **Grimoire View**: Host-only interface showing all assigned player roles
- **Roles In Play**: Public display of selected roles after assignment

### File Structure
```
server.js           # Main Express server and API endpoints
src/                # Parcel frontend (HTML/JS/CSS)
roles/              # Role set JSON scripts
discord-bot/        # Discord bot groundwork (storyteller panel + player DMs)
animal_emojis.txt   # Random emoji assignment for players
```

### Discord bot (`discord-bot/`)
Scaffold for running games in Discord: `/clocktower` slash commands, in-memory `GameSession`, storyteller component panel, and private player DMs for roles/actions. See `discord-bot/README.md`.

```bash
npm run bot:test      # unit tests (no token)
npm run bot:deploy    # register slash commands (needs .env)
npm run bot           # start the bot
```

## Testing

Web lobby: manual testing via the web interface (`npm run test:game` for Playwright multi-browser).  
Discord bot session model: `npm run bot:test`.

## Dependencies

- **express**: Web server framework  
- **socket.io**: Real-time bidirectional communication
- **uuid**: Generate unique player IDs
- **cookie-parser**: Handle session cookies