import { SlashCommandBuilder } from 'discord.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand } from '../../../core/module.js';
import { cleanTitle } from '../format.js';
import { playerFor } from '../lavalink.js';
import { currentLyrics, findLyrics } from '../lyrics.js';

const MAX_LENGTH = 3800;

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('music.lyrics.description')
    .addStringOption((o) => o.setName('song').setDescription('music.lyrics.options.song').setMaxLength(200)),
  cooldown: 5,
  async run(ctx) {
    const query = ctx.interaction.options.getString('song');
    let lyrics;
    if (query) {
      lyrics = await findLyrics(query);
    } else {
      const player = playerFor(ctx.guild.id);
      const track = player?.queue.current;
      if (!player || !track) throw new UserError('music.lyrics.nothing');
      lyrics = await currentLyrics(player, track);
    }
    if (!lyrics) throw new UserError('music.lyrics.notFound');

    const text = lyrics.text.length > MAX_LENGTH ? `${lyrics.text.slice(0, MAX_LENGTH)}\n...` : lyrics.text;
    await ctx.respond(
      ctx
        .panel()
        .title(cleanTitle(`${lyrics.title} - ${lyrics.artist}`, 200))
        .text(text)
        .footer(ctx.t('music.lyrics.source', { source: lyrics.source })),
    );
  },
});
