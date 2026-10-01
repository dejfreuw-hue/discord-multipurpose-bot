import {
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  time,
  TimestampStyles,
  type GuildMember,
} from 'discord.js';
import type { Bot } from '../../../core/bot.js';
import type { ComponentContext } from '../../../core/context.js';
import { UserError } from '../../../core/errors.js';
import { defineComponent } from '../../../core/module.js';
import { applyRoles } from '../roles/logic.js';
import { codeMatches, generateCode, renderCaptcha } from './captcha.js';
import { verificationSettings, type VerificationSettings } from './settings.js';

const CAPTCHA_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const DAY = 86_400_000;

const pending = new Map<string, { code: string; attempts: number; expires: number }>();

export function panelFor(bot: Bot, t: (key: string) => string, color: number) {
  return bot
    .panel(color)
    .title(t('verification.panel.title'))
    .text(t('verification.panel.body'))
    .row(new ButtonBuilder().setCustomId('verify:start').setStyle(ButtonStyle.Success).setLabel(t('verification.panel.button')));
}

function isVerified(member: GuildMember, s: VerificationSettings): boolean {
  if (s.verifiedRoleId) return member.roles.cache.has(s.verifiedRoleId);
  return Boolean(s.unverifiedRoleId && !member.roles.cache.has(s.unverifiedRoleId));
}

async function complete(member: GuildMember, s: VerificationSettings): Promise<void> {
  const add = s.verifiedRoleId ? [s.verifiedRoleId] : [];
  const remove = s.unverifiedRoleId ? [s.unverifiedRoleId] : [];
  const applied = await applyRoles(member, { add, remove }, 'verified');
  if (applied.add.length !== add.length || applied.remove.length !== remove.length) throw new UserError('verification.errors.roles');
}

async function sendCaptcha(ctx: ComponentContext, key: string): Promise<void> {
  const code = generateCode();
  pending.set(key, { code, attempts: pending.get(key)?.attempts ?? 0, expires: Date.now() + CAPTCHA_MS });
  if (pending.size > 5000) for (const [k, p] of pending) if (p.expires < Date.now()) pending.delete(k);

  const file = new AttachmentBuilder(renderCaptcha(code), { name: 'captcha.png' });
  const panel = ctx
    .panel()
    .text(ctx.t('verification.captcha.prompt', { time: time(new Date(Date.now() + CAPTCHA_MS), TimestampStyles.RelativeTime) }))
    .image('attachment://captcha.png')
    .row(new ButtonBuilder().setCustomId('verify:code').setStyle(ButtonStyle.Primary).setLabel(ctx.t('verification.captcha.enter')));
  await ctx.interaction.editReply({ ...panel.render(), files: [file] });
}

export const verifyComponents = [
  defineComponent({
    kind: 'button',
    id: 'verify:start',
    defer: 'ephemeral',
    async run(ctx) {
      const s = await ctx.bot.settings.module(ctx.guild.id, verificationSettings);
      if (!s.verifiedRoleId && !s.unverifiedRoleId) throw new UserError('verification.errors.notSetUp');
      if (isVerified(ctx.member, s)) throw new UserError('verification.errors.already');
      const age = Date.now() - ctx.member.user.createdTimestamp;
      if (s.minAccountDays > 0 && age < s.minAccountDays * DAY) {
        throw new UserError('verification.errors.tooNew', { time: time(new Date(ctx.member.user.createdTimestamp + s.minAccountDays * DAY), TimestampStyles.RelativeTime) });
      }
      if (s.mode === 'captcha') {
        await sendCaptcha(ctx, `${ctx.guild.id}:${ctx.member.id}`);
        return;
      }
      await complete(ctx.member, s);
      await ctx.respond(ctx.successPanel(ctx.t('verification.done')));
    },
  }),
  defineComponent({
    kind: 'button',
    id: 'verify:code',
    defer: false,
    async run(ctx) {
      const entry = pending.get(`${ctx.guild.id}:${ctx.member.id}`);
      if (!entry || entry.expires < Date.now()) throw new UserError('verification.errors.expired');
      await ctx.interaction.showModal(
        new ModalBuilder()
          .setCustomId('verify:submit')
          .setTitle(ctx.t('verification.captcha.title'))
          .addLabelComponents(
            new LabelBuilder()
              .setLabel(ctx.t('verification.captcha.label'))
              .setTextInputComponent(new TextInputBuilder().setCustomId('code').setStyle(TextInputStyle.Short).setMinLength(4).setMaxLength(12)),
          ),
      );
    },
  }),
  defineComponent({
    kind: 'modal',
    id: 'verify:submit',
    async run(ctx) {
      const key = `${ctx.guild.id}:${ctx.member.id}`;
      const entry = pending.get(key);
      if (!entry || entry.expires < Date.now()) throw new UserError('verification.errors.expired');
      const s = await ctx.bot.settings.module(ctx.guild.id, verificationSettings);

      if (codeMatches(entry.code, ctx.interaction.fields.getTextInputValue('code'))) {
        pending.delete(key);
        await complete(ctx.member, s);
        await ctx.interaction.editReply({ ...ctx.successPanel(ctx.t('verification.done')).render(), attachments: [] });
        return;
      }
      entry.attempts++;
      if (entry.attempts >= MAX_ATTEMPTS) {
        pending.delete(key);
        throw new UserError('verification.errors.tooManyAttempts');
      }
      // A wrong answer gets a fresh image; retrying the same one would make guessing easy.
      await sendCaptcha(ctx, key);
      await ctx.whisper(ctx.errorPanel(ctx.t('verification.errors.wrong', { left: MAX_ATTEMPTS - entry.attempts, count: MAX_ATTEMPTS - entry.attempts })));
    },
  }),
];
