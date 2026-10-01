import type { Module } from '../core/module.js';
import ai from './ai/index.js';
import automod from './automod/index.js';
import birthdays from './community/birthdays/index.js';
import counting from './community/counting/index.js';
import giveaways from './community/giveaways/index.js';
import roles from './community/roles/index.js';
import serverstats from './community/serverstats/index.js';
import starboard from './community/starboard/index.js';
import sticky from './community/sticky/index.js';
import suggestions from './community/suggestions/index.js';
import verification from './community/verification/index.js';
import welcome from './community/welcome/index.js';
import core from './core/index.js';
import economy from './economy/index.js';
import leveling from './leveling/index.js';
import moderation from './moderation/index.js';
import music from './music/index.js';
import tickets from './tickets/index.js';
import voice from './voice/index.js';

/**
 * Every module the bot knows about, in load order. To remove a module completely, delete its
 * line here and its folder. To just turn it off, use config.yml instead.
 */
export const modules: Module[] = [core, moderation, automod, ai, tickets, leveling, economy, music, voice, welcome, roles, verification, giveaways, suggestions, counting, starboard, sticky, birthdays, serverstats];
