import { PermissionFlagsBits, type GuildMember, type VoiceBasedChannel } from 'discord.js';
import type { Player } from 'lavalink-client';
import type { InteractionContext } from '../../core/context.js';
import { UserError } from '../../core/errors.js';
import { isStaff } from '../../core/permissions.js';
import { canControl } from './format.js';
import { playerFor } from './lavalink.js';
import { requesterOf } from './nowplaying.js';
import { musicSettings } from './settings.js';

type GuildCtx = InteractionContext & { member: GuildMember };

/** The member's voice channel, refusing if the bot is busy in a different one. */
export function memberChannel(ctx: GuildCtx): VoiceBasedChannel {
  const channel = ctx.member.voice.channel;
  if (!channel) throw new UserError('music.errors.notInVoice');
  const player = playerFor(ctx.member.guild.id);
  if (player?.voiceChannelId && player.voiceChannelId !== channel.id) {
    throw new UserError('music.errors.otherChannel', { channel: `<#${player.voiceChannelId}>` });
  }
  return channel;
}

export function assertCanJoin(channel: VoiceBasedChannel): void {
  const me = channel.guild.members.me;
  const perms = me && channel.permissionsFor(me);
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
    throw new UserError('music.errors.cantJoin', { channel: channel.toString() });
  }
  if (channel.full && !perms.has(PermissionFlagsBits.MoveMembers)) throw new UserError('music.errors.channelFull');
}

/** The active player in the member's channel, or a friendly error. */
export function activePlayer(ctx: GuildCtx): Player {
  memberChannel(ctx);
  const player = playerFor(ctx.member.guild.id);
  if (!player) throw new UserError('music.errors.nothingPlaying');
  return player;
}

/** Applies the DJ rules: see canControl in format.ts. */
export async function assertControl(ctx: GuildCtx, player: Player): Promise<void> {
  const settings = await ctx.bot.settings.module(ctx.member.guild.id, musicSettings);
  const core = await ctx.bot.settings.get(ctx.member.guild.id);
  const channel = ctx.member.voice.channel;
  const allowed = canControl({
    isStaff: ctx.member.permissions.has(PermissionFlagsBits.ManageGuild) || isStaff(ctx.member, core.staffRoles),
    isDj: settings.djRoles.some((id) => ctx.member.roles.cache.has(id)),
    djRolesSet: settings.djRoles.length > 0,
    isRequester: requesterOf(player.queue.current)?.id === ctx.member.id,
    listeners: channel ? channel.members.filter((m) => !m.user.bot).size : 0,
  });
  if (!allowed) throw new UserError('music.errors.djOnly');
}
