'use strict';

const { MessageFlags } = require('discord.js');
const { store } = require('../game/store');
const { ActionStatus } = require('../game/actions');
const {
  dmPlayer,
  notifyStoryteller,
  actionInboxEmbed,
} = require('./messaging');
const {
  IDS,
  buildPanel,
  playerPromptSelect,
} = require('./storytellerPanel');
const {
  buildAbilityPrompt,
  freeformModal,
  actionFromTargetSelect,
  actionFromFreeform,
  actionPass,
} = require('./playerPrompt');
const clocktower = require('../commands/clocktower');

function gameFromCustomId(customId, interaction) {
  // custom ids like ct:pl:freeform:<gameId>
  const parts = customId.split(':');
  const maybeGameId = parts[3];
  if (maybeGameId && store.get(maybeGameId)) return store.get(maybeGameId);
  return store.getForUser(interaction.user.id, interaction.guildId, interaction.channelId);
}

function requireSt(session, userId) {
  if (!session || !session.isStoryteller(userId)) {
    throw new Error('Storyteller only.');
  }
}

async function refreshPanelMessage(interaction, session) {
  const panel = buildPanel(session);
  if (interaction.message && interaction.message.editable) {
    try {
      await interaction.message.edit(panel);
      return;
    } catch {
      // fall through — ephemeral originals can't always be edited the same way
    }
  }
  await notifyStoryteller(interaction.client, session, {
    content: 'Updated storyteller panel:',
    ...panel,
  });
}

