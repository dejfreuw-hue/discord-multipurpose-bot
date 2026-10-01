import { ApplicationCommandType, ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { buildCommands } from '../src/core/command-sync.js';
import { I18n } from '../src/core/i18n.js';
import { fromRoot } from '../src/core/paths.js';
import { modules } from '../src/modules/index.js';

describe('buildCommands', () => {
  const i18n = I18n.fromDirectory(fromRoot('locales'), 'en');
  const commands = buildCommands(modules, i18n);

  it('translates every description and choice name within Discord limits', () => {
    const texts: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (typeof obj.description === 'string') texts.push(obj.description);
      if (typeof obj.name === 'string' && 'value' in obj) texts.push(obj.name);
      Object.values(obj).forEach(walk);
    };
    walk(commands);
    expect(texts.length).toBeGreaterThan(commands.length);
    for (const text of texts) {
      expect(text).not.toMatch(/^[a-z]+\.[\w.]+$/);
      expect(text.length).toBeGreaterThan(0);
      expect(text.length).toBeLessThanOrEqual(100);
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

  it('stays under the Discord limit of 100 global commands', () => {
    expect(commands.filter((c) => !c.type || c.type === ApplicationCommandType.ChatInput).length).toBeLessThanOrEqual(100);
  });

  it('registers context menus with translated names, at most five of each type', () => {
    const menus = commands.filter((c) => c.type === ApplicationCommandType.User || c.type === ApplicationCommandType.Message);
    expect(menus.map((m) => m.name)).toContain('User info');
    for (const type of [ApplicationCommandType.User, ApplicationCommandType.Message]) {
      expect(menus.filter((m) => m.type === type).length).toBeLessThanOrEqual(5);
    }
    for (const menu of menus) {
      expect(menu.name).not.toMatch(/^[a-z]+\.[\w.]+$/);
      expect(menu.name.length).toBeLessThanOrEqual(32);
    }
  });

  it('has unique command names', () => {
    const names = commands.map((c) => `${c.type ?? ApplicationCommandType.ChatInput}:${c.name}`);
    expect(new Set(names).size).toBe(names.length);
  });
});
