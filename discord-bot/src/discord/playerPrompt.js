'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
} = require('discord.js');
const { ActionKind } = require('../game/actions');

/**
 * Build a DM prompt asking a player to submit an ability target / note.
 * Storyteller-driven: the ST decides when someone needs to act.
 */
function buildAbilityPrompt({ gameId, promptText, playerOptions = [] }) {
  const embed = new EmbedBuilder()
    .setTitle('The storyteller needs your action')
    .setDescription(promptText || 'Submit your choice for tonight/today.')
    .setColor(0x718096);

  const rows = [];

  if (playerOptions.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`ct:pl:target:${gameId}`)
          .setPlaceholder('Choose a player…')
          .setMinValues(1)
          .setMaxValues(Math.min(2, playerOptions.length))
          .addOptions(
            playerOptions.slice(0, 25).map((p) => ({
              label: p.displayName.slice(0, 100),
              value: p.userId,
            })),
          ),
      ),
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ct:pl:freeform:${gameId}`)
        .setLabel('Write freeform action')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`ct:pl:pass:${gameId}`)
        .setLabel('Pass / no action')
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components: rows };
}

function freeformModal(gameId) {
  return new ModalBuilder()
    .setCustomId(`ct:pl:modal:${gameId}`)
    .setTitle('Submit action')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('summary')
          .setLabel('What are you doing?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500)
          .setPlaceholder('e.g. Fortune Teller: Alice and Bob'),
      ),
    );
}

function actionFromTargetSelect(session, playerId, targetIds) {
  const names = targetIds.map((id) => {
    const seat = session.players.get(id);
    return seat ? seat.displayName : id;
  });
  return session.submitAction({
    playerId,
    kind: ActionKind.NIGHT_ABILITY,
    summary: `Chose: ${names.join(', ')}`,
    payload: { targets: targetIds },
  });
}

function actionFromFreeform(session, playerId, text) {
  return session.submitAction({
    playerId,
    kind: ActionKind.FREEFORM,
    summary: text,
    payload: { text },
  });
}

function actionPass(session, playerId) {
  return session.submitAction({
    playerId,
    kind: ActionKind.FREEFORM,
    summary: 'Pass / no action',
    payload: { pass: true },
  });
}

module.exports = {
  buildAbilityPrompt,
  freeformModal,
  actionFromTargetSelect,
  actionFromFreeform,
  actionPass,
};
