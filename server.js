const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const setup = require('./lib/setup.cjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // Increase timeouts to handle inactive tabs better
  pingTimeout: 60000,      // 60 seconds (default is 20s)
  pingInterval: 25000,     // 25 seconds (default)
  // Allow reconnection with same session
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true
  }
});

app.use(express.json());
app.use(cookieParser());

// Serve static files from Parcel's dist output
// Files are content-hashed by Parcel, so we can use long-term caching for assets
app.use(express.static(path.join(__dirname, 'dist'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    // For HTML files, never cache
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      // For hashed assets (JS/CSS), use long-term caching
      // Parcel adds content hashes to filenames, so this is safe
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// Serve bell.mp3 for the gong sound
app.get('/bell.mp3', (req, res) => {
  res.sendFile(path.join(__dirname, 'bell.mp3'));
});

// Load animal emojis
const emojis = fs.readFileSync(path.join(__dirname, 'animal_emojis.txt'), 'utf-8')
  .split('\n')
  .filter(e => e.trim().length > 0);

// Load all role sets from the roles/ folder
const roleSets = {};
const fabled = [];
const fabledById = new Map();
const rolesDir = path.join(__dirname, 'roles');
const roleFiles = fs.readdirSync(rolesDir).filter(f => f.endsWith('.json'));

for (const file of roleFiles) {
  const setId = file.replace('.json', '');
  const data = JSON.parse(fs.readFileSync(path.join(rolesDir, file), 'utf-8'));
  if (data.Kind === 'fabled') {
    for (const role of (data.Roles && data.Roles.Fabled) || []) {
      const entry = { ...role, category: 'Fabled' };
      fabled.push(entry);
      fabledById.set(entry.id, entry);
    }
    continue;
  }
  roleSets[setId] = {
    id: setId,
    name: data['Role Set'] || setId,
    roles: data.Roles
  };
}

// Default role set for backwards compatibility
const defaultRoleSet = 'trouble_brewing';
const roles = roleSets[defaultRoleSet]?.roles || {};

function flattenRoles(grouped) {
  const list = [];
  for (const category of setup.CATEGORIES) {
    for (const role of grouped[category] || []) {
      list.push({ ...role, category });
    }
  }
  return list;
}

const catalog = [];
const catalogById = new Map();
for (const set of Object.values(roleSets)) {
  for (const role of flattenRoles(set.roles)) {
    if (catalogById.has(role.id)) continue;
    catalog.push(role);
    catalogById.set(role.id, role);
  }
}

// Load version from package.json
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const version = packageJson.version;

// In-memory storage
const rooms = new Map();
const players = new Map();
const playerRoles = new Map(); // playerId -> { role, category }
const deadPlayers = new Map(); // roomCode -> Set of dead player IDs
const drunkPlayers = new Map(); // roomCode -> Set of drunk player IDs (host reminder only)
const playerOrder = new Map(); // roomCode -> Array of player IDs in circle order
const chatMessages = new Map(); // roomCode -> Array of chat messages
const seatReminders = new Map(); // roomCode -> Map(playerId -> reminder names)
const socketsByPlayer = new Map(); // playerId -> Set of socket ids

function emitToPlayer(playerId, event, payload) {
  const ids = socketsByPlayer.get(playerId);
  if (!ids) return;
  for (const socketId of ids) io.to(socketId).emit(event, payload);
}

function scenarioName(room) {
  if (room.roleSet === 'custom' && room.scenario && room.scenario.name) return room.scenario.name;
  const set = roleSets[room.roleSet] || roleSets[defaultRoleSet];
  return set.name;
}

function scriptList(room) {
  if (room.roleSet === 'custom' && room.scenario) {
    return room.scenario.roleIds.map(id => catalogById.get(id)).filter(Boolean);
  }
  const set = roleSets[room.roleSet] || roleSets[defaultRoleSet];
  return flattenRoles(set.roles);
}

function nonHostIds(room) {
  return room.players.filter(id => id !== room.hostId);
}

function syncTravellerAlignments(room) {
  const next = {};
  for (const role of room.selectedRoles || []) {
    if (role.category !== 'Travellers') continue;
    next[role.id] = room.travellerAlignments && room.travellerAlignments[role.id] === 'evil' ? 'evil' : 'good';
  }
  room.travellerAlignments = next;
}

function bagState(room) {
  const bag = room.selectedRoles || [];
  const inPlayFabled = room.fabled || [];
  const check = setup.validateBag({
    playerCount: nonHostIds(room).length,
    script: scriptList(room),
    bag,
    godfatherChoice: room.godfatherChoice || 'plus',
    fabled: inPlayFabled
  });
  return {
    ...check,
    godfatherChoice: room.godfatherChoice || 'plus',
    travellerAlignments: room.travellerAlignments || {},
    nightSheet: setup.previewNightSheet(bag, {
      fabled: inPlayFabled,
      travellerAlignments: room.travellerAlignments || {}
    })
  };
}

function viewRoom(room, requesterId) {
  const view = {
    code: room.code,
    hostId: room.hostId,
    players: room.players,
    createdAt: room.createdAt,
    rolesAssigned: !!room.rolesAssigned,
    roleSet: room.roleSet,
    roleSetName: scenarioName(room),
    fabled: (room.fabled || []).map(setup.card)
  };
  if (requesterId === room.hostId) {
    view.selectedRoles = room.selectedRoles || [];
    view.godfatherChoice = room.godfatherChoice || 'plus';
    view.travellerAlignments = room.travellerAlignments || {};
  }
  return view;
}

function roomResponse(room, requesterId) {
  const isHost = requesterId === room.hostId;
  return {
    room: viewRoom(room, requesterId),
    roleSetRoles: setup.groupByCategory(scriptList(room)),
    bag: isHost ? bagState(room) : null
  };
}

function clearDeal(code) {
  const room = rooms.get(code);
  if (!room) return;
  for (const pid of room.players) playerRoles.delete(pid);
  deadPlayers.delete(code);
  drunkPlayers.delete(code);
  seatReminders.delete(code);
  room.rolesAssigned = false;
  room.bluffs = [];
  room.lunaticBluffs = [];
  rooms.set(code, room);
}

function resolveBag(inputRoles, script) {
  const resolved = [];
  const seen = new Set();
  for (const input of inputRoles || []) {
    if (!input) continue;
    const role = (input.id && script.find(entry => entry.id === input.id))
      || (input.name && script.find(entry => entry.name === input.name));
    if (!role || seen.has(role.id)) continue;
    seen.add(role.id);
    resolved.push(role);
  }
  return resolved;
}

function dealtNightSheet(code) {
  const room = rooms.get(code);
  if (!room) return setup.previewNightSheet([]);
  const assignments = [];
  for (const pid of nonHostIds(room)) {
    const role = playerRoles.get(pid);
    if (!role) continue;
    const player = players.get(pid);
    assignments.push({
      role,
      mask: role.mask || null,
      alignment: role.alignment || null,
      playerName: player ? (player.username || 'Unknown') : 'Unknown'
    });
  }
  return setup.nightSheet(assignments, {
    bluffs: room.bluffs || [],
    lunaticBluffs: room.lunaticBluffs || [],
    fabled: room.fabled || []
  });
}

function findLunatic(room) {
  for (const pid of room.players) {
    const role = playerRoles.get(pid);
    if (role && role.id === 'lunatic') {
      const player = players.get(pid);
      return player ? { username: player.username, emoji: player.emoji } : null;
    }
  }
  return null;
}

// Generate a random 4-letter room code
function generateRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Excluding I and O to avoid confusion
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += letters[Math.floor(Math.random() * letters.length)];
  }
  // Ensure uniqueness
  if (rooms.has(code)) {
    return generateRoomCode();
  }
  return code;
}

// Get random emoji
function getRandomEmoji() {
  return emojis[Math.floor(Math.random() * emojis.length)];
}

// API: Get or create player session
app.get('/api/session', (req, res) => {
  let playerId = req.cookies.playerId;
  
  if (!playerId || !players.has(playerId)) {
    playerId = uuidv4();
    const emoji = getRandomEmoji();
    players.set(playerId, {
      id: playerId,
      username: null,
      emoji: emoji,
      roomCode: null,
      isHost: false
    });
  }
  
  res.cookie('playerId', playerId, { 
    httpOnly: false, 
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
  
  res.json(players.get(playerId));
});

// API: Update username
app.post('/api/username', (req, res) => {
  const playerId = req.cookies.playerId;
  const { username } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  const player = players.get(playerId);
  player.username = username;
  players.set(playerId, player);
  
  // If player is in a room, notify others
  if (player.roomCode && rooms.has(player.roomCode)) {
    io.to(player.roomCode).emit('playerUpdated', player);
  }
  
  res.json(player);
});

// API: Update emoji
app.post('/api/emoji', (req, res) => {
  const playerId = req.cookies.playerId;
  const { emoji } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!emoji) {
    return res.status(400).json({ error: 'Emoji is required' });
  }
  
  const player = players.get(playerId);
  player.emoji = emoji;
  players.set(playerId, player);
  
  // If player is in a room, notify others
  if (player.roomCode && rooms.has(player.roomCode)) {
    io.to(player.roomCode).emit('playerUpdated', player);
  }
  
  res.json(player);
});

// API: Create room
app.post('/api/room/create', (req, res) => {
  const playerId = req.cookies.playerId;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  const player = players.get(playerId);
  
  // Leave current room if in one
  if (player.roomCode && rooms.has(player.roomCode)) {
    leaveRoom(playerId, player.roomCode);
  }
  
  // Special emoji for luc/lucas
  const lowerUsername = (player.username || '').toLowerCase();
  if (lowerUsername === 'luc' || lowerUsername === 'lucas') {
    player.emoji = '💩';
  }
  
  const roomCode = generateRoomCode();
  const room = {
    code: roomCode,
    hostId: playerId,
    players: [playerId],
    createdAt: Date.now(),
    selectedRoles: [], // Characters in the bag tonight
    rolesAssigned: false,
    roleSet: defaultRoleSet,
    godfatherChoice: 'plus',
    bluffs: [],
    lunaticBluffs: [],
    scenario: null,
    fabled: [],
    travellerAlignments: {}
  };
  
  rooms.set(roomCode, room);
  player.roomCode = roomCode;
  player.isHost = true;
  players.set(playerId, player);
  
  res.json({ ...roomResponse(room, playerId), player });
});

// API: Join room
app.post('/api/room/join', (req, res) => {
  const playerId = req.cookies.playerId;
  const { roomCode } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  const code = roomCode.toUpperCase();
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const player = players.get(playerId);
  
  // Leave current room if in one
  if (player.roomCode && rooms.has(player.roomCode)) {
    leaveRoom(playerId, player.roomCode);
  }
  
  // Special emoji for luc/lucas
  const lowerUsername = (player.username || '').toLowerCase();
  if (lowerUsername === 'luc' || lowerUsername === 'lucas') {
    player.emoji = '💩';
  }
  
  const room = rooms.get(code);
  
  // Check if player is already in room
  if (!room.players.includes(playerId)) {
    room.players.push(playerId);
  }
  
  rooms.set(code, room);
  player.roomCode = code;
  player.isHost = room.hostId === playerId;
  players.set(playerId, player);
  
  // Notify other players
  io.to(code).emit('playerJoined', player);
  
  res.json({ ...roomResponse(room, playerId), player });
});

// API: Leave room
app.post('/api/room/leave', (req, res) => {
  const playerId = req.cookies.playerId;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  const player = players.get(playerId);
  
  if (player.roomCode && rooms.has(player.roomCode)) {
    leaveRoom(playerId, player.roomCode);
  }
  
  res.json({ success: true });
});

// API: Get room data
app.get('/api/room/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  const roomDeadPlayers = deadPlayers.get(code) || new Set();
  
  // Get the ordered player list (or default to room.players order)
  const orderedPlayerIds = playerOrder.get(code) || room.players;
  
  // Filter to only include players still in the room
  const validOrderedIds = orderedPlayerIds.filter(id => room.players.includes(id));
  
  // Add any new players that aren't in the order yet
  const newPlayers = room.players.filter(id => !validOrderedIds.includes(id));
  const finalOrder = [...validOrderedIds, ...newPlayers];
  
  const roomPlayers = finalOrder
    .map(id => {
      const player = players.get(id);
      if (player) {
        return { ...player, isDead: roomDeadPlayers.has(id) };
      }
      return null;
    })
    .filter(p => p);
  
  res.json({
    ...roomResponse(room, req.cookies.playerId),
    players: roomPlayers,
    playerOrder: finalOrder
  });
});

// API: Get available role sets
app.get('/api/role-sets', (req, res) => {
  const sets = Object.values(roleSets).map(set => ({
    id: set.id,
    name: set.name
  }));
  res.json(sets);
});

app.get('/api/fabled', (req, res) => {
  res.json(fabled.map(setup.card));
});

// API: Get roles for a specific role set
app.get('/api/roles/:setId', (req, res) => {
  const setId = req.params.setId;
  if (!roleSets[setId]) {
    return res.status(404).json({ error: 'Role set not found' });
  }
  res.json(roleSets[setId].roles);
});

// API: Get available roles (defaults to trouble brewing for backwards compatibility)
app.get('/api/roles', (req, res) => {
  res.json(roles);
});

// API: Full catalog for custom scenarios
app.get('/api/catalog', (req, res) => {
  const editions = Object.values(roleSets).map(set => ({
    id: set.id,
    name: set.name,
    roles: set.roles
  }));
  res.json({ editions });
});

// API: Resolve a pasted script into catalog ids
app.post('/api/scenario/parse', (req, res) => {
  const result = setup.parseScenarioImport(req.body && req.body.text, catalog);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// API: Get version
app.get('/api/version', (req, res) => {
  res.json({ version });
});

// API: Force all clients to reload (for development/deployment)
app.post('/api/force-reload', (req, res) => {
  console.log('🔄 Broadcasting force reload to all clients...');
  io.emit('forceReload');
  res.json({ success: true, message: 'Reload broadcast sent to all clients' });
});

// API: Update player order in circle (host only)
app.post('/api/room/:code/player-order', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { order } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can change player order' });
  }
  
  // Validate that all player IDs in order are actually in the room
  const validOrder = order.filter(id => room.players.includes(id));
  
  // Store the new order
  playerOrder.set(code, validOrder);
  
  // Notify all players of the new order
  io.to(code).emit('playerOrderChanged', validOrder);
  
  res.json({ success: true, order: validOrder });
});

// API: Update role set (host only)
app.post('/api/room/:code/role-set', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { roleSet } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can change settings' });
  }
  
  if (!roleSets[roleSet]) {
    return res.status(400).json({ error: 'Invalid role set' });
  }
  
  const wasAssigned = room.rolesAssigned;
  room.roleSet = roleSet;
  room.scenario = null;
  room.selectedRoles = [];
  syncTravellerAlignments(room);
  if (wasAssigned) {
    clearDeal(code);
    io.to(code).emit('rolesReset');
  }
  rooms.set(code, room);
  
  const grouped = setup.groupByCategory(scriptList(room));
  io.to(code).emit('roleSetChanged', {
    roleSet,
    roleSetName: roleSets[roleSet].name,
    roles: grouped
  });
  emitToPlayer(room.hostId, 'selectedRolesUpdated', []);
  emitToPlayer(room.hostId, 'bagUpdated', bagState(room));
  
  res.json({ roleSet, roleSetName: roleSets[roleSet].name, bag: bagState(room) });
});

