import { SlashCommandBuilder } from 'discord.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand } from '../../../core/module.js';
import { ticketFor } from '../controls.js';
import { closeTicket, isTicketStaff } from '../lifecycle.js';
import { openThread } from '../modmail.js';
import { ticketSettings } from '../settings.js';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('modmail')
    .setDescription('tickets.modmail.description')
    .addSubcommand((s) =>
      s
        .setName('open')
        .setDescription('tickets.modmail.open')
        .addUserOption((o) => o.setName('user').setDescription('moderation.options.member').setRequired(true))
        .addStringOption((o) => o.setName('message').setDescription('tickets.modmail.options.message').setMaxLength(1500)),
    )
    .addSubcommand((s) =>
      s
        .setName('close')
        .setDescription('tickets.modmail.close')
        .addStringOption((o) => o.setName('reason').setDescription('tickets.ticket.options.reason').setMaxLength(500)),
    )
    .addSubcommand((s) =>
      s
        .setName('block')
        .setDescription('tickets.modmail.block')
        .addUserOption((o) => o.setName('user').setDescription('moderation.options.user').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('unblock')
        .setDescription('tickets.modmail.unblock')
        .addUserOption((o) => o.setName('user').setDescription('moderation.options.user').setRequired(true)),
    ),
  defer: 'ephemeral',
  async run(ctx) {
    const { options } = ctx.interaction;
    const sub = options.getSubcommand();

    if (sub === 'close') {
      const { ticket, channel } = await ticketFor(ctx.bot, ctx.interaction.channel, ctx.member, 'staff');
      if (ticket.kind !== 'modmail') throw new UserError('tickets.modmail.notThread');
      await ctx.respond(ctx.successPanel(ctx.t('tickets.close.started')));
      await closeTicket(ctx.bot, channel, ticket, ctx.interaction.user, options.getString('reason'));
      return;
    }

    if (!(await isTicketStaff(ctx.bot, ctx.member))) throw new UserError('tickets.errors.staffOnly');
    const user = options.getUser('user', true);

    if (sub === 'open') {
      if (user.bot) throw new UserError('tickets.modmail.botUser');
      const { channel, created } = await openThread(ctx.bot, ctx.guild, user, ctx.interaction.user);
      const text = options.getString('message');
      if (text) {
        const delivered = await user
          .send({ content: `**${ctx.member.displayName}** (${ctx.guild.name}): ${text}`, allowedMentions: { parse: [] } })
          .then(() => true, () => false);
        await channel.send({ content: `**${ctx.member.displayName}:** ${text}`, allowedMentions: { parse: [] } });
        if (!delivered) throw new UserError('tickets.modmail.undelivered');
      }
      await ctx.respond(ctx.successPanel(ctx.t(created ? 'tickets.modmail.opened' : 'tickets.modmail.existing', { channel: channel.toString() })));
      return;
    }

    const settings = await ctx.bot.settings.module(ctx.guild.id, ticketSettings);
    const blocked = settings.modmail.blocked.filter((id) => id !== user.id);
    if (sub === 'block') blocked.push(user.id);
    await ctx.bot.settings.updateModule(ctx.guild.id, ticketSettings, { modmail: { ...settings.modmail, blocked } });
    await ctx.respond(ctx.successPanel(ctx.t(`tickets.modmail.${sub}ed`, { user: user.toString() })));
  },
});
