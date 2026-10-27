'use strict';

const { Phase, PHASE_LABELS, nextPhase } = require('./phases');
const { ActionStatus, createAction } = require('./actions');
const { getScript, findRole } = require('./roles');

/**
 * One Clocktower game bound to a Discord guild (and optionally a channel).
 * Discord IDs are stored as strings; presentation lives in discord/*.
 */
class GameSession {
  /**
   * @param {object} opts
   * @param {string} opts.id
   * @param {string} opts.guildId
   * @param {string} opts.channelId Public game channel
   * @param {string} opts.storytellerId Discord user id of the ST
   * @param {string} [opts.scriptId]
   */
  constructor(opts) {
    this.id = opts.id;
    this.guildId = opts.guildId;
    this.channelId = opts.channelId;
    this.storytellerId = opts.storytellerId;
    this.scriptId = opts.scriptId || 'trouble_brewing';
    this.phase = Phase.LOBBY;
    this.dayNumber = 0;
    this.createdAt = Date.now();
    this.endedAt = null;

    /** @type {Map<string, PlayerSeat>} discordUserId -> seat */
    this.players = new Map();

    /** Selected roles for the bag (not yet assigned) */
    this.selectedRoles = [];

    /** @type {import('./actions').createAction extends Function ? ReturnType<typeof createAction>[] : never} */
    this.actions = [];

    /** Discord channel id for storyteller-only traffic (optional) */
    this.storytellerChannelId = null;

    /** Message id of the pinned ST control panel, if posted */
    this.storytellerPanelMessageId = null;
  }

  get script() {
    return getScript(this.scriptId);
  }

  get phaseLabel() {
    return PHASE_LABELS[this.phase] || this.phase;
  }

  get livingPlayers() {
    return [...this.players.values()].filter((p) => !p.isDead);
  }

  isStoryteller(userId) {
    return this.storytellerId === userId;
  }

  isSignedIn(userId) {
    return this.players.has(userId);
  }

  /**
   * @param {{ userId: string, displayName: string }} player
   */
  signIn(player) {
    if (this.phase !== Phase.LOBBY && this.phase !== Phase.SETUP) {
      throw new Error('Sign-in is only open during lobby/setup.');
    }
    if (player.userId === this.storytellerId) {
      throw new Error('The storyteller does not take a player seat.');
    }
    if (this.players.has(player.userId)) {
      return this.players.get(player.userId);
    }
    const seat = {
      userId: player.userId,
      displayName: player.displayName,
      seatIndex: this.players.size,
      role: null,
      isDead: false,
      isDrunk: false,
      signedInAt: Date.now(),
    };
    this.players.set(player.userId, seat);
    return seat;
  }

  signOut(userId) {
    if (this.phase !== Phase.LOBBY && this.phase !== Phase.SETUP) {
      throw new Error('Players can only leave before the game starts.');
    }
    return this.players.delete(userId);
  }

  setScript(scriptId) {
    if (!getScript(scriptId)) {
      throw new Error(`Unknown script: ${scriptId}`);
    }
    this.scriptId = scriptId;
    this.selectedRoles = [];
  }

  /**
   * @param {Array<{ name: string, category?: string }>} roles
   */
  setSelectedRoles(roles) {
    const resolved = [];
    for (const r of roles) {
      const found = findRole(this.scriptId, r.name);
      if (!found) throw new Error(`Role not in script: ${r.name}`);
      resolved.push(found);
    }
    this.selectedRoles = resolved;
  }

  assignRoles(rng = Math.random) {
    const seats = [...this.players.values()];
    if (seats.length === 0) throw new Error('No signed-in players.');
    if (this.selectedRoles.length !== seats.length) {
      throw new Error(
        `Need ${seats.length} roles for ${seats.length} players; have ${this.selectedRoles.length}.`,
      );
    }

    const shuffledPlayers = [...seats].sort(() => rng() - 0.5);
    const shuffledRoles = [...this.selectedRoles].sort(() => rng() - 0.5);

    for (let i = 0; i < shuffledPlayers.length; i++) {
      shuffledPlayers[i].role = shuffledRoles[i];
    }
    this.phase = Phase.SETUP;
    return shuffledPlayers.map((p) => ({
      userId: p.userId,
      role: p.role,
    }));
  }

  startGame() {
    const unassigned = [...this.players.values()].filter((p) => !p.role);
    if (unassigned.length) {
      throw new Error('Assign roles before starting.');
    }
    this.phase = Phase.FIRST_NIGHT;
    this.dayNumber = 0;
  }

  advancePhase() {
    const previous = this.phase;
    const next = nextPhase(this.phase);
    if (next === previous) {
      throw new Error(`Cannot advance from phase ${this.phase}.`);
    }
    if (next === Phase.DAY) {
      this.dayNumber += 1;
    }
    this.phase = next;
    return { previous, phase: this.phase, dayNumber: this.dayNumber };
  }

  setPhase(phase) {
    if (!PHASE_LABELS[phase]) throw new Error(`Unknown phase: ${phase}`);
    this.phase = phase;
    if (phase === Phase.DAY && this.dayNumber === 0) this.dayNumber = 1;
  }

  markDead(userId, isDead = true) {
    const seat = this.players.get(userId);
    if (!seat) throw new Error('Player not in this game.');
    seat.isDead = isDead;
    return seat;
  }

  /**
   * Player submits an action for the storyteller to resolve.
   */
  submitAction({ playerId, kind, summary, payload }) {
    if (!this.players.has(playerId) && playerId !== this.storytellerId) {
      throw new Error('Only signed-in players (or the ST) can submit actions.');
    }
    if (this.phase === Phase.LOBBY || this.phase === Phase.ENDED) {
      throw new Error('Actions are not accepted in this phase.');
    }
    const action = createAction({
      playerId,
      kind,
      summary,
      payload,
      phase: this.phase,
    });
    this.actions.push(action);
    return action;
  }

  getPendingActions() {
    return this.actions.filter((a) => a.status === ActionStatus.PENDING);
  }

  resolveAction(actionId, { status = ActionStatus.RESOLVED, note = null } = {}) {
    const action = this.actions.find((a) => a.id === actionId);
    if (!action) throw new Error('Action not found.');
    action.status = status;
    action.storytellerNote = note;
    action.resolvedAt = Date.now();
    return action;
  }

  /**
   * Grimoire snapshot for the storyteller only.
   */
  grimoire() {
    return [...this.players.values()]
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map((p) => ({
        userId: p.userId,
        displayName: p.displayName,
        seatIndex: p.seatIndex,
        role: p.role,
        isDead: p.isDead,
        isDrunk: p.isDrunk,
      }));
  }

  publicSummary() {
    return {
      id: this.id,
      guildId: this.guildId,
      channelId: this.channelId,
      scriptId: this.scriptId,
      scriptName: this.script?.name || this.scriptId,
      phase: this.phase,
      phaseLabel: this.phaseLabel,
      dayNumber: this.dayNumber,
      storytellerId: this.storytellerId,
      playerCount: this.players.size,
      pendingActions: this.getPendingActions().length,
      players: [...this.players.values()].map((p) => ({
        userId: p.userId,
        displayName: p.displayName,
        seatIndex: p.seatIndex,
        isDead: p.isDead,
        hasRole: Boolean(p.role),
      })),
    };
  }

  end() {
    this.phase = Phase.ENDED;
    this.endedAt = Date.now();
  }
}

module.exports = { GameSession };
