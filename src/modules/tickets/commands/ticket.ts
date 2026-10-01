import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../../core/module.js';
import { ticketFor } from '../controls.js';
import { claimTicket, closeTicket, setLocked, setParticipant } from '../lifecycle.js';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('tickets.ticket.description')
    .addSubcommand((s) =>
      s
        .setName('close')
        .setDescription('tickets.ticket.close')
        .addStringOption((o) => o.setName('reason').setDescription('tickets.ticket.options.reason').setMaxLength(500)),
    )
    .addSubcommand((s) => s.setName('claim').setDescription('tickets.ticket.claim'))
    .addSubcommand((s) => s.setName('lock').setDescription('tickets.ticket.lock'))
    .addSubcommand((s) => s.setName('unlock').setDescription('tickets.ticket.unlock'))
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('tickets.ticket.add')
        .addUserOption((o) => o.setName('user').setDescription('moderation.options.member').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('tickets.ticket.remove')
        .addUserOption((o) => o.setName('user').setDescription('moderation.options.member').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('rename')
        .setDescription('tickets.ticket.rename')
        .addStringOption((o) => o.setName('name').setDescription('tickets.ticket.options.name').setRequired(true).setMaxLength(90)),
    ),
  defer: 'ephemeral',
  async run(ctx) {
    const { options } = ctx.interaction;
    const sub = options.getSubcommand();
    const { ticket, channel } = await ticketFor(ctx.bot, ctx.interaction.channel, ctx.member, sub === 'close' ? 'owner-or-staff' : 'staff');

    switch (sub) {
      case 'close':
        await ctx.respond(ctx.successPanel(ctx.t('tickets.close.started')));
        await closeTicket(ctx.bot, channel, ticket, ctx.interaction.user, options.getString('reason'));
        return;
      case 'claim': {
        const result = await claimTicket(ctx.bot, channel, ticket, ctx.member);
        await ctx.respond(ctx.successPanel(ctx.t(`tickets.claim.${result}Self`)));
        return;
      }
      case 'lock':
      case 'unlock':
        await setLocked(ctx.bot, channel, ticket, sub === 'lock');
        await ctx.respond(ctx.successPanel(ctx.t(`tickets.lock.${sub}ed`)));
        return;
      case 'add':
      case 'remove': {
        const user = options.getUser('user', true);
        await setParticipant(channel, ticket, user, sub === 'add');
        await ctx.respond(ctx.successPanel(ctx.t(`tickets.participants.${sub === 'add' ? 'added' : 'removed'}`, { user: user.toString() })));
        return;
      }
      case 'rename': {
        await channel.setName(options.getString('name', true), `renamed by ${ctx.interaction.user.tag}`);
        await ctx.respond(ctx.successPanel(ctx.t('tickets.ticket.renamed', { channel: channel.toString() })));
        return;
      }
    }
  },
});
