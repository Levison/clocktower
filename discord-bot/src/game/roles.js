'use strict';

const fs = require('fs');
const path = require('path');

const ROLES_DIR = path.join(__dirname, '..', '..', '..', 'roles');

const CATEGORIES = ['Townsfolk', 'Outsiders', 'Minions', 'Demons'];

/** @type {Map<string, { id: string, name: string, roles: object }>} */
const scripts = new Map();

function loadScripts() {
  scripts.clear();
  if (!fs.existsSync(ROLES_DIR)) {
    throw new Error(`Roles directory not found: ${ROLES_DIR}`);
  }

  for (const file of fs.readdirSync(ROLES_DIR).filter((f) => f.endsWith('.json'))) {
    const id = file.replace(/\.json$/, '');
    const data = JSON.parse(fs.readFileSync(path.join(ROLES_DIR, file), 'utf8'));
    scripts.set(id, {
      id,
      name: data['Role Set'] || id,
      roles: data.Roles || {},
    });
  }
  return scripts;
}

function listScripts() {
  if (scripts.size === 0) loadScripts();
  return [...scripts.values()].map(({ id, name }) => ({ id, name }));
}

function getScript(scriptId) {
  if (scripts.size === 0) loadScripts();
  return scripts.get(scriptId) || null;
}

function findRole(scriptId, roleName) {
  const script = getScript(scriptId);
  if (!script) return null;
  for (const category of CATEGORIES) {
    const list = script.roles[category] || [];
    const found = list.find((r) => r.name.toLowerCase() === roleName.toLowerCase());
    if (found) return { ...found, category };
  }
  return null;
}

function flattenRoles(scriptId) {
  const script = getScript(scriptId);
  if (!script) return [];
  const out = [];
  for (const category of CATEGORIES) {
    for (const role of script.roles[category] || []) {
      out.push({ ...role, category });
    }
  }
  return out;
}

module.exports = {
  CATEGORIES,
  loadScripts,
  listScripts,
  getScript,
  findRole,
  flattenRoles,
};
