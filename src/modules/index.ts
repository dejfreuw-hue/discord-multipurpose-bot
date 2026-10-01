import type { Module } from '../core/module.js';
import ai from './ai/index.js';
import automod from './automod/index.js';
import core from './core/index.js';
import leveling from './leveling/index.js';
import moderation from './moderation/index.js';
import tickets from './tickets/index.js';

/**
 * Every module the bot knows about, in load order. To remove a module completely, delete its
 * line here and its folder. To just turn it off, use config.yml instead.
 */
export const modules: Module[] = [core, moderation, automod, ai, tickets, leveling];