async function handleButton(interaction) {
  const id = interaction.customId;

  if (id.startsWith('ct:pl:freeform:')) {
    const game = gameFromCustomId(id, interaction);
    if (!game) {
      await interaction.reply({ content: 'Game not found.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.showModal(freeformModal(game.id));
    return;
  }

  if (id.startsWith('ct:pl:pass:')) {
    const game = gameFromCustomId(id, interaction);
    if (!game || !game.isSignedIn(interaction.user.id)) {
      await interaction.reply({ content: 'Not in this game.', flags: MessageFlags.Ephemeral });
      return;
    }
    const action = actionPass(game, interaction.user.id);
    await interaction.reply({ content: 'Passed — storyteller notified.', flags: MessageFlags.Ephemeral });
    const name = game.players.get(interaction.user.id)?.displayName;
    await notifyStoryteller(interaction.client, game, {
      embeds: [actionInboxEmbed(game, action, name)],
      ...buildPanel(game),
    });
    return;
  }

  const game = store.getForUser(interaction.user.id, interaction.guildId, interaction.channelId);
  if (!game) {
    await interaction.reply({ content: 'No active game.', flags: MessageFlags.Ephemeral });
    return;
  }

  switch (id) {
    case IDS.ADVANCE: {
      requireSt(game, interaction.user.id);
      const result = game.advancePhase();
      await interaction.reply({
        content: `Phase → **${game.phaseLabel}** (day ${result.dayNumber}).`,
        flags: MessageFlags.Ephemeral,
      });
      await refreshPanelMessage(interaction, game);
      if (game.channelId) {
        try {
          const ch = await interaction.client.channels.fetch(game.channelId);
          if (ch?.isTextBased()) {
            await ch.send(`⏰ Phase is now **${game.phaseLabel}** (day ${game.dayNumber}).`);
          }
        } catch {
          /* ignore */
        }
      }
      break;
    }
    case IDS.GRIMOIRE: {
      requireSt(game, interaction.user.id);
      await interaction.reply({ ...buildPanel(game), flags: MessageFlags.Ephemeral });
      await dmPlayer(interaction.client, interaction.user.id, {
        content: 'Grimoire snapshot:',
        ...buildPanel(game),
      });
      break;
    }
    case IDS.PROMPT_PLAYER: {
      requireSt(game, interaction.user.id);
      await interaction.reply(playerPromptSelect(game));
      break;
    }
    case IDS.REFRESH: {
      requireSt(game, interaction.user.id);
      await interaction.update(buildPanel(game));
      break;
    }
    case IDS.END: {
      requireSt(game, interaction.user.id);
      store.end(game.id);
      await interaction.update({
        content: 'Game ended.',
        embeds: [],
        components: [],
      });
      break;
    }
    default:
      await interaction.reply({ content: 'Unknown button.', flags: MessageFlags.Ephemeral });
  }
}

async function handleSelect(interaction) {
  const id = interaction.customId;

  if (id === 'ct:st:prompt_pick') {
    const game = store.getForUser(interaction.user.id, interaction.guildId, interaction.channelId);
    requireSt(game, interaction.user.id);
    const targetId = interaction.values[0];
    const seat = game.players.get(targetId);
    if (!seat) {
      await interaction.reply({ content: 'Player not found.', flags: MessageFlags.Ephemeral });
      return;
    }
    const others = [...game.players.values()].filter((p) => p.userId !== targetId);
    const prompt = buildAbilityPrompt({
      gameId: game.id,
      promptText:
        `You are being woken / asked for an action.\n` +
        (seat.role ? `_Your role card says:_ ${seat.role.description}` : ''),
      playerOptions: others.map((p) => ({ userId: p.userId, displayName: p.displayName })),
    });
    const sent = await dmPlayer(interaction.client, targetId, prompt);
    await interaction.reply({
      content: sent
        ? `Prompted **${seat.displayName}** via DM.`
        : `Could not DM **${seat.displayName}**. Ask them to enable DMs.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (id === IDS.RESOLVE_MENU) {
    const game = store.getForUser(interaction.user.id, interaction.guildId, interaction.channelId);
    requireSt(game, interaction.user.id);
    const actionId = interaction.values[0];
    const action = game.resolveAction(actionId, { status: ActionStatus.RESOLVED });
    await interaction.reply({
      content: `Resolved \`${action.id.slice(-8)}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    await refreshPanelMessage(interaction, game);
    return;
  }

  if (id.startsWith('ct:pl:target:')) {
    const game = gameFromCustomId(id, interaction);
    if (!game || !game.isSignedIn(interaction.user.id)) {
      await interaction.reply({ content: 'Not in this game.', flags: MessageFlags.Ephemeral });
      return;
    }
    const action = actionFromTargetSelect(game, interaction.user.id, interaction.values);
    await interaction.reply({ content: 'Choice submitted to the storyteller.', flags: MessageFlags.Ephemeral });
    const name = game.players.get(interaction.user.id)?.displayName;
    await notifyStoryteller(interaction.client, game, {
      embeds: [actionInboxEmbed(game, action, name)],
      ...buildPanel(game),
    });
  }
}

async function handleModal(interaction) {
  const id = interaction.customId;
  if (!id.startsWith('ct:pl:modal:')) return;

  const game = gameFromCustomId(id, interaction);
  if (!game || !game.isSignedIn(interaction.user.id)) {
    await interaction.reply({ content: 'Not in this game.', flags: MessageFlags.Ephemeral });
    return;
  }
  const text = interaction.fields.getTextInputValue('summary');
  const action = actionFromFreeform(game, interaction.user.id, text);
  await interaction.reply({ content: 'Action submitted.', flags: MessageFlags.Ephemeral });
  const name = game.players.get(interaction.user.id)?.displayName;
  await notifyStoryteller(interaction.client, game, {
    embeds: [actionInboxEmbed(game, action, name)],
    ...buildPanel(game),
  });
}

/**
 * Central InteractionCreate router.
 * @param {import('discord.js').Interaction} interaction
 */
async function routeInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'clocktower') {
        await clocktower.execute(interaction);
      }
      return;
    }
    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }
    if (interaction.isStringSelectMenu()) {
      await handleSelect(interaction);
      return;
    }
    if (interaction.isModalSubmit()) {
      await handleModal(interaction);
    }
  } catch (err) {
    console.error('[interaction]', err);
    const msg = err.message || 'Interaction failed.';
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      } else if (interaction.isRepliable()) {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    } catch {
      /* ignore */
    }
  }
}

module.exports = { routeInteraction };
