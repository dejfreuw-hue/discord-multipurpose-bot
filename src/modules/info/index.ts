import { ChannelType, GuildPremiumTier, SlashCommandBuilder, time, TimestampStyles, userMention } from 'discord.js';
import { defineCommand, defineContextMenu, defineModule } from '../../core/module.js';
import { userPanel } from './user.js';

const userinfo = defineCommand({
  scope: 'anywhere',
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('info.user.description')
    .addUserOption((o) => o.setName('user').setDescription('info.user.options.user')),
  defer: 'public',
  async run(ctx) {
    const user = ctx.interaction.options.getUser('user') ?? ctx.interaction.user;
    const member = ctx.guild ? await ctx.guild.members.fetch(user.id).catch(() => null) : null;
    await ctx.respond(await userPanel(ctx, user, member));
  },
});

const userinfoMenu = defineContextMenu({
  type: 'user',
  name: 'info.user.menu',
  scope: 'anywhere',
  defer: 'ephemeral',
  async run(ctx) {
    const { targetUser } = ctx.interaction;
    const member = ctx.guild ? await ctx.guild.members.fetch(targetUser.id).catch(() => null) : null;
    await ctx.respond(await userPanel(ctx, targetUser, member));
  },
});

const serverinfo = defineCommand({
  data: new SlashCommandBuilder().setName('serverinfo').setDescription('info.server.description'),
  defer: 'public',
  async run(ctx) {
    const { guild } = ctx;
    const channels = guild.channels.cache;
    const count = (...types: ChannelType[]) => channels.filter((c) => types.includes(c.type)).size;
    const tier = {
      [GuildPremiumTier.None]: 0,
      [GuildPremiumTier.Tier1]: 1,
      [GuildPremiumTier.Tier2]: 2,
      [GuildPremiumTier.Tier3]: 3,
    }[guild.premiumTier];

    await ctx.respond(
      ctx
        .panel()
        .thumbnail(guild.iconURL({ size: 256 }))
        .text(`**${guild.name}**`, guild.description, `-# ${guild.id}`)
        .fields([
          { name: ctx.t('info.server.owner'), value: userMention(guild.ownerId), inline: true },
          { name: ctx.t('info.server.created'), value: time(guild.createdAt, TimestampStyles.LongDate), inline: true },
          { name: ctx.t('info.server.members'), value: guild.memberCount.toLocaleString(ctx.locale), inline: true },
          {
            name: ctx.t('info.server.channels'),
            value: ctx.t('info.server.channelLine', {
              text: count(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia),
              voice: count(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
              categories: count(ChannelType.GuildCategory),
            }),
            inline: true,
          },
          { name: ctx.t('info.server.roles'), value: String(guild.roles.cache.size - 1), inline: true },
          {
            name: ctx.t('info.server.emojis'),
            value: ctx.t('info.server.emojiLine', { emojis: guild.emojis.cache.size, stickers: guild.stickers.cache.size }),
            inline: true,
          },
          {
            name: ctx.t('info.server.boosts'),
            value: ctx.t('info.server.boostLine', { count: guild.premiumSubscriptionCount ?? 0, tier }),
            inline: true,
          },
          { name: ctx.t('info.server.verification'), value: ctx.t(`info.verification.${guild.verificationLevel}`), inline: true },
        ])
        .image(guild.bannerURL({ size: 1024 })),
    );
  },
});

export default defineModule({
  name: 'info',
  toggleable: true,
  commands: [userinfo, serverinfo],
  contextMenus: [userinfoMenu],
});
