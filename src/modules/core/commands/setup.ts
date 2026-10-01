import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../../core/module.js';
import { renderWizard } from '../setup/wizard.js';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('core.setup.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  defer: 'ephemeral',
  cooldown: 5,
  permissions: { user: PermissionFlagsBits.ManageGuild },
  async run(ctx) {
    await ctx.respond(await renderWizard(ctx));
  },
});
