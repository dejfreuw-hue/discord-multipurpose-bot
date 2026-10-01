import { SlashCommandBuilder } from 'discord.js';
import { databasePing } from '../../../core/database.js';
import { defineCommand } from '../../../core/module.js';

export default defineCommand({
  data: new SlashCommandBuilder().setName('ping').setDescription('core.ping.description'),
  // Replies itself so the round trip can be measured from a real message.
  defer: false,
  async run(ctx) {
    const { interaction, bot } = ctx;
    const response = await interaction.reply({ ...ctx.panel().text(ctx.t('core.ping.measuring')).render(), withResponse: true });
    const roundTrip = (response.resource?.message?.createdTimestamp ?? Date.now()) - interaction.createdTimestamp;
    const database = await databasePing().catch(() => -1);

    const ms = (value: number) => (value < 0 ? ctx.t('common.unavailable') : `${value} ms`);
    await ctx.respond(
      ctx
        .panel()
        .title(ctx.t('core.ping.title'))
        .fields([
          { name: ctx.t('core.ping.gateway'), value: ms(bot.client.ws.ping), inline: true },
          { name: ctx.t('core.ping.roundTrip'), value: ms(roundTrip), inline: true },
          { name: ctx.t('core.ping.database'), value: ms(database), inline: true },
        ]),
    );
  },
});
