'use strict';

// Bag math for a storyteller lobby.
// Baron and Godfather change the outsider count only when they are in play.
// Fang Gu and Vigormortis change it whenever they are on the script, so a
// full Sects & Violets script cancels out.

const CATEGORIES = ['Townsfolk', 'Outsiders', 'Minions', 'Demons'];

const DISTRIBUTION = {
  5: { Townsfolk: 3, Outsiders: 0, Minions: 1, Demons: 1 },
  6: { Townsfolk: 3, Outsiders: 1, Minions: 1, Demons: 1 },
  7: { Townsfolk: 5, Outsiders: 0, Minions: 1, Demons: 1 },
  8: { Townsfolk: 5, Outsiders: 1, Minions: 1, Demons: 1 },
  9: { Townsfolk: 5, Outsiders: 2, Minions: 1, Demons: 1 },
  10: { Townsfolk: 7, Outsiders: 0, Minions: 2, Demons: 1 },
  11: { Townsfolk: 7, Outsiders: 1, Minions: 2, Demons: 1 },
  12: { Townsfolk: 7, Outsiders: 2, Minions: 2, Demons: 1 },
  13: { Townsfolk: 9, Outsiders: 0, Minions: 3, Demons: 1 },
  14: { Townsfolk: 9, Outsiders: 1, Minions: 3, Demons: 1 },
  15: { Townsfolk: 9, Outsiders: 2, Minions: 3, Demons: 1 }
};

const MODIFIERS = {
  baron: { outsiders: 2, scope: 'bag', label: 'Baron +2 Outsiders' },
  godfather: { outsiders: 'choice', scope: 'bag', label: 'Godfather' },
  fanggu: { outsiders: 1, scope: 'script', label: 'Fang Gu +1 Outsider' },
  vigormortis: { outsiders: -1, scope: 'script', label: 'Vigormortis -1 Outsider' }
};

const MINION_INFO_ORDER = 4;
const DEMON_INFO_ORDER = 9;

function baseDistribution(playerCount) {
  if (playerCount < 5) return null;
  if (playerCount >= 15) return { ...DISTRIBUTION[15] };
  return { ...DISTRIBUTION[playerCount] };
}

function countCategories(roles) {
  const counts = { Townsfolk: 0, Outsiders: 0, Minions: 0, Demons: 0 };
  for (const role of roles) {
    if (counts[role.category] !== undefined) counts[role.category] += 1;
  }
  return counts;
}

function shuffle(list, rng = Math.random) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function uniqueRoles(roles) {
  const seen = new Set();
  const out = [];
  for (const role of roles) {
    if (!role || seen.has(role.id)) continue;
    seen.add(role.id);
    out.push(role);
  }
  return out;
}

