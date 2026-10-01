import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, type GuildMember, type TextChannel } from 'discord.js';
import type { Bot } from '../../core/bot.js';
import { UserError } from '../../core/errors.js';
import { defineComponent } from '../../core/module.js';
import { claimTicket, closeTicket, findTicket, isTicketStaff, setLocked } from './lifecycle.js';
import type { TicketDoc } from './models.js';

/** The open ticket in `channel`, checking that `member` may act on it. */
export async function ticketFor(bot: Bot, channel: unknown, member: GuildMember, need: 'staff' | 'owner-or-staff'): Promise<{ ticket: TicketDoc; channel: TextChannel }> {
  const text = channel as TextChannel | null;
  const ticket = text ? await findTicket(text.id) : null;
  if (!text || !ticket) throw new UserError('tickets.errors.notTicket');
  const staff = await isTicketStaff(bot, member, ticket);
  if (!staff && !(need === 'owner-or-staff' && member.id === ticket.ownerId && ticket.kind === 'ticket')) {
    throw new UserError('tickets.errors.staffOnly');
  }
  return { ticket, channel: text };
}

export function closeModal(t: (key: string) => string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('ticket:close')
    .setTitle(t('tickets.close.modalTitle'))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(t('tickets.close.reasonLabel'))
        .setTextInputComponent(new TextInputBuilder().setCustomId('reason').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)),
    );
}

export const controlComponents = [
  defineComponent({
    kind: 'button',
    id: 'ticket:claim',
    async run(ctx) {
      const { ticket, channel } = await ticketFor(ctx.bot, ctx.interaction.channel, ctx.member, 'staff');
      await claimTicket(ctx.bot, channel, ticket, ctx.member);
    },
  }),
  defineComponent({
    kind: 'button',
    id: 'ticket:lock',
    async run(ctx) {
      const { ticket, channel } = await ticketFor(ctx.bot, ctx.interaction.channel, ctx.member, 'staff');
      await setLocked(ctx.bot, channel, ticket, !ticket.locked);
    },
  }),
  defineComponent({
    kind: 'button',
    id: 'ticket:close',
    defer: false,
    async run(ctx) {
      await ticketFor(ctx.bot, ctx.interaction.channel, ctx.member, 'owner-or-staff');
      await ctx.interaction.showModal(closeModal((key) => ctx.t(key)));
    },
  }),
  defineComponent({
    kind: 'modal',
    id: 'ticket:close',
    defer: 'ephemeral',
    async run(ctx) {
      const { ticket, channel } = await ticketFor(ctx.bot, ctx.interaction.channel, ctx.member, 'owner-or-staff');
      const reason = ctx.interaction.fields.getTextInputValue('reason').trim() || null;
      await ctx.respond(ctx.successPanel(ctx.t('tickets.close.started')));
      await closeTicket(ctx.bot, channel, ticket, ctx.interaction.user, reason);
    },
  }),
];
