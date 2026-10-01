import type { CommandContext } from '../../core/context.js';
import { parseDuration } from '../../core/duration.js';
import { UserError } from '../../core/errors.js';
import type { Vars } from '../../core/i18n.js';
import type { Panel } from '../../core/ui/panel.js';
import type { ActionResult } from './actions.js';
import { moderationSettings } from './settings.js';

/** Reads the "reason" option, enforcing the server's "require a reason" setting. */
export async function readReason(ctx: CommandContext<true>): Promise<string | null> {
  const reason = ctx.interaction.options.getString('reason')?.trim() || null;
  if (!reason) {
    const { requireReason } = await ctx.bot.settings.module(ctx.guild.id, moderationSettings);
    if (requireReason) throw new UserError('moderation.errors.reasonRequired');
  }
  return reason;
}

export function readDuration(ctx: CommandContext<true>, option: string, required: true): number;
export function readDuration(ctx: CommandContext<true>, option: string, required?: false): number | null;
export function readDuration(ctx: CommandContext<true>, option: string, required = false): number | null {
  const raw = ctx.interaction.options.getString(option, required);
  if (!raw) return null;
  const ms = parseDuration(raw);
  if (ms === null) throw new UserError('moderation.errors.badDuration', { value: raw });
  return ms;
}

export function confirmation(ctx: CommandContext<true>, result: ActionResult, key: string, vars: Vars): Panel {
  const panel = ctx.successPanel(ctx.t(key, { ...vars, case: result.entry.caseId }));
  if (result.dmSent === false) panel.text(`-# ${ctx.t('moderation.dmFailed')}`);
  return panel;
}