function countPhrase(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function applyDelta(expected, delta, notes, label) {
  expected.Outsiders += delta;
  expected.Townsfolk -= delta;
  notes.push(label);
}

function expectedDistribution({ playerCount, script, bag, godfatherChoice }) {
  const base = baseDistribution(playerCount);
  if (!base) {
    return { base: null, expected: null, notes: [], needsGodfatherChoice: false };
  }

  const expected = { ...base };
  const notes = [];
  let needsGodfatherChoice = false;
  const scriptMods = (script || []).filter(role => {
    const mod = MODIFIERS[role.id];
    return mod && mod.scope === 'script';
  });
  const hasFangGu = scriptMods.some(role => role.id === 'fanggu');
  const hasVigormortis = scriptMods.some(role => role.id === 'vigormortis');

  if (hasFangGu && hasVigormortis) {
    notes.push('Fang Gu and Vigormortis are both on the script, so the outsider count is unchanged.');
  } else {
    for (const role of scriptMods) {
      const mod = MODIFIERS[role.id];
      applyDelta(expected, mod.outsiders, notes, `${mod.label} (on the script).`);
    }
  }

  for (const role of bag || []) {
    const mod = MODIFIERS[role.id];
    if (!mod || mod.scope !== 'bag') continue;
    if (mod.outsiders === 'choice') {
      needsGodfatherChoice = true;
      const delta = godfatherChoice === 'minus' ? -1 : 1;
      const sign = delta > 0 ? '+1' : '-1';
      applyDelta(expected, delta, notes, `Godfather is in play (${sign} Outsider).`);
    } else {
      applyDelta(expected, mod.outsiders, notes, `${mod.label} (in play).`);
    }
  }

  return { base, expected, notes, needsGodfatherChoice };
}

function validateBag({ playerCount, script, bag, godfatherChoice }) {
  const dist = expectedDistribution({ playerCount, script, bag, godfatherChoice });
  const counts = countCategories(bag || []);
  const errors = [];
  const scriptIds = new Set((script || []).map(role => role.id));

  if ((bag || []).length !== playerCount) {
    errors.push(`Select ${playerCount} characters for ${playerCount} players (have ${(bag || []).length}).`);
  }

  const ids = (bag || []).map(role => role.id);
  if (new Set(ids).size !== ids.length) {
    errors.push('Each character can only be in the bag once.');
  }

  for (const role of bag || []) {
    if (!scriptIds.has(role.id)) errors.push(`${role.name} is not on this script.`);
  }

  if (playerCount < 5) {
    if (playerCount < 1) errors.push('Waiting for players.');
    const summary = 'Player count is under 5, so the usual distribution is not applied.';
    return { ok: errors.length === 0, errors, counts, summary, ...dist };
  }

  if (dist.expected.Townsfolk < 0 || dist.expected.Outsiders < 0) {
    errors.push('These setup modifiers do not fit this player count.');
  } else {
    for (const category of CATEGORIES) {
      if (counts[category] !== dist.expected[category]) {
        errors.push(`Need ${dist.expected[category]} ${category} (have ${counts[category]}).`);
      }
    }
  }

  const summary = `${playerCount} players: ${countPhrase(dist.expected.Townsfolk, 'Townsfolk', 'Townsfolk')}, ${countPhrase(dist.expected.Outsiders, 'Outsider', 'Outsiders')}, ${countPhrase(dist.expected.Minions, 'Minion', 'Minions')}, ${countPhrase(dist.expected.Demons, 'Demon', 'Demons')}.`;
  return { ok: errors.length === 0, errors, counts, summary, ...dist };
}

function pickFrom(pool, rng) {
  if (!pool.length) return null;
  return shuffle(pool, rng)[0];
}

function pickDrunkMask(script, bag, catalog, rng) {
  const inBag = new Set(bag.map(role => role.id));
  const onScript = script.filter(role => role.category === 'Townsfolk' && !inBag.has(role.id));
  const anywhere = (catalog || []).filter(role => role.category === 'Townsfolk' && !inBag.has(role.id));
  return pickFrom(onScript, rng) || pickFrom(anywhere, rng);
}

function pickLunaticMask(script, bag, catalog, rng) {
  const inBagDemons = new Set(bag.filter(role => role.category === 'Demons').map(role => role.id));
  const onScriptOther = script.filter(role => role.category === 'Demons' && !inBagDemons.has(role.id));
  const onScript = script.filter(role => role.category === 'Demons');
  const anywhereOther = (catalog || []).filter(role => role.category === 'Demons' && !inBagDemons.has(role.id));
  const anywhere = (catalog || []).filter(role => role.category === 'Demons');
  return pickFrom(onScriptOther, rng)
    || pickFrom(onScript, rng)
    || pickFrom(anywhereOther, rng)
    || pickFrom(anywhere, rng);
}

function goodCharacters(script, bag, catalog) {
  const inBag = new Set(bag.map(role => role.id));
  const isGood = role => role.category === 'Townsfolk' || role.category === 'Outsiders';
  const onScript = script.filter(role => isGood(role) && !inBag.has(role.id));
  const onScriptIds = new Set(onScript.map(role => role.id));
  const offScript = (catalog || []).filter(role => isGood(role) && !inBag.has(role.id) && !onScriptIds.has(role.id));
  return { onScript, offScript };
}

function pickBluffs({ script, bag, catalog, excludeIds, count, rng }) {
  const exclude = new Set(excludeIds || []);
  const { onScript, offScript } = goodCharacters(script, bag, catalog);
  const preferred = onScript.filter(role => !exclude.has(role.id));
  const ordered = uniqueRoles([
    ...shuffle(preferred, rng),
    ...shuffle(onScript, rng),
    ...shuffle(offScript, rng)
  ]);
  return ordered.slice(0, count);
}

function wakeDetail(role, which) {
  const reminder = which === 'first' ? role.firstNightReminder : role.otherNightReminder;
  if (reminder && String(reminder).trim()) return String(reminder).trim();
  return role.description || '';
}

function withPlayer(name, playerName) {
  return playerName ? `${name} — ${playerName}` : name;
}

function pushWake(first, other, role, name) {
  if (role.firstNight) {
    first.push({ order: role.firstNight, name, detail: wakeDetail(role, 'first') });
  }
  if (role.otherNight) {
    other.push({ order: role.otherNight, name, detail: wakeDetail(role, 'other') });
  }
}

function byOrder(a, b) {
  return a.order - b.order || a.name.localeCompare(b.name);
}

function nightSheet(assignments, { bluffs, lunaticBluffs } = {}) {
  const first = [];
  const other = [];
  const passive = [];
  const hasMinion = assignments.some(entry => entry.role.category === 'Minions');
  const hasDemon = assignments.some(entry => entry.role.category === 'Demons');
  const hasLunatic = assignments.some(entry => entry.role.id === 'lunatic');

  if (hasMinion) {
    first.push({
      order: MINION_INFO_ORDER,
      name: 'Minion info',
      detail: 'Wake the Minions together. Show them each other and the Demon.'
    });
  }

  if (hasDemon) {
    const bluffNames = (bluffs || []).map(role => role.name);
    let detail = bluffNames.length
      ? `Wake the Demon. Show each Minion, then the bluffs: ${bluffNames.join(', ')}.`
      : 'Wake the Demon. Show each Minion, then three good characters who are not in play.';
    if (hasLunatic) detail += ' Show the Lunatic and the players the Lunatic chose.';
    first.push({ order: DEMON_INFO_ORDER, name: 'Demon info', detail });
  }

  for (const assignment of assignments) {
    const { role, mask, playerName } = assignment;
    if (role.id === 'drunk') {
      if (mask && (mask.firstNight || mask.otherNight)) {
        pushWake(first, other, mask, withPlayer(`${mask.name} (Drunk)`, playerName));
      } else {
        passive.push({
          name: withPlayer('Drunk', playerName),
          detail: mask
            ? `Believes they are the ${mask.name}. That character does not wake.`
            : 'Show them a Townsfolk who is not in play.'
        });
      }
      continue;
    }

    if (role.id === 'lunatic') {
      const label = mask
        ? `Lunatic (believes they are the ${mask.name})`
        : 'Lunatic';
      pushWake(first, other, role, withPlayer(label, playerName));
      continue;
    }

    if (role.firstNight || role.otherNight) {
      pushWake(first, other, role, withPlayer(role.name, playerName));
    } else {
      passive.push({
        name: withPlayer(role.name, playerName),
        detail: role.description || 'Does not wake.'
      });
    }
  }

  first.sort(byOrder);
  other.sort(byOrder);
  return {
    firstNight: first,
    otherNights: other,
    passive,
    bluffs: bluffs || [],
    lunaticBluffs: lunaticBluffs || []
  };
}

function previewNightSheet(bag) {
  return nightSheet((bag || []).map(role => ({ role, mask: null })));
}

function dealRoles({ playerIds, script, bag, catalog, godfatherChoice, rng }) {
  const check = validateBag({
    playerCount: playerIds.length,
    script,
    bag,
    godfatherChoice
  });
  if (!check.ok) return { ok: false, ...check, assignments: [], bluffs: [], lunaticBluffs: [] };

  const players = shuffle(playerIds, rng);
  const roles = shuffle(bag, rng);
  const assignments = players.map((playerId, index) => ({
    playerId,
    role: roles[index],
    mask: null
  }));
  const errors = [];

  for (const assignment of assignments) {
    if (assignment.role.id === 'drunk') {
      assignment.mask = pickDrunkMask(script, bag, catalog, rng);
      if (!assignment.mask) errors.push('The Drunk needs a Townsfolk who is not in play.');
    }
    if (assignment.role.id === 'lunatic') {
      assignment.mask = pickLunaticMask(script, bag, catalog, rng);
      if (!assignment.mask) errors.push('The Lunatic needs a Demon token to believe they are.');
    }
  }

  if (errors.length) {
    return { ok: false, ...check, errors, assignments: [], bluffs: [], lunaticBluffs: [] };
  }

  const maskIds = assignments.map(entry => entry.mask && entry.mask.id).filter(Boolean);
  const bluffs = pickBluffs({ script, bag, catalog, excludeIds: maskIds, count: 3, rng });
  const lunaticBluffs = assignments.some(entry => entry.role.id === 'lunatic')
    ? pickBluffs({
      script,
      bag,
      catalog,
      excludeIds: [...maskIds, ...bluffs.map(role => role.id)],
      count: 3,
      rng
    })
    : [];

  return {
    ok: true,
    ...check,
    assignments,
    bluffs,
    lunaticBluffs,
    nightSheet: nightSheet(assignments, { bluffs, lunaticBluffs })
  };
}

function reminderTokens(roles) {
  const tokens = [];
  for (const role of roles || []) {
    for (const token of role.reminders || []) tokens.push(token);
    for (const token of role.remindersGlobal || []) tokens.push(token);
  }
  return [...new Set(tokens)];
}

function parseScenarioImport(text, catalog) {
  const source = String(text || '').trim();
  if (!source) return { error: 'Paste a script first.' };

  let data;
  try {
    data = JSON.parse(source);
  } catch (err) {
    const names = source.split(/[\n,]/).map(part => part.trim()).filter(Boolean);
    if (!names.length) return { error: 'Could not read that list.' };
    return resolveImported(names, 'Custom scenario', catalog);
  }

  let name = 'Custom scenario';
  const raw = [];
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'string') raw.push(item);
      else if (item && item.id === '_meta') name = item.name || name;
      else if (item && (item.id || item.name)) raw.push(item.id || item.name);
    }
  } else if (data && typeof data === 'object') {
    name = data.name || data['Role Set'] || name;
    const list = data.roles || data.roleIds || data.characters;
    if (Array.isArray(list)) {
      for (const item of list) {
        if (typeof item === 'string') raw.push(item);
        else if (item && (item.id || item.name)) raw.push(item.id || item.name);
      }
    }
  }

  if (!raw.length) return { error: 'No characters found in that script.' };
  return resolveImported(raw, name, catalog);
}

