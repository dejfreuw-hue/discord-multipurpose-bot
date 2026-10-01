import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConfigError } from '../src/config/errors.js';
import { loadConfig } from '../src/config/load.js';
import { defineModule } from '../src/core/module.js';
import { fromRoot } from '../src/core/paths.js';
import { modules } from '../src/modules/index.js';

function write(yaml: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'cfg-')), 'config.yml');
  writeFileSync(file, yaml);
  return file;
}

function errorOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return (err as Error).message;
  }
  throw new Error('expected a ConfigError');
}

const extra = defineModule({
  name: 'extra',
  toggleable: true,
  config: z.object({ limit: z.number().int().default(5) }),
});

describe('loadConfig', () => {
  it('accepts the shipped config.yml', () => {
    const config = loadConfig(modules, fromRoot('config.yml'));
    expect(config.bot.color).toBe(0x5865f2);
    expect(config.moduleSettings.has('core')).toBe(true);
  });

  it('fills defaults for a minimal file', () => {
    const config = loadConfig([extra], write('bot:\n  name: Test\n'));
    expect(config.commands.defaultCooldown).toBe(3);
    expect(config.moduleSettings.get('extra')).toEqual({ limit: 5, enabled: true });
  });

  it('names the exact path of a bad value', () => {
    const message = errorOf(() => loadConfig([], write('bot:\n  name: Test\n  color: blue\n')));
    expect(message).toContain('bot.color');
    expect(message).toContain('hex colour');
  });

  it('points out typos as unknown settings', () => {
    const message = errorOf(() => loadConfig([], write('bot:\n  name: Test\n  colour: "#ffffff"\n')));
    expect(message).toContain('unknown setting "colour"');
  });

  it('reports broken YAML with a line number', () => {
    const message = errorOf(() => loadConfig([], write('bot:\n  name: "Test\n')));
    expect(message).toMatch(/not valid YAML/);
  });

  it('rejects settings for modules that do not exist', () => {
    const message = errorOf(() => loadConfig([extra], write('bot:\n  name: Test\nmodules:\n  musik:\n    enabled: true\n')));
    expect(message).toContain('musik');
    expect(message).toContain('extra');
  });

  it('validates module sections with the module schema', () => {
    const message = errorOf(() => loadConfig([extra], write('bot:\n  name: Test\nmodules:\n  extra:\n    limit: lots\n')));
    expect(message).toContain('modules.extra.limit');
  });

  it('leaves globally disabled modules out', () => {
    const config = loadConfig([extra], write('bot:\n  name: Test\nmodules:\n  extra:\n    enabled: false\n'));
    expect(config.moduleSettings.has('extra')).toBe(false);
  });

  it('does not allow disabling a core module', () => {
    const core = defineModule({ name: 'base', toggleable: false });
    const message = errorOf(() => loadConfig([core], write('bot:\n  name: Test\nmodules:\n  base:\n    enabled: false\n')));
    expect(message).toContain('enabled');
  });
});
