import { channelMention, PermissionFlagsBits, SlashCommandBuilder, userMention, type Message } from 'discord.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand } from '../../../core/module.js';
import { postModLog } from '../modlog.js';

const BULK_DELETE_MAX_AGE = 14 * 24 * 60 * 60 * 1000;
const LINK = /https?:\/\/\S+/i;

const filters: Record<string, (m: Message) => boolean> = {
  bots: (m) => m.author.bot,
  humans: (m) => !m.author.bot,
  links: (m) => LINK.test(m.content),
  attachments: (m) => m.attachments.size > 0,
  embeds: (m) => m.embeds.length > 0,
};

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('moderation.purge.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) => o.setName('amount').setDescription('moderation.purge.options.amount').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((o) => o.setName('user').setDescription('moderation.purge.options.user'))
    .addStringOption((o) =>
      o
        .setName('filter')
        .setDescription('moderation.purge.options.filter')
        .addChoices(
          { name: 'moderation.purge.filters.bots', value: 'bots' },
          { name: 'moderation.purge.filters.humans', value: 'humans' },
          { name: 'moderation.purge.filters.links', value: 'links' },
          { name: 'moderation.purge.filters.attachments', value: 'attachments' },
          { name: 'moderation.purge.filters.embeds', value: 'embeds' },
        ),
    ),
  defer: 'ephemeral',
  cooldown: 5,
  permissions: {
    user: PermissionFlagsBits.ManageMessages,
    bot: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory],
    allowStaff: true,
  },
  async run(ctx) {
    const { interaction } = ctx;
    const channel = interaction.channel;
    if (!channel || !('bulkDelete' in channel)) throw new UserError('moderation.purge.unsupported');

    const amount = interaction.options.getInteger('amount', true);
    const user = interaction.options.getUser('user');
    const filter = filters[interaction.options.getString('filter') ?? ''];
    const cutoff = Date.now() - BULK_DELETE_MAX_AGE;

    // Discord only bulk-deletes messages younger than 14 days, and only 100 per call, so we
    // scan the latest 100 and pick from those.
    const recent = await channel.messages.fetch({ limit: 100 });
    const targets = [...recent.values()]
      .filter((m) => !m.pinned && m.createdTimestamp > cutoff)
      .filter((m) => !user || m.author.id === user.id)
      .filter((m) => !filter || filter(m))
      .slice(0, amount);
    if (targets.length === 0) throw new UserError('moderation.purge.nothing');

    const deleted = await channel.bulkDelete(targets, true);
    await ctx.respond(ctx.successPanel(ctx.t('moderation.purge.done', { count: deleted.size })));

    await postModLog(
      ctx.bot,
      ctx.guild,
      ctx
        .panel()
        .title(ctx.t('moderation.purge.logTitle'))
        .text(
          ctx.t('moderation.purge.log', {
            count: deleted.size,
            channel: channelMention(channel.id),
            moderator: userMention(interaction.user.id),
          }),
          user ? ctx.t('moderation.purge.logUser', { user: userMention(user.id) }) : null,
        ),
    );
  },
});
