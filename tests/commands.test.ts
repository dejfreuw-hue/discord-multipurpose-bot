import { ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { buildCommands } from '../src/core/command-sync.js';
import { I18n } from '../src/core/i18n.js';
import { fromRoot } from '../src/core/paths.js';
import { modules } from '../src/modules/index.js';

describe('buildCommands', () => {
  const i18n = I18n.fromDirectory(fromRoot('locales'), 'en');
  const commands = buildCommands(modules, i18n);

  it('translates description keys', () => {
    for (const command of commands) {
      expect(command.description).not.toMatch(/^[a-z]+\.[\w.]+$/);
      expect(command.description.length).toBeLessThanOrEqual(100);
    }
  });

  it('makes only "anywhere" commands user-installable', () => {
    const botinfo = commands.find((c) => c.name === 'botinfo')!;
    const setup = commands.find((c) => c.name === 'setup')!;
    expect(botinfo.integration_types).toContain(ApplicationIntegrationType.UserInstall);
    expect(botinfo.contexts).toContain(InteractionContextType.BotDM);
    expect(setup.integration_types).toEqual([ApplicationIntegrationType.GuildInstall]);
    expect(setup.contexts).toEqual([InteractionContextType.Guild]);
  });

  it('has unique command names', () => {
    const names = commands.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
