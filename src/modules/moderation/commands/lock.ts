import {
  ChannelType,
  channelMention,
  PermissionFlagsBits,
  SlashCommandBuilder,
  userMention,
  type PermissionOverwriteOptions,
} from 'discord.js';
import type { CommandContext } from '../../../core/context.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand } from '../../../core/module.js';
import { botMember } from '../hierarchy.js';
import { postModLog } from '../modlog.js';
import { readReason } from '../respond.js';

const LOCKABLE = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice, ChannelType.GuildStageVoice] as const;

const LOCKED: PermissionOverwriteOptions = {
  SendMessages: false,
  SendMessagesInThreads: false,
  CreatePublicThreads: false,
  CreatePrivateThreads: false,
};

// Unlocking resets to "inherit" rather than "allow", so category permissions apply again.
const UNLOCKED: PermissionOverwriteOptions = {
  SendMessages: null,
  SendMessagesInThreads: null,
  CreatePublicThreads: null,
  CreatePrivateThreads: null,
};

function build(name: 'lock' | 'unlock') {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(`moderation.${name}.description`)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) => o.setName('channel').setDescription(`moderation.${name}.options.channel`).addChannelTypes(...LOCKABLE))
    .addStringOption((o) => o.setName('reason').setDescription('moderation.options.reason').setMaxLength(400));
}

async function toggle(ctx: CommandContext<true>, lock: boolean): Promise<void> {
  const channel = ctx.interaction.options.getChannel('channel', false, [...LOCKABLE]) ?? ctx.interaction.channel;
  if (!channel || channel.isThread() || !('permissionOverwrites' in channel)) throw new UserError('moderation.lock.unsupported');

  const everyone = ctx.guild.roles.everyone;
  const isLocked = channel.permissionOverwrites.cache.get(everyone.id)?.deny.has(PermissionFlagsBits.SendMessages) ?? false;
  if (lock && isLocked) throw new UserError('moderation.lock.already', { channel: channelMention(channel.id) });
  if (!lock && !isLocked) throw new UserError('moderation.unlock.notLocked', { channel: channelMention(channel.id) });

  const reason = await readReason(ctx);
  const audit = `${ctx.interaction.user.tag}: ${reason ?? (lock ? 'lock' : 'unlock')}`.slice(0, 512);
  if (lock) {
    // Without this the bot locks itself out too and can't post the notice or unlock cleanly.
    await channel.permissionOverwrites.edit(await botMember(ctx.guild), { SendMessages: true }, { reason: audit });
  }
  await channel.permissionOverwrites.edit(everyone, lock ? LOCKED : UNLOCKED, { reason: audit });

  const name = lock ? 'lock' : 'unlock';
  if (channel.isSendable()) {
    const notice = ctx.panel().text(ctx.t(`moderation.${name}.notice`), reason ? ctx.t('moderation.lock.reason', { reason }) : null);
    await channel.send(notice.render()).catch(() => undefined);
  }
  await ctx.respond(ctx.successPanel(ctx.t(`moderation.${name}.done`, { channel: channelMention(channel.id) })));
  await postModLog(
    ctx.bot,
    ctx.guild,
    ctx
      .panel()
      .title(ctx.t(`moderation.${name}.logTitle`))
      .text(
        ctx.t(`moderation.${name}.log`, { channel: channelMention(channel.id), moderator: userMention(ctx.interaction.user.id) }),
        reason ? ctx.t('moderation.lock.reason', { reason }) : null,
      ),
  );
}

const permissions = {
  user: PermissionFlagsBits.ManageChannels,
  bot: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles],
  allowStaff: true,
};

export const lockCommand = defineCommand({
  data: build('lock'),
  permissions,
  run: (ctx) => toggle(ctx, true),
});

export const unlockCommand = defineCommand({
  data: build('unlock'),
  permissions,
  run: (ctx) => toggle(ctx, false),
});
