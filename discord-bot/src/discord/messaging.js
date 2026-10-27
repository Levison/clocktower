'use strict';

const { EmbedBuilder } = require('discord.js');

/**
 * Send a private DM to a player. Returns null if DMs are closed.
 * @param {import('discord.js').Client} client
 * @param {string} userId
 * @param {import('discord.js').MessageCreateOptions} content
 */
async function dmPlayer(client, userId, content) {
  try {
    const user = await client.users.fetch(userId);
    return await user.send(content);
  } catch (err) {
    console.warn(`[dm] Could not DM ${userId}:`, err.message);
    return null;
  }
}

/**
 * Notify the storyteller in their private channel, or via DM as fallback.
 * @param {import('discord.js').Client} client
 * @param {import('../game/session').GameSession} session
 * @param {import('discord.js').MessageCreateOptions} content
 */
async function notifyStoryteller(client, session, content) {
  if (session.storytellerChannelId) {
    try {
      const channel = await client.channels.fetch(session.storytellerChannelId);
      if (channel && channel.isTextBased()) {
        return await channel.send(content);
      }
    } catch (err) {
      console.warn('[st] Storyteller channel send failed:', err.message);
    }
  }
  return dmPlayer(client, session.storytellerId, content);
}

function roleRevealEmbed(seat, scriptName) {
  const role = seat.role;
  return new EmbedBuilder()
    .setTitle(`Your role — ${role.name}`)
    .setDescription(role.description || '_No description_')
    .addFields(
      { name: 'Category', value: role.category || 'Unknown', inline: true },
      { name: 'Script', value: scriptName || 'Unknown', inline: true },
    )
    .setFooter({ text: 'Keep this private. Only the storyteller sees the grimoire.' })
    .setColor(0x8b0000);
}

function actionInboxEmbed(session, action, playerName) {
  return new EmbedBuilder()
    .setTitle('Incoming player action')
    .setDescription(action.summary || '_No summary_')
    .addFields(
      { name: 'Player', value: playerName || `<@${action.playerId}>`, inline: true },
      { name: 'Kind', value: action.kind, inline: true },
      { name: 'Phase', value: action.phase || '—', inline: true },
      { name: 'Action ID', value: action.id, inline: false },
    )
    .setColor(0x4a5568)
    .setTimestamp(action.createdAt);
}

function gameStatusEmbed(session) {
  const summary = session.publicSummary();
  const playerLines = summary.players.length
    ? summary.players
        .map((p) => {
          const dead = p.isDead ? ' 💀' : '';
          return `${p.seatIndex + 1}. **${p.displayName}**${dead}`;
        })
        .join('\n')
    : '_No one signed in yet._';

  return new EmbedBuilder()
    .setTitle(`Clocktower — ${summary.scriptName}`)
    .addFields(
      { name: 'Phase', value: summary.phaseLabel, inline: true },
      { name: 'Day', value: String(summary.dayNumber), inline: true },
      { name: 'Players', value: String(summary.playerCount), inline: true },
      { name: 'Storyteller', value: `<@${summary.storytellerId}>`, inline: true },
      { name: 'Pending actions', value: String(summary.pendingActions), inline: true },
      { name: 'Circle', value: playerLines, inline: false },
    )
    .setFooter({ text: `Game ${summary.id.slice(0, 8)}` })
    .setColor(0x1a1a2e);
}

module.exports = {
  dmPlayer,
  notifyStoryteller,
  roleRevealEmbed,
  actionInboxEmbed,
  gameStatusEmbed,
};
