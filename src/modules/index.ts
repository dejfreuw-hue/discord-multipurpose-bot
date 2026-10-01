import type { Module } from '../core/module.js';
import core from './core/index.js';
import moderation from './moderation/index.js';

/**
 * Every module the bot knows about, in load order. To remove a module completely, delete its
 * line here and its folder. To just turn it off, use config.yml instead.
 */
export const modules: Module[] = [core, moderation];
