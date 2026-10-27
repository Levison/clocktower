'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const config = {
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.DISCORD_CLIENT_ID || '',
  /** Optional: register guild commands instantly during development */
  guildId: process.env.DISCORD_GUILD_ID || '',
  /** Default script when creating a game */
  defaultScript: process.env.DEFAULT_SCRIPT || 'trouble_brewing',
};

function assertRuntimeConfig() {
  required('DISCORD_TOKEN');
  required('DISCORD_CLIENT_ID');
}

module.exports = { config, assertRuntimeConfig };
