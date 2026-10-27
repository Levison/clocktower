'use strict';

const {
  SlashCommandBuilder,
  MessageFlags,
} = require('discord.js');
const { store } = require('../game/store');
const { Phase } = require('../game/phases');
const { listScripts, flattenRoles, findRole } = require('../game/roles');
const { ActionKind } = require('../game/actions');
const {
  dmPlayer,
  notifyStoryteller,
  roleRevealEmbed,
  actionInboxEmbed,
  gameStatusEmbed,
} = require('../discord/messaging');
const { buildPanel } = require('../discord/storytellerPanel');
const { config } = require('../config');

const data = new SlashCommandBuilder()
  .setName('clocktower')
  .setDescription('Blood on the Clocktower Discord game tools')
  .addSubcommand((sc) =>
    sc
      .setName('create')
      .setDescription('Create a game in this channel (you become the storyteller)')
      .addStringOption((opt) =>
        opt
          .setName('script')
          .setDescription('Script / role set')
          .setRequired(false)
          .addChoices(
            ...listScripts().slice(0, 25).map((s) => ({ name: s.name, value: s.id })),
          ),
      ),
  )
  .addSubcommand((sc) =>
    sc.setName('join').setDescription('Sign in to the active game as a player'),
  )
  .addSubcommand((sc) =>
    sc.setName('leave').setDescription('Leave the lobby before the game starts'),
  )
  .addSubcommand((sc) =>
    sc.setName('status').setDescription('Show the public game status'),
  )
  .addSubcommand((sc) =>
    sc
      .setName('roles')
      .setDescription('List roles on the current script (or a named script)')
      .addStringOption((opt) =>
        opt.setName('script').setDescription('Script id').setRequired(false),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('select-roles')
      .setDescription('Storyteller: set the role bag (comma-separated names)')
      .addStringOption((opt) =>
        opt
          .setName('roles')
          .setDescription('e.g. Imp, Poisoner, Empath, Washerwoman, ...')
          .setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc.setName('deal').setDescription('Storyteller: shuffle and DM roles to players'),
  )
  .addSubcommand((sc) =>
    sc.setName('start').setDescription('Storyteller: begin first night'),
  )
  .addSubcommand((sc) =>
    sc.setName('panel').setDescription('Storyteller: post/refresh the control panel'),
  )
  .addSubcommand((sc) =>
    sc
      .setName('action')
      .setDescription('Submit an action privately to the storyteller')
      .addStringOption((opt) =>
        opt.setName('text').setDescription('What you are doing / choosing').setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName('kind')
          .setDescription('Action category')
          .setRequired(false)
          .addChoices(
            { name: 'Night ability', value: ActionKind.NIGHT_ABILITY },
            { name: 'Day ability', value: ActionKind.DAY_ABILITY },
            { name: 'Nomination', value: ActionKind.NOMINATION },
            { name: 'Vote', value: ActionKind.VOTE },
            { name: 'Freeform', value: ActionKind.FREEFORM },
          ),
      ),
  )
  .addSubcommand((sc) =>
    sc.setName('end').setDescription('Storyteller: end the active game'),
  );

function requireGuild(interaction) {
  if (!interaction.guildId) {
    throw new Error('This command only works inside a server.');
  }
}

function requireGame(interaction) {
  const game = store.getForInteraction(interaction.guildId, interaction.channelId);
  if (!game) throw new Error('No active Clocktower game in this server. Use `/clocktower create`.');
  return game;
}

function requireStoryteller(interaction, game) {
  if (!game.isStoryteller(interaction.user.id)) {
    throw new Error('Only the storyteller can do that.');
  }
}

async function handleCreate(interaction) {
  requireGuild(interaction);
  const scriptId = interaction.options.getString('script') || config.defaultScript;
  const game = store.create({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    storytellerId: interaction.user.id,
    scriptId,
  });

  await interaction.reply({
    embeds: [gameStatusEmbed(game)],
    content:
      `**${interaction.user}** opened a Clocktower lobby.\n` +
      `Players: \`/clocktower join\` · Storyteller: \`/clocktower panel\``,
  });

  const panel = buildPanel(game);
  const panelMsg = await notifyStoryteller(interaction.client, game, {
    content: 'Your private storyteller panel (also available via `/clocktower panel`):',
    ...panel,
  });
  if (panelMsg) {
    game.storytellerPanelMessageId = panelMsg.id;
    if (panelMsg.channelId !== interaction.user.id) {
      // DM channel vs guild channel — store if it's a guild text channel id we know
    }
  }
}

async function handleJoin(interaction) {
  const game = requireGame(interaction);
  const seat = game.signIn({
    userId: interaction.user.id,
    displayName: interaction.member?.displayName || interaction.user.username,
  });

  await interaction.reply({
    content: `Signed in as **${seat.displayName}** (seat ${seat.seatIndex + 1}). ${game.players.size} player(s) ready.`,
  });

  await notifyStoryteller(interaction.client, game, {
    content: `📥 **${seat.displayName}** signed in (${game.players.size} total).`,
  });
}

async function handleLeave(interaction) {
  const game = requireGame(interaction);
  if (!game.signOut(interaction.user.id)) {
    await interaction.reply({ content: 'You were not signed in.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ content: 'You left the lobby.', flags: MessageFlags.Ephemeral });
}

async function handleStatus(interaction) {
  const game = requireGame(interaction);
  await interaction.reply({ embeds: [gameStatusEmbed(game)] });
}

async function handleRoles(interaction) {
  const game = store.getForInteraction(interaction.guildId, interaction.channelId);
  const scriptId =
    interaction.options.getString('script') || game?.scriptId || config.defaultScript;
  const roles = flattenRoles(scriptId);
  if (!roles.length) {
    await interaction.reply({ content: `Unknown script \`${scriptId}\`.`, flags: MessageFlags.Ephemeral });
    return;
  }
  const byCat = {};
  for (const r of roles) {
    byCat[r.category] = byCat[r.category] || [];
    byCat[r.category].push(r.name);
  }
  const body = Object.entries(byCat)
    .map(([cat, names]) => `**${cat}**\n${names.join(', ')}`)
    .join('\n\n');
  await interaction.reply({ content: body.slice(0, 1900), flags: MessageFlags.Ephemeral });
}

async function handleSelectRoles(interaction) {
  const game = requireGame(interaction);
  requireStoryteller(interaction, game);
  const raw = interaction.options.getString('roles', true);
  const names = raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const missing = names.filter((n) => !findRole(game.scriptId, n));
  if (missing.length) {
    await interaction.reply({
      content: `Unknown roles for this script: ${missing.join(', ')}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  game.setSelectedRoles(names.map((name) => ({ name })));
  await interaction.reply({
    content: `Role bag set (${game.selectedRoles.length}): ${game.selectedRoles.map((r) => r.name).join(', ')}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleDeal(interaction) {
  const game = requireGame(interaction);
  requireStoryteller(interaction, game);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const assignments = game.assignRoles();
  const scriptName = game.script?.name || game.scriptId;
  const failures = [];

  for (const { userId, role } of assignments) {
    const seat = game.players.get(userId);
    const msg = await dmPlayer(interaction.client, userId, {
      embeds: [roleRevealEmbed(seat, scriptName)],
    });
    if (!msg) failures.push(seat.displayName);
  }

  await notifyStoryteller(interaction.client, game, {
    content: 'Roles dealt. Grimoire:',
    ...buildPanel(game),
  });

  let reply = `Dealt ${assignments.length} roles via DM.`;
  if (failures.length) {
    reply += ` Could not DM: ${failures.join(', ')} (ask them to allow DMs from server members).`;
  }
  await interaction.editReply({ content: reply });
}

async function handleStart(interaction) {
  const game = requireGame(interaction);
  requireStoryteller(interaction, game);
  game.startGame();
  await interaction.reply({
    content: `First night begins. Storyteller: use \`/clocktower panel\` to prompt players and advance phases.`,
    embeds: [gameStatusEmbed(game)],
  });
  await notifyStoryteller(interaction.client, game, buildPanel(game));
}

async function handlePanel(interaction) {
  const game = requireGame(interaction);
  requireStoryteller(interaction, game);

  // Prefer posting in the current channel if the ST is in a private ST channel;
  // otherwise send an ephemeral panel + DM copy.
  const panel = buildPanel(game);
  if (interaction.channelId !== game.channelId) {
    game.storytellerChannelId = interaction.channelId;
  }

  await interaction.reply({
    ...panel,
    flags: MessageFlags.Ephemeral,
  });

  const delivered = await notifyStoryteller(interaction.client, game, {
    content: 'Storyteller panel:',
    ...panel,
  });
  if (delivered) game.storytellerPanelMessageId = delivered.id;
}

async function handleAction(interaction) {
  const game = requireGame(interaction);
  if (!game.isSignedIn(interaction.user.id) && !game.isStoryteller(interaction.user.id)) {
    await interaction.reply({
      content: 'Sign in with `/clocktower join` first.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const text = interaction.options.getString('text', true);
  const kind = interaction.options.getString('kind') || ActionKind.FREEFORM;
  const action = game.submitAction({
    playerId: interaction.user.id,
    kind,
    summary: text,
    payload: { text },
  });

  await interaction.reply({
    content: `Action submitted to the storyteller (\`${action.id.slice(-8)}\`).`,
    flags: MessageFlags.Ephemeral,
  });

  const name = game.players.get(interaction.user.id)?.displayName || interaction.user.username;
  await notifyStoryteller(interaction.client, game, {
    embeds: [actionInboxEmbed(game, action, name)],
    ...buildPanel(game),
  });
}

async function handleEnd(interaction) {
  const game = requireGame(interaction);
  requireStoryteller(interaction, game);
  store.end(game.id);
  await interaction.reply({ content: 'Game ended. Create a new lobby with `/clocktower create`.' });
}

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  try {
    switch (sub) {
      case 'create':
        return await handleCreate(interaction);
      case 'join':
        return await handleJoin(interaction);
      case 'leave':
        return await handleLeave(interaction);
      case 'status':
        return await handleStatus(interaction);
      case 'roles':
        return await handleRoles(interaction);
      case 'select-roles':
        return await handleSelectRoles(interaction);
      case 'deal':
        return await handleDeal(interaction);
      case 'start':
        return await handleStart(interaction);
      case 'panel':
        return await handlePanel(interaction);
      case 'action':
        return await handleAction(interaction);
      case 'end':
        return await handleEnd(interaction);
      default:
        await interaction.reply({ content: 'Unknown subcommand.', flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    const msg = err.message || 'Something went wrong.';
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  }
}

module.exports = { data, execute };
