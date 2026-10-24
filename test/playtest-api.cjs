'use strict';

const base = process.env.BASE_URL || 'http://127.0.0.1:7117';

function client() {
  let cookie = '';
  return {
    async req(path, options = {}) {
      const response = await fetch(base + path, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      const setCookies = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [];
      if (setCookies.length) cookie = setCookies.map(entry => entry.split(';')[0]).join('; ');
      const text = await response.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch (err) { body = text; }
      return { status: response.status, body };
    }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function login(name) {
  const user = client();
  const session = await user.req('/api/session');
  assert(session.status === 200, `session ${session.status}`);
  const named = await user.req('/api/username', { method: 'POST', body: { username: name } });
  assert(named.status === 200, `username ${named.status}`);
  return user;
}

(async () => {
  const sets = await (await fetch(base + '/api/role-sets')).json();
  const names = sets.map(set => set.name);
  assert(names.includes('Sects & Violets'), `missing Sects & Violets in ${names.join(', ')}`);

  const host = await login('Storyteller');
  const created = await host.req('/api/room/create', { method: 'POST' });
  assert(created.status === 200, `create ${created.status}`);
  const code = created.body.room.code;
  assert(created.body.bag && created.body.bag.ok === false, 'empty table should not be a legal bag');

  const players = [];
  for (let i = 1; i <= 6; i += 1) {
    const player = await login(`Player ${i}`);
    const joined = await player.req('/api/room/join', { method: 'POST', body: { roomCode: code } });
    assert(joined.status === 200, `join ${i} ${joined.status} ${JSON.stringify(joined.body)}`);
    assert(!Object.prototype.hasOwnProperty.call(joined.body.room, 'selectedRoles'), 'players can see the bag');
    players.push(player);
  }

  const tb = await (await fetch(base + '/api/roles/trouble_brewing')).json();
  const pick = (group, id) => {
    const role = tb[group].find(entry => entry.id === id);
    if (!role) throw new Error(`missing ${id}`);
    return { id: role.id, name: role.name };
  };

  const illegal = await host.req(`/api/room/${code}/selected-roles`, {
    method: 'POST',
    body: {
      selectedRoles: [
        pick('Townsfolk', 'washerwoman'),
        pick('Townsfolk', 'librarian'),
        pick('Townsfolk', 'chef'),
        pick('Townsfolk', 'empath'),
        pick('Outsiders', 'saint'),
        pick('Demons', 'imp')
      ]
    }
  });
  assert(illegal.status === 200, `save illegal ${illegal.status}`);
  assert(illegal.body.bag.ok === false, `illegal bag was accepted: ${illegal.body.bag.errors}`);
  const refused = await host.req(`/api/room/${code}/assign-roles`, { method: 'POST' });
  assert(refused.status === 400, `illegal assign status ${refused.status}`);

  const legal = await host.req(`/api/room/${code}/selected-roles`, {
    method: 'POST',
    body: {
      selectedRoles: [
        pick('Townsfolk', 'washerwoman'),
        pick('Townsfolk', 'librarian'),
        pick('Townsfolk', 'chef'),
        pick('Outsiders', 'drunk'),
        pick('Minions', 'poisoner'),
        pick('Demons', 'imp')
      ]
    }
  });
  assert(legal.body.bag.ok === true, `legal bag rejected: ${(legal.body.bag.errors || []).join(' ')}`);
  assert(legal.body.bag.expected.Outsiders === 1, 'TB 6-player outsider count');

  const assigned = await host.req(`/api/room/${code}/assign-roles`, { method: 'POST' });
  assert(assigned.status === 200, `assign ${assigned.status} ${JSON.stringify(assigned.body)}`);

  const grimoire = await host.req(`/api/room/${code}/grimoire`);
  assert(grimoire.status === 200, `grimoire ${grimoire.status}`);
  const drunkSeat = grimoire.body.players.find(player => player.role && player.role.name === 'Drunk');
  assert(drunkSeat && drunkSeat.mask, 'grimoire should show who the Drunk believes they are');
  assert(drunkSeat.mask.category === 'Townsfolk', 'Drunk mask should be a Townsfolk');
  assert(grimoire.body.bluffs.length === 3, 'demon should have 3 bluffs');
  assert(!grimoire.body.bluffs.some(role => role.id === drunkSeat.mask.id), 'bluff overlapped the Drunk mask');
  const sheet = JSON.stringify(grimoire.body.nightSheet);
  assert(sheet.includes('Minion info') && sheet.includes('Demon info'), 'night sheet missing info steps');
  assert(sheet.includes(drunkSeat.mask.name), 'night sheet missed the Drunk wake');

  let drunkPlayer = null;
  let demonPlayer = null;
  for (const player of players) {
    const mine = await player.req('/api/my-role');
    assert(mine.body.role, 'player missing a role');
    assert(mine.body.role.name !== 'Drunk', `player was shown the Drunk: ${mine.body.role.name}`);
    if (mine.body.role.name === drunkSeat.mask.name) drunkPlayer = mine.body;
    if (mine.body.role.name === 'Imp') demonPlayer = mine.body;
    const peek = await player.req(`/api/room/${code}/grimoire`);
    assert(peek.status === 403, 'player could open the grimoire');
  }
  assert(drunkPlayer, 'nobody received the Drunk mask');
  assert(demonPlayer && demonPlayer.bluffs.length === 3, 'Imp did not receive bluffs');
  assert(!demonPlayer.role || demonPlayer.role.name === 'Imp', 'Imp card was replaced');

  const marked = await host.req(`/api/room/${code}/reminders`, {
    method: 'POST',
    body: { targetPlayerId: drunkSeat.playerId, reminder: 'Poisoned' }
  });
  assert(marked.status === 200, `reminder ${marked.status} ${JSON.stringify(marked.body)}`);
  const markedBook = await host.req(`/api/room/${code}/grimoire`);
  const markedSeat = markedBook.body.players.find(player => player.playerId === drunkSeat.playerId);
  assert(markedSeat.reminders.includes('Poisoned'), 'reminder was not saved');

  const snv = await host.req(`/api/room/${code}/role-set`, {
    method: 'POST',
    body: { roleSet: 'sects_and_violets' }
  });
  assert(snv.status === 200, `snv ${snv.status}`);
  assert(snv.body.bag.notes.some(note => note.includes('unchanged')), `S&V did not cancel: ${snv.body.bag.notes}`);
  assert(snv.body.bag.expected.Townsfolk === 3 && snv.body.bag.expected.Outsiders === 1, 'S&V 6-player base count');

  const custom = await host.req(`/api/room/${code}/scenario`, {
    method: 'POST',
    body: {
      name: 'Fang Gu only',
      roleIds: ['clockmaker', 'dreamer', 'mutant', 'sweetheart', 'witch', 'nodashii', 'fanggu']
    }
  });
  assert(custom.status === 200, `scenario ${custom.status} ${JSON.stringify(custom.body)}`);
  assert(custom.body.room.roleSetName === 'Fang Gu only', 'scenario name was not saved');
  const fangBag = await host.req(`/api/room/${code}/selected-roles`, {
    method: 'POST',
    body: {
      selectedRoles: [
        { id: 'clockmaker' },
        { id: 'dreamer' },
        { id: 'mutant' },
        { id: 'sweetheart' },
        { id: 'witch' },
        { id: 'nodashii' }
      ]
    }
  });
  assert(fangBag.body.bag.expected.Townsfolk === 2, `fang gu townsfolk ${fangBag.body.bag.expected.Townsfolk}`);
  assert(fangBag.body.bag.expected.Outsiders === 2, `fang gu outsiders ${fangBag.body.bag.expected.Outsiders}`);
  assert(fangBag.body.bag.ok === true, `fang gu bag ${fangBag.body.bag.errors}`);

  const bmr = await host.req(`/api/room/${code}/role-set`, {
    method: 'POST',
    body: { roleSet: 'bad_moon_rising' }
  });
  assert(bmr.status === 200, `bmr ${bmr.status}`);
  const godfather = await host.req(`/api/room/${code}/selected-roles`, {
    method: 'POST',
    body: {
      selectedRoles: [
        { id: 'grandmother' },
        { id: 'sailor' },
        { id: 'tinker' },
        { id: 'lunatic' },
        { id: 'godfather' },
        { id: 'pukka' }
      ]
    }
  });
  assert(godfather.body.bag.needsGodfatherChoice === true, 'godfather choice hidden');
  assert(godfather.body.bag.expected.Outsiders === 2, 'default godfather should add an outsider');
  const minus = await host.req(`/api/room/${code}/setup`, {
    method: 'POST',
    body: { godfatherChoice: 'minus' }
  });
  assert(minus.body.bag.expected.Outsiders === 0, `godfather minus outsiders ${minus.body.bag.expected.Outsiders}`);
  assert(minus.body.bag.expected.Townsfolk === 4, 'godfather minus should give the townsfolk back');
  const lunaticDeal = await host.req(`/api/room/${code}/selected-roles`, {
    method: 'POST',
    body: {
      selectedRoles: [
        { id: 'grandmother' },
        { id: 'sailor' },
        { id: 'chambermaid' },
        { id: 'exorcist' },
        { id: 'godfather' },
        { id: 'pukka' }
      ]
    }
  });
  assert(lunaticDeal.body.bag.ok === true, `minus bag ${lunaticDeal.body.bag.errors}`);

  const plus = await host.req(`/api/room/${code}/setup`, { method: 'POST', body: { godfatherChoice: 'plus' } });
  const lunaticBag = await host.req(`/api/room/${code}/selected-roles`, {
    method: 'POST',
    body: {
      selectedRoles: [
        { id: 'grandmother' },
        { id: 'sailor' },
        { id: 'tinker' },
        { id: 'lunatic' },
        { id: 'godfather' },
        { id: 'pukka' }
      ]
    }
  });
  assert(plus.body.bag.expected.Outsiders === 2, 'plus choice did not stick');
  assert(lunaticBag.body.bag.ok === true, `lunatic bag ${lunaticBag.body.bag.errors}`);
  const lunaticAssigned = await host.req(`/api/room/${code}/assign-roles`, { method: 'POST' });
  assert(lunaticAssigned.status === 200, `lunatic assign ${JSON.stringify(lunaticAssigned.body)}`);
  const lunaticBook = await host.req(`/api/room/${code}/grimoire`);
  const lunaticSeat = lunaticBook.body.players.find(player => player.role && player.role.name === 'Lunatic');
  assert(lunaticSeat && lunaticSeat.mask && lunaticSeat.mask.category === 'Demons', 'Lunatic has no demon mask');
  assert(lunaticSeat.mask.name !== 'Pukka', `Lunatic was shown the real demon ${lunaticSeat.mask.name}`);
  assert(lunaticBook.body.lunaticBluffs.length === 3, 'Lunatic bluffs missing');

  let lunaticCard = null;
  for (const player of players) {
    const mine = await player.req('/api/my-role');
    if (mine.body.role && mine.body.role.name === lunaticSeat.mask.name && mine.body.bluffs) {
      lunaticCard = mine.body;
    }
  }
  assert(lunaticCard, 'Lunatic was not shown a demon card');
  assert(lunaticCard.bluffs.length === 3, 'Lunatic card has no bluffs');

  console.log(`playtest passed in room ${code}`);
  console.log(`Drunk believes they are ${drunkSeat.mask.name}`);
  console.log(`Demon bluffs: ${grimoire.body.bluffs.map(role => role.name).join(', ')}`);
  console.log(`Lunatic believes they are ${lunaticSeat.mask.name}`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
