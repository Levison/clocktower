'use strict';

const { Client, GatewayIntentBits, Events, Partials } = require('discord.js');
const { config, assertRuntimeConfig } = require('./config');
const { loadScripts } = require('./game/roles');
const { routeInteraction } = require('./discord/interactionRouter');

function createClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      // Needed if we later read channel messages; slash/components work with Guilds alone.
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });
}

async function main() {
  loadScripts();
  assertRuntimeConfig();

  const client = createClient();

  client.once(Events.ClientReady, (c) => {
    console.log(`Clocktower bot ready as ${c.user.tag}`);
    console.log(`Scripts loaded. Default: ${config.defaultScript}`);
  });

  client.on(Events.InteractionCreate, routeInteraction);

  client.on(Events.Error, (err) => {
    console.error('[discord]', err);
  });

  await client.login(config.token);
}

main().catch((err) => {
  console.error('Failed to start bot:', err);
  process.exit(1);
});

module.exports = { createClient, main };