function resolveImported(raw, name, catalog) {
  const byId = new Map((catalog || []).map(role => [role.id, role]));
  const byName = new Map((catalog || []).map(role => [role.name.toLowerCase(), role]));
  const roleIds = [];
  const missing = [];

  for (const item of raw) {
    const key = String(item).trim();
    const role = byId.get(key) || byId.get(key.toLowerCase()) || byName.get(key.toLowerCase());
    if (!role) missing.push(key);
    else if (!roleIds.includes(role.id)) roleIds.push(role.id);
  }

  if (!roleIds.length) return { error: 'None of those characters are in the catalog.', missing };
  return { name: String(name || 'Custom scenario').slice(0, 40), roleIds, missing };
}

function groupByCategory(roles) {
  const grouped = { Townsfolk: [], Outsiders: [], Minions: [], Demons: [] };
  for (const role of roles) {
    if (grouped[role.category]) grouped[role.category].push(role);
  }
  return grouped;
}

function card(role) {
  if (!role) return null;
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    category: role.category
  };
}

module.exports = {
  CATEGORIES,
  DISTRIBUTION,
  baseDistribution,
  countCategories,
  expectedDistribution,
  validateBag,
  dealRoles,
  previewNightSheet,
  nightSheet,
  reminderTokens,
  parseScenarioImport,
  groupByCategory,
  shuffle,
  card
};
