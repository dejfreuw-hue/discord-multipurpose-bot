import { ChannelType, channelMention, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { formatDuration, parseDuration } from '../../../core/duration.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand } from '../../../core/module.js';

const MAX_SECONDS = 21_600;

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('moderation.slowmode.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((o) => o.setName('duration').setDescription('moderation.slowmode.options.duration').setRequired(true).setMaxLength(16))
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('moderation.slowmode.options.channel')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum, ChannelType.GuildVoice, ChannelType.PublicThread, ChannelType.PrivateThread),
    ),
  permissions: { user: PermissionFlagsBits.ManageChannels, bot: PermissionFlagsBits.ManageChannels, allowStaff: true },
  async run(ctx) {
    const raw = ctx.interaction.options.getString('duration', true).trim().toLowerCase();
    const channel = ctx.interaction.options.getChannel('channel') ?? ctx.interaction.channel;
    if (!channel || !('setRateLimitPerUser' in channel)) throw new UserError('moderation.slowmode.unsupported');

    let seconds = 0;
    if (!['off', '0', 'none'].includes(raw)) {
      const ms = parseDuration(/^\d+$/.test(raw) ? `${raw}s` : raw);
      if (ms === null) throw new UserError('moderation.errors.badDuration', { value: raw });
      seconds = Math.round(ms / 1000);
      if (seconds > MAX_SECONDS) throw new UserError('moderation.slowmode.tooLong');
    }

    await channel.setRateLimitPerUser(seconds, `${ctx.interaction.user.tag}: slowmode`);
    const where = channelMention(channel.id);
    await ctx.respond(
      ctx.successPanel(
        seconds === 0
          ? ctx.t('moderation.slowmode.off', { channel: where })
          : ctx.t('moderation.slowmode.on', { channel: where, duration: formatDuration(seconds * 1000) }),
      ),
    );
  },
});