// API: Update selected roles (host only)
app.post('/api/room/:code/selected-roles', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { selectedRoles } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can change settings' });
  }
  
  const validRoles = resolveBag(selectedRoles, scriptList(room));
  
  room.selectedRoles = validRoles;
  syncTravellerAlignments(room);
  rooms.set(code, room);
  
  const bag = bagState(room);
  emitToPlayer(room.hostId, 'selectedRolesUpdated', room.selectedRoles);
  emitToPlayer(room.hostId, 'bagUpdated', bag);
  
  res.json({ selectedRoles: room.selectedRoles, bag });
});

// API: Assign roles (host only)
app.post('/api/room/:code/assign-roles', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can assign roles' });
  }
  
  const eligiblePlayers = nonHostIds(room);
  const result = setup.dealRoles({
    playerIds: eligiblePlayers,
    script: scriptList(room),
    bag: room.selectedRoles || [],
    catalog,
    godfatherChoice: room.godfatherChoice || 'plus',
    travellerAlignments: room.travellerAlignments || {},
    fabled: room.fabled || []
  });
  
  if (!result.ok) {
    return res.status(400).json({ error: result.errors.join(' '), errors: result.errors });
  }
  
  for (const pid of room.players) playerRoles.delete(pid);
  for (const assignment of result.assignments) {
    playerRoles.set(assignment.playerId, {
      ...assignment.role,
      mask: assignment.mask ? { ...assignment.mask } : null,
      alignment: assignment.alignment || null
    });
  }
  
  room.rolesAssigned = true;
  room.bluffs = result.bluffs;
  room.lunaticBluffs = result.lunaticBluffs;
  seatReminders.set(code, new Map());
  rooms.set(code, room);
  
  for (const pid of eligiblePlayers) {
    io.to(code).emit('roleAssigned', { playerId: pid, hasRole: true });
  }
  io.to(code).emit('rolesDistributed');
  
  res.json({ success: true, totalAssigned: result.assignments.length });
});

