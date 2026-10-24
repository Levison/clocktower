'use strict';

const assert = require('assert');
const setup = require('../lib/setup.cjs');
const troubleBrewing = require('../roles/trouble_brewing.json');
const badMoonRising = require('../roles/bad_moon_rising.json');
const sectsAndViolets = require('../roles/sects_and_violets.json');

function flatten(file) {
  const roles = [];
  for (const category of setup.CATEGORIES) {
    for (const role of file.Roles[category]) roles.push({ ...role, category });
  }
  return roles;
}

function byId(roles, id) {
  const role = roles.find(entry => entry.id === id);
  assert(role, `missing ${id}`);
  return role;
}

function fill(category, count, prefix) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${index}`,
    name: `${prefix}${index}`,
    category
  }));
}

const tb = flatten(troubleBrewing);
const bmr = flatten(badMoonRising);
const snv = flatten(sectsAndViolets);
const catalog = [...tb, ...bmr, ...snv];

assert.equal(tb.length, 27);
assert.equal(bmr.length, 30);
assert.equal(snv.length, 30);
assert.equal(tb.filter(role => role.category === 'Travellers').length, 5);
assert.equal(byId(tb, 'beggar').name, 'Beggar');
assert.equal(byId(bmr, 'apprentice').name, 'Apprentice');
assert.equal(byId(snv, 'bonecollector').name, 'Bone Collector');
assert.ok(!catalog.some(role => role.id === 'gangster'));
assert.equal(byId(tb, 'drunk').remindersGlobal[0], 'Drunk');
assert.ok(byId(snv, 'fanggu').description.includes('+1 Outsider'));
assert.ok(byId(snv, 'vigormortis').description.includes('-1 Outsider'));

// Full Sects & Violets cancels Fang Gu and Vigormortis.
{
  const bag = [
    ...snv.filter(role => role.category === 'Townsfolk').slice(0, 5),
    byId(snv, 'witch'),
    byId(snv, 'nodashii')
  ];
  const check = setup.validateBag({ playerCount: 7, script: snv, bag, godfatherChoice: 'plus' });
  assert.equal(check.ok, true, check.errors.join(' '));
  assert.equal(check.expected.Outsiders, 0);
  assert.ok(check.notes.some(note => note.includes('unchanged')));
}

// Fang Gu alone on a custom script adds an outsider even when a different demon is in play.
{
  const script = [byId(snv, 'clockmaker'), byId(snv, 'dreamer'), byId(snv, 'snakecharmer'), byId(snv, 'mathematician'), byId(snv, 'flowergirl'), byId(snv, 'mutant'), byId(snv, 'witch'), byId(snv, 'fanggu'), byId(snv, 'nodashii')];
  const bag = [
    byId(snv, 'clockmaker'),
    byId(snv, 'dreamer'),
    byId(snv, 'snakecharmer'),
    byId(snv, 'mathematician'),
    byId(snv, 'mutant'),
    byId(snv, 'witch'),
    byId(snv, 'nodashii')
  ];
  const check = setup.validateBag({ playerCount: 7, script, bag, godfatherChoice: 'plus' });
  assert.equal(check.expected.Townsfolk, 4);
  assert.equal(check.expected.Outsiders, 1);
  assert.equal(check.ok, true, check.errors.join(' '));
}

// Baron adds two outsiders only when he is in the bag.
{
  const script = tb;
  const without = setup.expectedDistribution({
    playerCount: 10,
    script,
    bag: [byId(tb, 'imp'), byId(tb, 'poisoner'), byId(tb, 'spy')],
    godfatherChoice: 'plus'
  });
  assert.equal(without.expected.Outsiders, 0);

  const withBaron = setup.expectedDistribution({
    playerCount: 10,
    script,
    bag: [byId(tb, 'imp'), byId(tb, 'poisoner'), byId(tb, 'baron')],
    godfatherChoice: 'plus'
  });
  assert.equal(withBaron.expected.Townsfolk, 5);
  assert.equal(withBaron.expected.Outsiders, 2);
}

// Godfather's minus choice can make the bag illegal.
{
  const extras = fill('Townsfolk', 5, 'tf');
  const bag = [...extras, byId(bmr, 'godfather'), byId(bmr, 'pukka')];
  const check = setup.validateBag({
    playerCount: 7,
    script: [...bmr, ...extras],
    bag,
    godfatherChoice: 'minus'
  });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some(error => error.includes('do not fit') || error.includes('Outsiders')));
}

// A legal 6-player Trouble Brewing bag hides the Drunk and gives the Demon bluffs.
{
  const bag = [
    byId(tb, 'washerwoman'),
    byId(tb, 'librarian'),
    byId(tb, 'chef'),
    byId(tb, 'drunk'),
    byId(tb, 'poisoner'),
    byId(tb, 'imp')
  ];
  const dealt = setup.dealRoles({
    playerIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
    script: tb,
    bag,
    catalog,
    godfatherChoice: 'plus',
    rng: () => 0.5
  });
  assert.equal(dealt.ok, true, (dealt.errors || []).join(' '));
  assert.match(dealt.summary, /1 Outsider,/);
  assert.doesNotMatch(dealt.summary, /1 Outsiders/);
  const drunk = dealt.assignments.find(entry => entry.role.id === 'drunk');
  assert.equal(drunk.mask.category, 'Townsfolk');
  assert.ok(!bag.some(role => role.id === drunk.mask.id));
  assert.equal(dealt.bluffs.length, 3);
  for (const bluff of dealt.bluffs) {
    assert.ok(bluff.category === 'Townsfolk' || bluff.category === 'Outsiders');
    assert.ok(!bag.some(role => role.id === bluff.id));
    assert.notEqual(bluff.id, drunk.mask.id);
  }
  const sheetText = JSON.stringify(dealt.nightSheet);
  assert.ok(
    sheetText.includes(`${drunk.mask.name} (Drunk)`)
    || sheetText.includes(`Believes they are the ${drunk.mask.name}`)
  );
  const firstNames = dealt.nightSheet.firstNight.map(step => step.name);
  assert.ok(firstNames.some(name => name.startsWith('Minion info')));
  assert.ok(firstNames.some(name => name.startsWith('Demon info')));
  assert.ok(dealt.nightSheet.firstNight.find(step => step.name.startsWith('Demon info')).detail.includes(dealt.bluffs[0].name));
}

// Lunatic believes a demon who is not the one in play, and wakes before that demon.
{
  const bag = [
    byId(bmr, 'grandmother'),
    byId(bmr, 'sailor'),
    byId(bmr, 'tinker'),
    byId(bmr, 'lunatic'),
    byId(bmr, 'godfather'),
    byId(bmr, 'pukka')
  ];
  const dealt = setup.dealRoles({
    playerIds: ['a', 'b', 'c', 'd', 'e', 'f'],
    script: bmr,
    bag,
    catalog,
    godfatherChoice: 'plus',
    rng: () => 0.25
  });
  assert.equal(dealt.ok, true, (dealt.errors || []).join(' '));
  assert.equal(dealt.expected.Outsiders, 2);
  const lunatic = dealt.assignments.find(entry => entry.role.id === 'lunatic');
  assert.equal(lunatic.mask.category, 'Demons');
  assert.notEqual(lunatic.mask.id, 'pukka');
  assert.equal(dealt.lunaticBluffs.length, 3);
  const other = dealt.nightSheet.otherNights;
  const lunaticStep = other.find(step => step.name.includes('Lunatic'));
  const pukkaStep = other.find(step => step.name.startsWith('Pukka'));
  assert.ok(lunaticStep);
  assert.ok(pukkaStep);
  assert.ok(lunaticStep.order < pukkaStep.order);
}

// Script-tool JSON and a loose name list both resolve.
{
  const imported = setup.parseScenarioImport(JSON.stringify([
    { id: '_meta', name: 'Tiny Evil' },
    'imp',
    'poisoner',
    'clockmaker'
  ]), catalog);
  assert.equal(imported.name, 'Tiny Evil');
  assert.deepEqual(imported.roleIds, ['imp', 'poisoner', 'clockmaker']);

  const listed = setup.parseScenarioImport('Imp, Clockmaker\nFang Gu', catalog);
  assert.deepEqual(listed.roleIds, ['imp', 'clockmaker', 'fanggu']);
}

// An illegal category mix is rejected even when the total matches.
{
  const bag = [
    ...tb.filter(role => role.category === 'Townsfolk').slice(0, 4),
    byId(tb, 'saint'),
    byId(tb, 'imp')
  ];
  const check = setup.validateBag({ playerCount: 6, script: tb, bag, godfatherChoice: 'plus' });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some(error => error.includes('Minions')));
}

// One Traveller sits outside the 5-player chart, so six seats are 3/0/1/1 plus the Traveller.
{
  const bag = [
    ...tb.filter(role => role.category === 'Townsfolk').slice(0, 3),
    byId(tb, 'poisoner'),
    byId(tb, 'imp'),
    byId(tb, 'beggar')
  ];
  const check = setup.validateBag({ playerCount: 6, script: tb, bag, godfatherChoice: 'plus' });
  assert.equal(check.ok, true, check.errors.join(' '));
  assert.equal(check.expected.Townsfolk, 3);
  assert.equal(check.expected.Outsiders, 0);
  assert.equal(check.counts.Travellers, 1);
  assert.match(check.summary, /1 Traveller/);
}

// An evil Apprentice is shown a Minion who is not in the bag.
{
  const apprentice = byId(bmr, 'apprentice');
  const bag = [
    ...tb.filter(role => role.category === 'Townsfolk').slice(0, 3),
    byId(tb, 'poisoner'),
    byId(tb, 'imp'),
    apprentice
  ];
  const dealt = setup.dealRoles({
    playerIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
    script: [...tb, apprentice],
    bag,
    catalog,
    godfatherChoice: 'plus',
    travellerAlignments: { apprentice: 'evil' },
    rng: () => 0.2
  });
  assert.equal(dealt.ok, true, (dealt.errors || []).join(' '));
  const seat = dealt.assignments.find(entry => entry.role.id === 'apprentice');
  assert.equal(seat.alignment, 'evil');
  assert.equal(seat.mask.category, 'Minions');
  assert.ok(!bag.some(role => role.id === seat.mask.id));
  assert.ok(dealt.nightSheet.firstNight.some(step => step.name.includes('Apprentice (evil)')));
}

// Sentinel lets the outsider count move by one. Toymaker adds a fourth bluff.
{
  const sentinel = { id: 'sentinel', name: 'Sentinel', category: 'Fabled' };
  const toymaker = { id: 'toymaker', name: 'Toymaker', category: 'Fabled', description: 'There is 1 extra bluff.' };
  const shifted = [
    ...tb.filter(role => role.category === 'Townsfolk').slice(0, 4),
    byId(tb, 'poisoner'),
    byId(tb, 'imp')
  ];
  const illegal = setup.validateBag({ playerCount: 6, script: tb, bag: shifted, godfatherChoice: 'plus' });
  assert.equal(illegal.ok, false);
  const allowed = setup.validateBag({
    playerCount: 6,
    script: tb,
    bag: shifted,
    godfatherChoice: 'plus',
    fabled: [sentinel]
  });
  assert.equal(allowed.ok, true, allowed.errors.join(' '));
  assert.equal(allowed.accepted.Outsiders, 0);
  assert.equal(allowed.accepted.Townsfolk, 4);

  const bag = [
    byId(tb, 'washerwoman'),
    byId(tb, 'librarian'),
    byId(tb, 'chef'),
    byId(tb, 'drunk'),
    byId(tb, 'poisoner'),
    byId(tb, 'imp')
  ];
  const dealt = setup.dealRoles({
    playerIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
    script: tb,
    bag,
    catalog,
    godfatherChoice: 'plus',
    fabled: [toymaker],
    rng: () => 0.4
  });
  assert.equal(dealt.ok, true, (dealt.errors || []).join(' '));
  assert.equal(dealt.bluffs.length, 4);
  assert.ok(dealt.nightSheet.firstNight.some(step => step.name === 'Toymaker'));
}

console.log('setup tests passed');
