'use strict';

/**
 * Simulated table: 1 storyteller + 5 players through a full groundwork loop.
 * No Discord token required — exercises GameStore/GameSession the same way
 * slash commands and DM handlers would.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('../src/game/roles');
const { GameStore } = require('../src/game/store');
const { Phase } = require('../src/game/phases');
const { ActionKind, ActionStatus } = require('../src/game/actions');
const { buildPanel } = require('../src/discord/storytellerPanel');
const { buildAbilityPrompt } = require('../src/discord/playerPrompt');
const {
  roleRevealEmbed,
  actionInboxEmbed,
  gameStatusEmbed,
} = require('../src/discord/messaging');

const STORYTELLER = { id: 'st-lucas', name: 'Lucas (ST)' };
const PLAYERS = [
  { id: 'p-alice', name: 'Alice' },
  { id: 'p-bob', name: 'Bob' },
  { id: 'p-carol', name: 'Carol' },
  { id: 'p-dave', name: 'Dave' },
  { id: 'p-erin', name: 'Erin' },
];

/** Trouble Brewing 5-player bag (typical distribution) */
const ROLE_BAG = ['Imp', 'Poisoner', 'Empath', 'Washerwoman', 'Butler'];

describe('5-player table simulation', () => {
  before(() => loadScripts());

  it('runs lobby → deal → night prompts → day with ST inbox', () => {
    const store = new GameStore();
    const log = [];

    // --- Storyteller opens the table ---
    const game = store.create({
      guildId: 'guild-sim',
      channelId: 'channel-town-square',
      storytellerId: STORYTELLER.id,
      scriptId: 'trouble_brewing',
    });
    log.push(`ST ${STORYTELLER.name} created game ${game.id.slice(0, 8)}`);
    assert.equal(game.phase, Phase.LOBBY);
    assert.throws(() =>
      game.signIn({ userId: STORYTELLER.id, displayName: STORYTELLER.name }),
    );

    // --- Five players sign in ---
    for (const p of PLAYERS) {
      const seat = game.signIn({ userId: p.id, displayName: p.name });
      log.push(`Signed in ${seat.displayName} → seat ${seat.seatIndex + 1}`);
    }
    assert.equal(game.players.size, 5);
    assert.equal(store.getActiveForGuild('guild-sim'), game);

    // Public status embed builds without throwing
    const status = gameStatusEmbed(game);
    assert.equal(status.data.title.includes('Trouble Brewing'), true);

    // --- ST sets bag and deals ---
    game.setSelectedRoles(ROLE_BAG.map((name) => ({ name })));
    assert.equal(game.selectedRoles.length, 5);

    const assignments = game.assignRoles();
    assert.equal(assignments.length, 5);

    // Simulate DM role reveals (what /clocktower deal does)
    for (const { userId, role } of assignments) {
      const seat = game.players.get(userId);
      const embed = roleRevealEmbed(seat, game.script.name);
      assert.equal(embed.data.title, `Your role — ${role.name}`);
      log.push(`DM → ${seat.displayName}: ${role.name} (${role.category})`);
    }

    // Everyone has a unique role from the bag
    const dealtNames = [...game.players.values()].map((p) => p.role.name).sort();
    assert.deepEqual(dealtNames, [...ROLE_BAG].sort());

    // ST panel / grimoire
    const panel = buildPanel(game);
    assert.ok(panel.embeds[0].data.title === 'Storyteller panel');
    assert.ok(panel.components.length >= 1);
    const grim = game.grimoire();
    assert.equal(grim.length, 5);
    assert.ok(grim.every((g) => g.role));
    log.push('ST grimoire ready');

    // --- First night ---
    game.startGame();
    assert.equal(game.phase, Phase.FIRST_NIGHT);

    // ST prompts Imp and Empath-style actions via the same prompt builder DMs use
    const demon = grim.find((g) => g.role.category === 'Demons');
    const townsfolk = grim.filter((g) => g.role.category === 'Townsfolk');
    assert.ok(demon, 'expected a Demon in the bag');

    const others = grim.filter((g) => g.userId !== demon.userId);
    const impPrompt = buildAbilityPrompt({
      gameId: game.id,
      promptText: 'Demon, choose a player (groundwork: first-night may be informational only).',
      playerOptions: others.map((p) => ({ userId: p.userId, displayName: p.displayName })),
    });
    assert.ok(impPrompt.components.length >= 1);
    log.push(`ST prompted Demon ${demon.displayName}`);

    // Demon submits a night choice (as the select-menu handler would)
    const target = others[0];
    const demonAction = game.submitAction({
      playerId: demon.userId,
      kind: ActionKind.NIGHT_ABILITY,
      summary: `Chose: ${target.displayName}`,
      payload: { targets: [target.userId] },
    });
    const demonInbox = actionInboxEmbed(game, demonAction, demon.displayName);
    assert.ok(demonInbox.data.title === 'Incoming player action');
    log.push(`Action from ${demon.displayName}: ${demonAction.summary}`);

    // A Townsfolk also acts
    const infoRole = townsfolk[0];
    const infoAction = game.submitAction({
      playerId: infoRole.userId,
      kind: ActionKind.NIGHT_ABILITY,
      summary: 'Info check submitted',
      payload: { targets: [PLAYERS[1].id, PLAYERS[2].id] },
    });
    log.push(`Action from ${infoRole.displayName}: ${infoAction.summary}`);

    assert.equal(game.getPendingActions().length, 2);

    // ST resolves inbox
    for (const pending of [...game.getPendingActions()]) {
      game.resolveAction(pending.id, {
        status: ActionStatus.RESOLVED,
        note: 'ST acknowledged',
      });
      log.push(`ST resolved ${pending.id.slice(-8)}`);
    }
    assert.equal(game.getPendingActions().length, 0);

    // --- Day ---
    const advanced = game.advancePhase();
    assert.equal(advanced.phase, Phase.DAY);
    assert.equal(game.dayNumber, 1);
    log.push(`Phase → ${game.phaseLabel} (day ${game.dayNumber})`);

    // Day ability / nomination-style freeform from a living player
    const nominator = PLAYERS[3];
    const nom = game.submitAction({
      playerId: nominator.id,
      kind: ActionKind.NOMINATION,
      summary: `Nominate ${PLAYERS[4].name}`,
      payload: { nomineeId: PLAYERS[4].id },
    });
    assert.equal(nom.status, ActionStatus.PENDING);
    game.resolveAction(nom.id);
    log.push(`${nominator.name} nomination resolved`);

    // Mark someone dead (execution)
    game.markDead(PLAYERS[4].id, true);
    assert.equal(game.players.get(PLAYERS[4].id).isDead, true);
    assert.equal(game.livingPlayers.length, 4);
    log.push(`${PLAYERS[4].name} marked dead`);

    // Night again
    game.advancePhase();
    assert.equal(game.phase, Phase.NIGHT);
    log.push(`Phase → ${game.phaseLabel}`);

    // Lookup helpers used by DM / component handlers
    assert.equal(store.getForUser(STORYTELLER.id, null, null), game);
    assert.equal(store.getForUser(PLAYERS[0].id, 'guild-sim', 'channel-town-square'), game);

    store.end(game.id);
    assert.equal(game.phase, Phase.ENDED);
    assert.equal(store.getActiveForGuild('guild-sim'), null);
    log.push('Game ended');

    console.log('\n--- Simulated table log ---');
    for (const line of log) console.log(' ', line);
    console.log('---------------------------\n');
  });
});