// API: Get my role
app.get('/api/my-role', (req, res) => {
  const playerId = req.cookies.playerId;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  const role = playerRoles.get(playerId);
  
  if (!role) {
    return res.json({ role: null });
  }
  
  const player = players.get(playerId);
  const room = player && player.roomCode ? rooms.get(player.roomCode) : null;
  const hidden = role.id === 'drunk' || role.id === 'lunatic' || role.id === 'apprentice';
  const body = { role: hidden && role.mask ? setup.card(role.mask) : setup.card(role) };
  if (role.alignment) body.alignment = role.alignment;
  if (room && role.id === 'lunatic') {
    body.bluffs = (room.lunaticBluffs || []).map(setup.card);
  } else if (room && role.category === 'Demons') {
    body.bluffs = (room.bluffs || []).map(setup.card);
    body.lunatic = findLunatic(room);
  }
  
  res.json(body);
});

// API: Get all player roles (host/Grimoire view only)
app.get('/api/room/:code/grimoire', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  // Only the host can see the Grimoire
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can view the Grimoire' });
  }
  
  // Get all players (excluding host) with their roles, in circle order
  const roomDeadPlayers = deadPlayers.get(code) || new Set();
  const roomDrunkPlayers = drunkPlayers.get(code) || new Set();
  const reminderMap = seatReminders.get(code) || new Map();
  const orderedPlayerIds = playerOrder.get(code) || room.players;
  
  // Filter to only include players still in the room (excluding host)
  const validOrderedIds = orderedPlayerIds.filter(id => room.players.includes(id) && id !== room.hostId);
  
  // Add any new players that aren't in the order yet
  const newPlayers = room.players.filter(id => !validOrderedIds.includes(id) && id !== room.hostId);
  const finalOrder = [...validOrderedIds, ...newPlayers];
  
  const grimoireData = finalOrder
    .map(pid => {
      const player = players.get(pid);
      const role = playerRoles.get(pid);
      return {
        playerId: pid,
        username: player ? player.username : 'Unknown',
        emoji: player ? player.emoji : '❓',
        role: role ? setup.card(role) : null,
        mask: role && role.mask ? setup.card(role.mask) : null,
        alignment: role && role.alignment ? role.alignment : null,
        reminders: reminderMap.get(pid) || [],
        isDead: roomDeadPlayers.has(pid),
        isDrunk: roomDrunkPlayers.has(pid)
      };
    });
  
  res.json({
    players: grimoireData,
    rolesAssigned: room.rolesAssigned,
    bluffs: (room.bluffs || []).map(setup.card),
    lunaticBluffs: (room.lunaticBluffs || []).map(setup.card),
    nightSheet: dealtNightSheet(code),
    reminderTokens: setup.reminderTokens([...(room.selectedRoles || []), ...(room.fabled || [])]),
    fabled: (room.fabled || []).map(setup.card)
  });
});

