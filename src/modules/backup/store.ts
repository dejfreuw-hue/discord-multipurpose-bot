import type { Guild } from 'discord.js';
import type { Bot } from '../../core/bot.js';
import { BackupModel, newBackupId, type BackupDoc } from './model.js';
import { backupConfig, backupSettings } from './settings.js';
import { takeSnapshot } from './snapshot.js';

export async function createBackup(guild: Guild, userId: string, name: string, automatic: boolean): Promise<BackupDoc> {
  const snapshot = takeSnapshot(guild);
  const doc = await BackupModel.create({
    backupId: newBackupId(),
    guildId: guild.id,
    guildName: guild.name,
    name,
    createdBy: userId,
    automatic,
    roleCount: snapshot.roles.filter((r) => !r.everyone && !r.managed).length,
    channelCount: snapshot.channels.length,
    snapshot,
  });
  return doc.toObject();
}

/** Backups a user may see and restore here: this server's, plus ones they made on other servers. */
export function accessibleBackups(guildId: string, userId: string) {
  return { $or: [{ guildId }, { createdBy: userId }] };
}

async function runAutoBackups(bot: Bot): Promise<void> {
  const { autoIntervalHours, autoKeep } = bot.moduleConfig({ name: 'backup', config: backupConfig });
  const cutoff = new Date(Date.now() - autoIntervalHours * 3_600_000);
  for (const guild of bot.client.guilds.cache.values()) {
    if (bot.stopping) return;
    if (!bot.isEnabled('backup', await bot.settings.get(guild.id))) continue;
    if (!(await bot.settings.module(guild.id, backupSettings)).auto) continue;
    if (await BackupModel.exists({ guildId: guild.id, automatic: true, createdAt: { $gt: cutoff } })) continue;

    await createBackup(guild, bot.client.user!.id, 'Automatic', true);
    const old = await BackupModel.find({ guildId: guild.id, automatic: true }, { _id: 1 }).sort({ createdAt: -1 }).skip(autoKeep).lean();
    if (old.length) await BackupModel.deleteMany({ _id: { $in: old.map((o) => o._id) } });
  }
}

/** Checks hourly for servers due an automatic backup; returns a function that stops it. */
export function startAutoBackups(bot: Bot): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    await runAutoBackups(bot).catch((err: unknown) => bot.logger.warn({ err }, 'automatic backup failed'));
    running = false;
  };
  const timer = setInterval(() => void tick(), 3_600_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
