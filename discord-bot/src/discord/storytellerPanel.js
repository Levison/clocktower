'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { Phase, PHASE_LABELS } = require('../game/phases');
const { ActionStatus } = require('../game/actions');

const IDS = Object.freeze({
  ADVANCE: 'ct:st:advance',
  GRIMOIRE: 'ct:st:grimoire',
  PROMPT_PLAYER: 'ct:st:prompt_player',
  RESOLVE_MENU: 'ct:st:resolve_menu',
  REFRESH: 'ct:st:refresh',
  END: 'ct:st:end',
});

function panelEmbed(session) {
  const pending = session.getPendingActions();
  const grimLines = session.grimoire().map((p) => {
    const role = p.role ? `**${p.role.name}** (${p.role.category})` : '_unassigned_';
    const flags = [p.isDead ? 'dead' : null, p.isDrunk ? 'drunk?' : null].filter(Boolean).join(', ');
    return `${p.seatIndex + 1}. ${p.displayName} — ${role}${flags ? ` [${flags}]` : ''}`;
  });

  return new EmbedBuilder()
    .setTitle('Storyteller panel')
    .setDescription(
      [
        `**Phase:** ${PHASE_LABELS[session.phase] || session.phase}`,
        `**Day:** ${session.dayNumber}`,
        `**Script:** ${session.script?.name || session.scriptId}`,
        `**Pending actions:** ${pending.length}`,
      ].join('\n'),
    )
    .addFields(
      {
        name: 'Grimoire',
        value: grimLines.length ? grimLines.join('\n').slice(0, 1024) : '_Empty_',
      },
      {
        name: 'Pending inbox',
        value: pending.length
          ? pending
              .slice(0, 10)
              .map((a) => `\`${a.id.slice(-8)}\` <@${a.playerId}> — ${a.kind}: ${a.summary || '…'}`)
              .join('\n')
              .slice(0, 1024)
          : '_No pending actions_',
      },
    )
    .setColor(0x2d3748);
}

function panelComponents(session) {
  const rows = [];

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(IDS.ADVANCE)
        .setLabel('Advance phase')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(session.phase === Phase.ENDED || session.phase === Phase.LOBBY),
      new ButtonBuilder()
        .setCustomId(IDS.GRIMOIRE)
        .setLabel('Send grimoire DM')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(IDS.PROMPT_PLAYER)
        .setLabel('Prompt player…')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(session.players.size === 0),
      new ButtonBuilder()
        .setCustomId(IDS.REFRESH)
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(IDS.END)
        .setLabel('End game')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(session.phase === Phase.ENDED),
    ),
  );

  const pending = session.getPendingActions().slice(0, 25);
  if (pending.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(IDS.RESOLVE_MENU)
          .setPlaceholder('Resolve a pending action…')
          .addOptions(
            pending.map((a) => ({
              label: `${a.kind}: ${(a.summary || 'action').slice(0, 80)}`,
              description: `From ${a.playerId} · ${a.id.slice(-10)}`,
              value: a.id,
            })),
          ),
      ),
    );
  }

  return rows;
}

function buildPanel(session) {
  return {
    embeds: [panelEmbed(session)],
    components: panelComponents(session),
  };
}

function playerPromptSelect(session) {
  const options = [...session.players.values()].slice(0, 25).map((p) => ({
    label: p.displayName.slice(0, 100),
    value: p.userId,
    description: p.role ? p.role.name : 'No role yet',
  }));

  return {
    content: 'Choose a player to send a private night/day prompt:',
    flags: MessageFlags.Ephemeral,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('ct:st:prompt_pick')
          .setPlaceholder('Select player')
          .addOptions(options),
      ),
    ],
  };
}

module.exports = {
  IDS,
  buildPanel,
  panelEmbed,
  panelComponents,
  playerPromptSelect,
  ActionStatus,
};