// API: Reset roles (host only)
app.post('/api/room/:code/reset-roles', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can reset roles' });
  }
  
  clearDeal(code);
  chatMessages.delete(code);
  
  io.to(code).emit('rolesReset');
  
  res.json({ success: true });
});

// API: Save a custom scenario (host only)
app.post('/api/room/:code/scenario', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { name, roleIds } = req.body || {};
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can change settings' });
  }
  if (!Array.isArray(roleIds) || roleIds.length === 0 || roleIds.length > 80) {
    return res.status(400).json({ error: 'Choose at least one character for the scenario.' });
  }
  
  const resolved = [];
  const seen = new Set();
  for (const id of roleIds) {
    const role = catalogById.get(id);
    if (!role || seen.has(role.id)) continue;
    seen.add(role.id);
    resolved.push(role.id);
  }
  if (!resolved.length) {
    return res.status(400).json({ error: 'None of those characters are in the catalog.' });
  }
  
  const wasAssigned = room.rolesAssigned;
  room.roleSet = 'custom';
  room.scenario = {
    name: String(name || 'Custom scenario').replace(/[\r\n]/g, ' ').slice(0, 40),
    roleIds: resolved
  };
  room.selectedRoles = [];
  syncTravellerAlignments(room);
  if (wasAssigned) {
    clearDeal(code);
    io.to(code).emit('rolesReset');
  }
  rooms.set(code, room);
  
  io.to(code).emit('roleSetChanged', {
    roleSet: 'custom',
    roleSetName: room.scenario.name,
    roles: setup.groupByCategory(scriptList(room))
  });
  emitToPlayer(room.hostId, 'selectedRolesUpdated', []);
  emitToPlayer(room.hostId, 'bagUpdated', bagState(room));
  
  res.json({ ...roomResponse(room, playerId) });
});

