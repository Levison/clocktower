'use strict';

/**
 * High-level game phases for Discord Clocktower sessions.
 * Night/day automation can grow on top of these states later.
 */
const Phase = Object.freeze({
  LOBBY: 'lobby',
  SETUP: 'setup',           // roles selected, not yet dealt
  FIRST_NIGHT: 'first_night',
  DAY: 'day',
  NIGHT: 'night',
  ENDED: 'ended',
});

const PHASE_LABELS = Object.freeze({
  [Phase.LOBBY]: 'Lobby',
  [Phase.SETUP]: 'Setup',
  [Phase.FIRST_NIGHT]: 'First Night',
  [Phase.DAY]: 'Day',
  [Phase.NIGHT]: 'Night',
  [Phase.ENDED]: 'Ended',
});

/** Ordered progression used by storyteller "advance" controls */
const PHASE_FLOW = [
  Phase.LOBBY,
  Phase.SETUP,
  Phase.FIRST_NIGHT,
  Phase.DAY,
  Phase.NIGHT,
];

function nextPhase(current) {
  if (current === Phase.DAY) return Phase.NIGHT;
  if (current === Phase.NIGHT) return Phase.DAY;
  if (current === Phase.FIRST_NIGHT) return Phase.DAY;
  const idx = PHASE_FLOW.indexOf(current);
  if (idx === -1 || idx === PHASE_FLOW.length - 1) return current;
  return PHASE_FLOW[idx + 1];
}

module.exports = { Phase, PHASE_LABELS, PHASE_FLOW, nextPhase };
