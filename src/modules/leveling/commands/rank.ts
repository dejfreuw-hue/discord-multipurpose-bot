import { SlashCommandBuilder } from 'discord.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand } from '../../../core/module.js';
import { rankCard } from '../render.js';

export default defineCommand({
  scope: 'anywhere',
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('leveling.rank.description')
    .addUserOption((o) => o.setName('user').setDescription('leveling.rank.options.user')),
  defer: 'public',
  async run(ctx) {
    const user = ctx.interaction.options.getUser('user') ?? ctx.interaction.user;
    if (user.bot) throw new UserError('leveling.errors.bot');
    const { file, global } = await rankCard(ctx.bot, user, ctx.guild, ctx.locale);
    await ctx.interaction.editReply({ content: global ? `-# ${ctx.t('leveling.rank.global')}` : '', files: [file] });
  },
});