// API: Storyteller setup choices that change the bag (host only)
app.post('/api/room/:code/setup', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { godfatherChoice, travellerAlignments } = req.body || {};
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can change settings' });
  }
  const hasGodfather = Object.prototype.hasOwnProperty.call(req.body || {}, 'godfatherChoice');
  const hasAlignments = travellerAlignments && typeof travellerAlignments === 'object';
  if (!hasGodfather && !hasAlignments) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }
  if (hasGodfather && godfatherChoice !== 'plus' && godfatherChoice !== 'minus') {
    return res.status(400).json({ error: 'Godfather choice must be plus or minus.' });
  }
  if (hasGodfather) room.godfatherChoice = godfatherChoice;
  if (hasAlignments) {
    const next = { ...(room.travellerAlignments || {}) };
    for (const [id, value] of Object.entries(travellerAlignments)) {
      next[id] = value === 'evil' ? 'evil' : 'good';
    }
    room.travellerAlignments = next;
  }
  syncTravellerAlignments(room);
  rooms.set(code, room);
  const bag = bagState(room);
  emitToPlayer(room.hostId, 'bagUpdated', bag);
  res.json({ bag });
});

app.post('/api/room/:code/fabled', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { roleIds } = req.body || {};

  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const room = rooms.get(code);
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can change settings' });
  }

  const wanted = new Set(Array.isArray(roleIds) ? roleIds : []);
  room.fabled = fabled.filter(role => wanted.has(role.id));
  rooms.set(code, room);
  const cards = room.fabled.map(setup.card);
  io.to(code).emit('fabledUpdated', cards);
  const bag = bagState(room);
  emitToPlayer(room.hostId, 'bagUpdated', bag);
  res.json({ fabled: cards, bag });
});

