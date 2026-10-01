import {
  ActivityType,
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type PermissionOverwriteOptions,
  type VoiceChannel,
} from 'discord.js';
import type { Bot } from '../../core/bot.js';
import { UserError } from '../../core/errors.js';
import { TempChannelModel, type TempChannelDoc } from './model.js';
import { renderPanel } from './panel.js';
import { channelName, renameWait } from './rules.js';
import type { Hub } from './settings.js';

const creating = new Set<string>();
const lastCreated = new Map<string, number>();

const OWNER_ALLOW: PermissionOverwriteOptions = { ViewChannel: true, Connect: true, Speak: true, Stream: true };

export async function tempChannel(channelId: string): Promise<TempChannelDoc | null> {
  return TempChannelModel.findOne({ channelId }).lean<TempChannelDoc>();
}

function voiceChannel(guild: Guild, id: string): VoiceChannel | null {
  const channel = guild.channels.cache.get(id);
  return channel?.type === ChannelType.GuildVoice ? channel : null;
}

/**
 * Creates a channel for a member who joined a hub and moves them in. A member who already owns
 * a channel is moved back to it instead, so nobody collects several.
 */
export async function createFor(bot: Bot, member: GuildMember, hub: Hub, cooldownSeconds: number): Promise<void> {
  const { guild } = member;
  const key = `${guild.id}:${member.id}`;
  if (creating.has(key)) return;

  const existing = await TempChannelModel.findOne({ guildId: guild.id, ownerId: member.id }).lean<TempChannelDoc>();
  const existingChannel = existing && voiceChannel(guild, existing.channelId);
  if (existingChannel) {
    await member.voice.setChannel(existingChannel).catch(() => undefined);
    return;
  }
  if (Date.now() - (lastCreated.get(key) ?? 0) < cooldownSeconds * 1000) return;

  creating.add(key);
  try {
    const hubChannel = voiceChannel(guild, hub.channelId);
    const parentId = hub.categoryId ?? hubChannel?.parentId ?? null;
    // Presence needs a privileged intent this bot doesn't ask for, so {game} usually falls back
    // to the member's name. Servers that enable GuildPresences get the game.
    const game = member.presence?.activities.find((a) => a.type === ActivityType.Playing)?.name ?? null;
    const count = (await TempChannelModel.countDocuments({ guildId: guild.id, hubId: hub.channelId })) + 1;

    // Created inside the category so it inherits the category's permissions, then the owner gets
    // their own overwrite on top.
    const channel = await guild.channels.create({
      name: channelName(hub.nameTemplate, { user: member.displayName, game, count }),
      type: ChannelType.GuildVoice,
      parent: parentId,
      userLimit: hub.userLimit,
      bitrate: hubChannel?.bitrate,
      reason: `join-to-create for ${member.user.tag}`,
    });
    await channel.permissionOverwrites.edit(member.id, OWNER_ALLOW, { type: OverwriteType.Member });
    await channel.permissionOverwrites.edit(guild.client.user.id, { ViewChannel: true, Connect: true, ManageChannels: true, MoveMembers: true, SendMessages: true });

    await TempChannelModel.create({ guildId: guild.id, channelId: channel.id, ownerId: member.id, hubId: hub.channelId });
    lastCreated.set(key, Date.now());

    try {
      await member.voice.setChannel(channel, 'join-to-create');
    } catch {
      // They left before the move; the channel has no reason to exist.
      await removeChannel(channel.guild, channel.id);
      return;
    }
    await postPanel(bot, channel);
  } finally {
    creating.delete(key);
  }
}

export async function removeChannel(guild: Guild, channelId: string): Promise<void> {
  await TempChannelModel.deleteOne({ channelId });
  await guild.channels.cache.get(channelId)?.delete('join-to-create channel empty').catch(() => undefined);
}

export async function postPanel(bot: Bot, channel: VoiceChannel): Promise<void> {
  const doc = await tempChannel(channel.id);
  if (!doc) return;
  if (doc.panelMessageId) await channel.messages.delete(doc.panelMessageId).catch(() => undefined);
  const message = await channel.send({ ...(await renderPanel(bot, channel, doc)).render(), allowedMentions: { users: [doc.ownerId] } }).catch(() => null);
  if (message) await TempChannelModel.updateOne({ channelId: channel.id }, { panelMessageId: message.id });
}

