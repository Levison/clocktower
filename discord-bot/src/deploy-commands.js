'use strict';

const { REST, Routes } = require('discord.js');
const { config, assertRuntimeConfig } = require('./config');
const { loadScripts } = require('./game/roles');
const clocktower = require('./commands/clocktower');

async function main() {
  loadScripts();
  assertRuntimeConfig();

  const commands = [clocktower.data.toJSON()];
  const rest = new REST({ version: '10' }).setToken(config.token);

  if (config.guildId) {
    console.log(`Deploying ${commands.length} guild command(s) to ${config.guildId}…`);
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
      body: commands,
    });
    console.log('Guild commands deployed.');
  } else {
    console.log(`Deploying ${commands.length} global command(s)…`);
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    console.log('Global commands deployed (may take up to an hour to appear).');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
