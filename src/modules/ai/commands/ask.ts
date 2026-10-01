import { SlashCommandBuilder } from 'discord.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand } from '../../../core/module.js';
import { systemPrompt } from '../conversation.js';
import { checkLimits, complete, isBlacklisted, personaFor, providerFor } from '../engine.js';
import { aiSettings } from '../settings.js';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('ai.ask.description')
    .addStringOption((o) => o.setName('question').setDescription('ai.ask.options.question').setRequired(true).setMaxLength(1000)),
  // Rate limits come from the server's AI settings instead.
  cooldown: 0,
  async run(ctx) {
    const settings = await ctx.bot.settings.module(ctx.guild.id, aiSettings);
    if (isBlacklisted(ctx.member, settings)) throw new UserError('ai.errors.blacklisted');
    await checkLimits(ctx.bot, ctx.guild, ctx.member.id, settings);

    const question = ctx.interaction.options.getString('question', true);
    const answer = await complete(ctx.bot, ctx.guild, providerFor(ctx.bot, settings), {
      system: systemPrompt({ persona: personaFor(settings), botName: ctx.bot.config.bot.name, guildName: ctx.guild.name }),
      messages: [{ role: 'user', content: `${ctx.member.displayName}: ${question}` }],
    });
    await ctx.respond(ctx.panel().text(`-# ${question.replace(/\n/g, ' ').slice(0, 200)}`, answer.slice(0, 3800)));
  },
});
