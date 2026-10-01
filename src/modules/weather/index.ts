import { SlashCommandBuilder, type AutocompleteInteraction } from 'discord.js';
import { UserError } from '../../core/errors.js';
import { defineCommand, defineModule } from '../../core/module.js';
import { conditionKey, decodePlace, encodePlace, fetchForecast, searchPlaces, type Units } from './open-meteo.js';

// Countries that use Fahrenheit; everyone else gets metric unless they ask.
const IMPERIAL_LOCALES = new Set(['en-US']);

function languageOf(locale: string): string {
  return locale.split('-')[0] ?? 'en';
}

async function placeAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const typed = interaction.options.getFocused().trim();
  if (typed.length < 2) return interaction.respond([]);
  const places = await searchPlaces(typed, languageOf(interaction.locale)).catch(() => []);
  await interaction.respond(
    places.slice(0, 25).map((p) => ({ name: (p.detail ? `${p.name}, ${p.detail}` : p.name).slice(0, 100), value: encodePlace(p) })),
  );
}

const weather = defineCommand({
  scope: 'anywhere',
  data: new SlashCommandBuilder()
    .setName('weather')
    .setDescription('weather.command.description')
    .addStringOption((o) =>
      o.setName('place').setDescription('weather.command.options.place').setRequired(true).setMaxLength(100).setAutocomplete(true),
    )
    .addStringOption((o) =>
      o
        .setName('units')
        .setDescription('weather.command.options.units')
        .addChoices({ name: 'weather.units.metric', value: 'metric' }, { name: 'weather.units.imperial', value: 'imperial' }),
    ),
  defer: 'public',
  cooldown: 5,
  autocomplete: placeAutocomplete,
  async run(ctx) {
    const { options } = ctx.interaction;
    const input = options.getString('place', true);
    const units = (options.getString('units') ?? (IMPERIAL_LOCALES.has(ctx.interaction.locale) ? 'imperial' : 'metric')) as Units;

    // Picking from autocomplete gives exact coordinates; typed text falls back to the best match.
    let place = decodePlace(input);
    if (!place) {
      const found = (await searchPlaces(input, languageOf(ctx.interaction.locale), 8000))[0];
      if (!found) throw new UserError('weather.errors.notFound', { place: input.slice(0, 100) });
      place = { ...found, label: found.detail ? `${found.name}, ${found.detail}` : found.name };
    }
    const forecast = await fetchForecast(place, units);

    const tempUnit = units === 'imperial' ? '°F' : '°C';
    const windUnit = units === 'imperial' ? 'mph' : 'km/h';
    const round = (n: number) => Math.round(n);
    const { current } = forecast;
    const dayName = new Intl.DateTimeFormat(ctx.locale, { weekday: 'long', timeZone: 'UTC' });
    const days = forecast.days.map((d, i) => {
      const name = i === 0 ? ctx.t('weather.today') : dayName.format(new Date(`${d.date}T12:00:00Z`));
      const rain = d.rainChance === null ? '' : `, ${ctx.t('weather.rainChance', { percent: d.rainChance })}`;
      return `**${name}**: ${ctx.t(conditionKey(d.code))}, ${round(d.min)}-${round(d.max)}${tempUnit}${rain}`;
    });

    await ctx.respond(
      ctx
        .panel()
        .title(ctx.t('weather.title', { place: place.label }))
        .text(`## ${round(current.temperature)}${tempUnit}  ${ctx.t(conditionKey(current.code))}`)
        .fields([
          { name: ctx.t('weather.feelsLike'), value: `${round(current.feelsLike)}${tempUnit}`, inline: true },
          { name: ctx.t('weather.humidity'), value: `${round(current.humidity)}%`, inline: true },
          { name: ctx.t('weather.wind'), value: `${round(current.wind)} ${windUnit}`, inline: true },
          { name: ctx.t('weather.forecast'), value: days.join('\n') },
        ])
        .footer(ctx.t('weather.source')),
    );
  },
});

export default defineModule({
  name: 'weather',
  toggleable: true,
  commands: [weather],
});