// API: Place or remove a reminder token (host only)
app.post('/api/room/:code/reminders', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { targetPlayerId, reminder, remove } = req.body || {};
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can change reminders' });
  }
  if (!room.rolesAssigned) {
    return res.status(400).json({ error: 'Assign roles before marking reminders' });
  }
  if (!room.players.includes(targetPlayerId) || targetPlayerId === room.hostId) {
    return res.status(400).json({ error: 'Player not in the grimoire' });
  }
  
  const allowed = setup.reminderTokens([...(room.selectedRoles || []), ...(room.fabled || [])]);
  if (!allowed.includes(reminder)) {
    return res.status(400).json({ error: 'Unknown reminder token' });
  }
  
  if (!seatReminders.has(code)) seatReminders.set(code, new Map());
  const map = seatReminders.get(code);
  const current = map.get(targetPlayerId) || [];
  if (remove) {
    const index = current.lastIndexOf(reminder);
    if (index >= 0) current.splice(index, 1);
  } else if (current.length < 12) {
    current.push(reminder);
  }
  map.set(targetPlayerId, current);
  
  res.json({ reminders: current });
});

// API: Mark player as dead (host only)
app.post('/api/room/:code/kill-player', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { targetPlayerId } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can mark players as dead' });
  }
  
  if (!room.players.includes(targetPlayerId)) {
    return res.status(400).json({ error: 'Player not in room' });
  }
  
  // Initialize dead players set for this room if needed
  if (!deadPlayers.has(code)) {
    deadPlayers.set(code, new Set());
  }
  
  const roomDeadPlayers = deadPlayers.get(code);
  roomDeadPlayers.add(targetPlayerId);
  
  // Emit death event to the room
  console.log('Emitting playerKilled to room:', code, 'targetPlayerId:', targetPlayerId);
  io.to(code).emit('playerKilled', { playerId: targetPlayerId });
  
  res.json({ success: true });
});