/** Roles that have an explicit allow for `permission` on the channel, usually inherited from the category. */
function allowingRoles(channel: VoiceChannel, permission: bigint): string[] {
  return channel.permissionOverwrites.cache
    .filter((o) => o.type === OverwriteType.Role && o.id !== channel.guild.id && o.allow.has(permission))
    .map((o) => o.id);
}

async function setAccess(
  channel: VoiceChannel,
  doc: TempChannelDoc,
  permission: 'Connect' | 'ViewChannel',
  restrict: boolean,
): Promise<string[]> {
  const flag = PermissionFlagsBits[permission];
  const everyone = channel.guild.roles.everyone.id;
  const remembered = permission === 'Connect' ? doc.lockedRoles : doc.hiddenRoles;
  if (restrict) {
    const roles = allowingRoles(channel, flag);
    await channel.permissionOverwrites.edit(everyone, { [permission]: false });
    for (const id of roles) await channel.permissionOverwrites.edit(id, { [permission]: false });
    // The owner and everyone already inside keep access, or locking would lock them out too.
    for (const id of new Set([doc.ownerId, ...channel.members.keys()])) {
      if (id !== channel.client.user.id) await channel.permissionOverwrites.edit(id, { [permission]: true }, { type: OverwriteType.Member });
    }
    return roles;
  }
  await channel.permissionOverwrites.edit(everyone, { [permission]: null });
  for (const id of remembered) await channel.permissionOverwrites.edit(id, { [permission]: true });
  return [];
}

export async function setLocked(channel: VoiceChannel, doc: TempChannelDoc, locked: boolean): Promise<void> {
  const roles = await setAccess(channel, doc, 'Connect', locked);
  await TempChannelModel.updateOne({ channelId: channel.id }, { locked, lockedRoles: roles });
}

export async function setHidden(channel: VoiceChannel, doc: TempChannelDoc, hidden: boolean): Promise<void> {
  const roles = await setAccess(channel, doc, 'ViewChannel', hidden);
  await TempChannelModel.updateOne({ channelId: channel.id }, { hidden, hiddenRoles: roles });
}

export async function rename(channel: VoiceChannel, doc: TempChannelDoc, name: string): Promise<void> {
  const now = Date.now();
  const wait = renameWait(doc.renames, now);
  if (wait > 0) throw new UserError('voice.errors.renameLimit', { time: `<t:${Math.ceil((now + wait) / 1000)}:R>` });
  // Discord would otherwise hold the request for up to ten minutes; failing fast is clearer.
  await channel.setName(name.slice(0, 100), 'join-to-create rename');
  await TempChannelModel.updateOne({ channelId: channel.id }, { renames: [...doc.renames.filter((t) => now - t < 600_000), now] });
}

export async function kick(channel: VoiceChannel, doc: TempChannelDoc, target: GuildMember): Promise<void> {
  if (target.id === doc.ownerId) throw new UserError('voice.errors.kickOwner');
  if (target.id === channel.client.user.id) throw new UserError('voice.errors.kickSelf');
  await channel.permissionOverwrites.edit(target.id, { Connect: false }, { type: OverwriteType.Member });
  if (target.voice.channelId === channel.id) await target.voice.disconnect('kicked from join-to-create channel');
}

export async function permit(channel: VoiceChannel, target: GuildMember): Promise<void> {
  await channel.permissionOverwrites.edit(target.id, { ViewChannel: true, Connect: true }, { type: OverwriteType.Member });
}

export async function transfer(channel: VoiceChannel, doc: TempChannelDoc, target: GuildMember): Promise<void> {
  if (target.user.bot) throw new UserError('voice.errors.botOwner');
  if (target.voice.channelId !== channel.id) throw new UserError('voice.errors.notInChannel', { user: target.toString() });
  await channel.permissionOverwrites.edit(target.id, OWNER_ALLOW, { type: OverwriteType.Member });
  await TempChannelModel.updateOne({ channelId: channel.id }, { ownerId: target.id });
}

/** Removes leftovers from before a restart: records of deleted channels and channels left empty. */
export async function cleanUp(bot: Bot): Promise<void> {
  const docs = await TempChannelModel.find().lean<TempChannelDoc[]>();
  let removed = 0;
  for (const doc of docs) {
    const guild = bot.client.guilds.cache.get(doc.guildId);
    if (!guild) continue;
    const channel = voiceChannel(guild, doc.channelId);
    if (!channel || channel.members.size === 0) {
      await removeChannel(guild, doc.channelId);
      removed++;
    }
  }
  if (removed > 0) bot.logger.info({ removed }, 'cleaned up empty join-to-create channels');
}
