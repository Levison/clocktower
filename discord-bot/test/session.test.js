'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('../src/game/roles');
const { GameSession } = require('../src/game/session');
const { Phase } = require('../src/game/phases');
const { ActionKind, ActionStatus } = require('../src/game/actions');

describe('GameSession', () => {
  before(() => {
    loadScripts();
  });

  it('signs players in and keeps the storyteller out of seats', () => {
    const game = new GameSession({
      id: 'g1',
      guildId: 'guild',
      channelId: 'chan',
      storytellerId: 'st1',
      scriptId: 'trouble_brewing',
    });

    game.signIn({ userId: 'p1', displayName: 'Alice' });
    game.signIn({ userId: 'p2', displayName: 'Bob' });
    assert.equal(game.players.size, 2);
    assert.throws(() => game.signIn({ userId: 'st1', displayName: 'ST' }));
  });

  it('deals roles 1:1 and starts first night', () => {
    const game = new GameSession({
      id: 'g2',
      guildId: 'guild',
      channelId: 'chan',
      storytellerId: 'st1',
      scriptId: 'trouble_brewing',
    });
    game.signIn({ userId: 'p1', displayName: 'Alice' });
    game.signIn({ userId: 'p2', displayName: 'Bob' });
    game.signIn({ userId: 'p3', displayName: 'Carol' });
    game.setSelectedRoles([
      { name: 'Imp' },
      { name: 'Empath' },
      { name: 'Washerwoman' },
    ]);

    const fixed = (() => {
      let i = 0;
      return () => {
        i += 1;
        return i % 2 === 0 ? 0.1 : 0.9;
      };
    })();

    const dealt = game.assignRoles(fixed);
    assert.equal(dealt.length, 3);
    assert.ok([...game.players.values()].every((p) => p.role));

    game.startGame();
    assert.equal(game.phase, Phase.FIRST_NIGHT);

    game.advancePhase();
    assert.equal(game.phase, Phase.DAY);
    assert.equal(game.dayNumber, 1);
  });

  it('queues player actions for the storyteller', () => {
    const game = new GameSession({
      id: 'g3',
      guildId: 'guild',
      channelId: 'chan',
      storytellerId: 'st1',
      scriptId: 'trouble_brewing',
    });
    game.signIn({ userId: 'p1', displayName: 'Alice' });
    game.setSelectedRoles([{ name: 'Empath' }]);
    game.assignRoles(() => 0.5);
    game.startGame();

    const action = game.submitAction({
      playerId: 'p1',
      kind: ActionKind.NIGHT_ABILITY,
      summary: 'Check neighbors',
    });
    assert.equal(game.getPendingActions().length, 1);

    game.resolveAction(action.id, { note: 'Told 1' });
    assert.equal(action.status, ActionStatus.RESOLVED);
    assert.equal(game.getPendingActions().length, 0);

    const grim = game.grimoire();
    assert.equal(grim[0].role.name, 'Empath');
  });
});