// API: Revive player (host only)
app.post('/api/room/:code/revive-player', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { targetPlayerId } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can revive players' });
  }
  
  if (deadPlayers.has(code)) {
    deadPlayers.get(code).delete(targetPlayerId);
  }
  
  // Emit revive event to the room
  io.to(code).emit('playerRevived', { playerId: targetPlayerId });
  
  res.json({ success: true });
});

// API: Mark player as drunk (host only - for host's reference)
app.post('/api/room/:code/mark-drunk', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { targetPlayerId } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can mark players as drunk' });
  }
  
  if (!room.players.includes(targetPlayerId)) {
    return res.status(400).json({ error: 'Player not in room' });
  }
  
  // Initialize drunk players set for this room if needed
  if (!drunkPlayers.has(code)) {
    drunkPlayers.set(code, new Set());
  }
  
  const roomDrunkPlayers = drunkPlayers.get(code);
  roomDrunkPlayers.add(targetPlayerId);
  
  // Emit event only to host (grimoire update)
  io.to(code).emit('playerMarkedDrunk', { playerId: targetPlayerId });
  
  res.json({ success: true });
});

// API: Unmark player as drunk (host only)
app.post('/api/room/:code/unmark-drunk', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { targetPlayerId } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can unmark players as drunk' });
  }
  
  if (drunkPlayers.has(code)) {
    drunkPlayers.get(code).delete(targetPlayerId);
  }
  
  // Emit event for grimoire update
  io.to(code).emit('playerUnmarkedDrunk', { playerId: targetPlayerId });
  
  res.json({ success: true });
});

// API: Remove player from room (host only)
app.post('/api/room/:code/remove-player', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { targetPlayerId } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can remove players' });
  }
  
  // Cannot remove yourself (the host)
  if (targetPlayerId === playerId) {
    return res.status(400).json({ error: 'Cannot remove yourself' });
  }
  
  if (!room.players.includes(targetPlayerId)) {
    return res.status(400).json({ error: 'Player not in room' });
  }
  
  const targetPlayer = players.get(targetPlayerId);
  const targetName = targetPlayer ? targetPlayer.username : 'Unknown';
  const targetEmoji = targetPlayer ? targetPlayer.emoji : '❓';
  
  // Remove the player from the room
  leaveRoom(targetPlayerId, code);
  
  // Emit event to notify all players (including the removed player)
  io.to(code).emit('playerRemoved', { 
    playerId: targetPlayerId,
    username: targetName,
    emoji: targetEmoji
  });
  
  console.log(`Player ${targetName} was removed from room ${code} by host`);
  
  res.json({ success: true });
});

// API: Send chat message (host can message anyone, players can only message host)
app.post('/api/room/:code/chat', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { content, recipientId, isTemporary } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  // Validate sender is in the room
  if (!room.players.includes(playerId)) {
    return res.status(403).json({ error: 'You are not in this room' });
  }
  
  const sender = players.get(playerId);
  const isHost = room.hostId === playerId;
  
  // Validate content
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }
  
  if (content.length > 500) {
    return res.status(400).json({ error: 'Message too long (max 500 characters)' });
  }
  
  // Non-host players can only message the host
  if (!isHost) {
    if (recipientId !== room.hostId) {
      return res.status(403).json({ error: 'Players can only message the host' });
    }
  } else {
    // Host: validate recipient if provided
    if (recipientId && !room.players.includes(recipientId)) {
      return res.status(400).json({ error: 'Invalid recipient' });
    }
  }
  
  // Create message object
  const message = {
    id: Date.now().toString(),
    senderId: playerId,
    senderEmoji: sender.emoji,
    senderUsername: sender.username,
    isFromHost: isHost,
    recipientId: recipientId || null, // null means "everyone" (host only)
    content: content.trim(),
    timestamp: Date.now(),
    isTemporary: isHost && isTemporary === true // Only host can send temporary messages
  };
  
  // Store message (but not temporary messages - they're ephemeral)
  if (!message.isTemporary) {
    if (!chatMessages.has(code)) {
      chatMessages.set(code, []);
    }
    chatMessages.get(code).push(message);
  }
  
  // Emit to appropriate recipients
  if (recipientId) {
    // DM: Send to the specific recipient and the sender
    io.to(code).emit('chatMessage', {
      ...message,
      _recipientOnly: recipientId // Client will filter based on this
    });
  } else {
    // Group message (host only): Send to everyone in the room
    io.to(code).emit('chatMessage', message);
  }
  
  res.json({ success: true, message });
});

