import {
  ButtonBuilder,
  ButtonStyle,
  OAuth2Scopes,
  PermissionFlagsBits,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  version as discordJsVersion,
} from 'discord.js';
import { defineCommand } from '../../../core/module.js';

// What the bot needs across all modules. Asking for Administrator would be simpler, but
// server owners are rightly wary of bots that do.
const INVITE_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.UseExternalEmojis,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ViewAuditLog,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.MoveMembers,
];

export default defineCommand({
  scope: 'anywhere',
  data: new SlashCommandBuilder().setName('botinfo').setDescription('core.botinfo.description'),
  defer: 'public',
  async run(ctx) {
    const { bot } = ctx;
    const client = bot.client;
    const users = client.guilds.cache.reduce((sum, guild) => sum + guild.memberCount, 0);
    const memory = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const commandCount = bot.commands.size;

    const invite = client.generateInvite({
      scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
      permissions: INVITE_PERMISSIONS,
    });
    const links = [new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(ctx.t('core.botinfo.invite')).setURL(invite)];
    if (bot.config.bot.supportServer) {
      links.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(ctx.t('core.botinfo.support')).setURL(bot.config.bot.supportServer));
    }
    if (bot.config.bot.website) {
      links.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(ctx.t('core.botinfo.website')).setURL(bot.config.bot.website));
    }

    const panel = ctx
      .panel()
      .title(bot.config.bot.name)
      .thumbnail(ctx.interaction.client.user.displayAvatarURL({ size: 256 }))
      .text(ctx.t('core.botinfo.intro', { name: bot.config.bot.name }))
      .fields([
        { name: ctx.t('core.botinfo.servers'), value: client.guilds.cache.size.toLocaleString(ctx.locale), inline: true },
        { name: ctx.t('core.botinfo.users'), value: users.toLocaleString(ctx.locale), inline: true },
        { name: ctx.t('core.botinfo.commands'), value: String(commandCount), inline: true },
        { name: ctx.t('core.botinfo.uptime'), value: time(new Date(bot.startedAt), TimestampStyles.RelativeTime), inline: true },
        { name: ctx.t('core.botinfo.memory'), value: `${memory} MB`, inline: true },
        { name: ctx.t('core.botinfo.latency'), value: `${client.ws.ping} ms`, inline: true },
        {
          name: ctx.t('core.botinfo.versions'),
          value: `${bot.config.bot.name} v${bot.version} · discord.js v${discordJsVersion} · Node ${process.version}`,
        },
        { name: ctx.t('core.botinfo.modules'), value: bot.modules.map((m) => ctx.t(`modules.${m.name}.name`)).join(', ') },
      ])
      .footer(ctx.t('core.botinfo.footer'))
      .row(...links);

    await ctx.respond(panel);
  },
});
