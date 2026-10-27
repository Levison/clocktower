'use strict';

const { randomUUID } = require('crypto');
const { GameSession } = require('./session');
const { Phase } = require('./phases');

/**
 * In-memory game registry. One active game per guild for the groundwork.
 * Swap for Redis/SQLite later without changing command handlers much.
 */
class GameStore {
  constructor() {
    /** @type {Map<string, GameSession>} */
    this.byId = new Map();
    /** guildId -> gameId for the active session */
    this.activeByGuild = new Map();
  }

  /**
   * @param {{ guildId: string, channelId: string, storytellerId: string, scriptId?: string }} opts
   */
  create(opts) {
    const existingId = this.activeByGuild.get(opts.guildId);
    if (existingId) {
      const existing = this.byId.get(existingId);
      if (existing && existing.phase !== Phase.ENDED) {
        throw new Error('This server already has an active Clocktower game. End it first.');
      }
    }

    const session = new GameSession({
      id: randomUUID(),
      guildId: opts.guildId,
      channelId: opts.channelId,
      storytellerId: opts.storytellerId,
      scriptId: opts.scriptId,
    });
    this.byId.set(session.id, session);
    this.activeByGuild.set(opts.guildId, session.id);
    return session;
  }

  get(gameId) {
    return this.byId.get(gameId) || null;
  }

  getActiveForGuild(guildId) {
    const id = this.activeByGuild.get(guildId);
    if (!id) return null;
    const session = this.byId.get(id);
    if (!session || session.phase === Phase.ENDED) return null;
    return session;
  }

  /** Prefer guild active game; fall back to channel match */
  getForInteraction(guildId, channelId) {
    if (guildId) {
      const active = this.getActiveForGuild(guildId);
      if (active) return active;
    }
    for (const session of this.byId.values()) {
      if (session.phase === Phase.ENDED) continue;
      if (guildId && session.guildId === guildId && session.channelId === channelId) {
        return session;
      }
      if (channelId && session.storytellerChannelId === channelId) {
        return session;
      }
    }
    return null;
  }

  /** Resolve a game when the interaction may be in DMs (no guild). */
  getForUser(userId, guildId, channelId) {
    const fromContext = this.getForInteraction(guildId, channelId);
    if (fromContext) return fromContext;
    for (const session of this.byId.values()) {
      if (session.phase === Phase.ENDED) continue;
      if (session.storytellerId === userId) return session;
      if (session.players.has(userId)) return session;
    }
    return null;
  }

  end(gameId) {
    const session = this.byId.get(gameId);
    if (!session) return null;
    session.end();
    if (this.activeByGuild.get(session.guildId) === gameId) {
      this.activeByGuild.delete(session.guildId);
    }
    return session;
  }
}

const store = new GameStore();

module.exports = { GameStore, store };
