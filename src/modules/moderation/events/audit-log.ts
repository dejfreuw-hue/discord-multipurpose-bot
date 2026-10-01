import { AuditLogEvent, Events } from 'discord.js';
import { defineEvent } from '../../../core/module.js';
import { createCase } from '../cases.js';
import { CaseModel, type CaseType } from '../models/case.js';
import { moderationSettings } from '../settings.js';

// Bans, kicks and timeouts done through Discord's own menus (or other bots) still get a case,
// so the history stays complete. Our own actions are skipped; they already created theirs.
export default defineEvent({
  name: Events.GuildAuditLogEntryCreate,
  async run(bot, entry, guild) {
    if (!entry.targetId || !entry.executorId || entry.executorId === bot.client.user?.id) return;

    let type: CaseType;
    let duration: number | null = null;
    switch (entry.action) {
      case AuditLogEvent.MemberBanAdd:
        type = 'ban';
        break;
      case AuditLogEvent.MemberBanRemove:
        type = 'unban';
        break;
      case AuditLogEvent.MemberKick:
        type = 'kick';
        break;
      case AuditLogEvent.MemberUpdate: {
        const change = entry.changes.find((c) => c.key === 'communication_disabled_until');
        if (!change) return;
        if (typeof change.new === 'string') {
          type = 'timeout';
          duration = Math.round((Date.parse(change.new) - Date.now()) / 1000) * 1000;
          if (duration <= 0) return;
        } else {
          type = 'untimeout';
        }
        break;
      }
      default:
        return;
    }

    const settings = await bot.settings.get(guild.id);
    if (!bot.isEnabled('moderation', settings)) return;
    if (!(await bot.settings.module(guild.id, moderationSettings)).logExternal) return;

    if (type === 'unban') {
      await CaseModel.updateMany({ guildId: guild.id, userId: entry.targetId, type: 'ban', active: true }, { active: false });
    }
    const [user, moderator] = await Promise.all([bot.client.users.fetch(entry.targetId), bot.client.users.fetch(entry.executorId)]);
    await createCase(bot, guild, { type, user, moderator, reason: entry.reason ?? null, duration, source: 'external' });
  },
});