// API: Get chat history
app.get('/api/room/:code/chat', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  // Check if player is in the room
  if (!room.players.includes(playerId)) {
    return res.status(403).json({ error: 'Not in room' });
  }
  
  const allMessages = chatMessages.get(code) || [];
  
  // Filter messages: show all group messages, but only DMs addressed to this player (or sent by host)
  const visibleMessages = allMessages.filter(msg => {
    // Group messages are visible to everyone
    if (!msg.recipientId) return true;
    
    // DMs are visible to the recipient or the sender (host)
    return msg.recipientId === playerId || msg.senderId === playerId;
  });
  
  res.json({ messages: visibleMessages });
});

// Helper function to leave a room
function leaveRoom(playerId, roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  room.players = room.players.filter(id => id !== playerId);

  const player = players.get(playerId);
  if (player) {
    player.roomCode = null;
    player.isHost = false;
    players.set(playerId, player);
  }

  // Clear player's role assignment when leaving
  playerRoles.delete(playerId);

  const reminders = seatReminders.get(roomCode);
  if (reminders) reminders.delete(playerId);

  if (room.players.length === 0) {
    // Delete empty room
    rooms.delete(roomCode);
    deadPlayers.delete(roomCode);
    drunkPlayers.delete(roomCode);
    playerOrder.delete(roomCode);
    chatMessages.delete(roomCode);
    seatReminders.delete(roomCode);
  } else {
    // Transfer host if needed
    if (room.hostId === playerId) {
      room.hostId = room.players[0];
      const newHost = players.get(room.hostId);
      if (newHost) {
        newHost.isHost = true;
        players.set(room.hostId, newHost);
        io.to(roomCode).emit('hostChanged', newHost);
      }
    }
    rooms.set(roomCode, room);
    io.to(roomCode).emit('playerLeft', { playerId });
  }
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New socket connection:', socket.id);
  let currentPlayerId = null;
  let currentRoomCode = null;
  
  // Send current server version to the client on connection
  socket.emit('serverVersion', { version });
  
  socket.on('authenticate', (playerId) => {
    console.log('Socket authenticated:', socket.id, 'playerId:', playerId);
    if (currentPlayerId && socketsByPlayer.has(currentPlayerId)) {
      socketsByPlayer.get(currentPlayerId).delete(socket.id);
    }
    currentPlayerId = playerId;
    if (!socketsByPlayer.has(playerId)) socketsByPlayer.set(playerId, new Set());
    socketsByPlayer.get(playerId).add(socket.id);
    const player = players.get(playerId);
    if (player && player.roomCode) {
      currentRoomCode = player.roomCode;
      console.log('Auto-joining room from authenticate:', player.roomCode);
      socket.join(player.roomCode);
    }
  });
  
  socket.on('joinRoom', (roomCode) => {
    console.log('Socket joining room:', roomCode, 'playerId:', currentPlayerId);
    if (currentRoomCode) {
      socket.leave(currentRoomCode);
    }
    currentRoomCode = roomCode;
    socket.join(roomCode);
  });
  
  socket.on('leaveRoom', () => {
    if (currentRoomCode) {
      socket.leave(currentRoomCode);
      currentRoomCode = null;
    }
  });
  
  // Gong event - host triggers a gong sound for all players
  socket.on('triggerGong', (roomCode) => {
    if (!currentPlayerId || !roomCode) return;
    
    const room = rooms.get(roomCode);
    if (!room) return;
    
    // Only the host can trigger the gong
    if (room.hostId !== currentPlayerId) return;
    
    console.log(`🔔 Gong triggered by host in room ${roomCode}`);
    
    // Broadcast gong to all players in the room (including the host)
    io.to(roomCode).emit('playGong');
  });
  
  socket.on('disconnect', () => {
    if (currentPlayerId && socketsByPlayer.has(currentPlayerId)) {
      socketsByPlayer.get(currentPlayerId).delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 7105;
server.listen(PORT, () => {
  console.log(`🩸 Blood on the Clocktower server running on http://localhost:${PORT}`);
});

