'use strict';

/**
 * Player action types the bot can collect and forward to the storyteller.
 * Role-specific night abilities plug into these kinds later.
 */
const ActionKind = Object.freeze({
  NIGHT_ABILITY: 'night_ability',
  DAY_ABILITY: 'day_ability',
  NOMINATION: 'nomination',
  VOTE: 'vote',
  FREEFORM: 'freeform',
  STORYTELLER_PROMPT: 'storyteller_prompt',
});

const ActionStatus = Object.freeze({
  PENDING: 'pending',
  ACKNOWLEDGED: 'acknowledged',
  RESOLVED: 'resolved',
  CANCELLED: 'cancelled',
});

let actionSeq = 0;

/**
 * @param {object} opts
 * @param {string} opts.playerId Discord user id
 * @param {string} opts.kind
 * @param {string} [opts.summary]
 * @param {object} [opts.payload]
 * @param {string} [opts.phase]
 */
function createAction(opts) {
  actionSeq += 1;
  return {
    id: `act_${Date.now()}_${actionSeq}`,
    playerId: opts.playerId,
    kind: opts.kind,
    summary: opts.summary || '',
    payload: opts.payload || {},
    phase: opts.phase || null,
    status: ActionStatus.PENDING,
    createdAt: Date.now(),
    resolvedAt: null,
    storytellerNote: null,
  };
}

module.exports = { ActionKind, ActionStatus, createAction };
