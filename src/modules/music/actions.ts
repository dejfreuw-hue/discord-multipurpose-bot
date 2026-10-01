import type { Player, RepeatMode } from 'lavalink-client';
import { UserError } from '../../core/errors.js';
import { endSession, saveSession } from './lavalink.js';

const LOOP_ORDER: RepeatMode[] = ['off', 'track', 'queue'];

export async function pause(player: Player): Promise<void> {
  if (player.paused) throw new UserError('music.errors.alreadyPaused');
  await player.pause();
  await saveSession(player);
}

export async function resume(player: Player): Promise<void> {
  if (!player.paused) throw new UserError('music.errors.notPaused');
  await player.resume();
  await saveSession(player);
}

export async function skip(player: Player, to = 0): Promise<void> {
  if (!player.queue.current) throw new UserError('music.errors.nothingPlaying');
  if (to > player.queue.tracks.length) throw new UserError('music.errors.badPosition', { max: player.queue.tracks.length });
  // Skipping the last track would throw in lavalink-client; stopping is what people expect.
  if (player.queue.tracks.length === 0) await player.stopPlaying(false, false);
  else await player.skip(to > 0 ? to : undefined);
}

export async function previous(player: Player): Promise<void> {
  const last = await player.queue.shiftPrevious();
  if (!last) throw new UserError('music.errors.noPrevious');
  await player.play({ clientTrack: last });
}

export async function stop(player: Player): Promise<void> {
  await endSession(player.guildId, 'stopped');
}

export async function cycleLoop(player: Player): Promise<RepeatMode> {
  const next = LOOP_ORDER[(LOOP_ORDER.indexOf(player.repeatMode) + 1) % LOOP_ORDER.length]!;
  await player.setRepeatMode(next);
  await saveSession(player);
  return next;
}

export async function shuffle(player: Player): Promise<void> {
  if (player.queue.tracks.length < 2) throw new UserError('music.errors.tooFewToShuffle');
  await player.queue.shuffle();
}

export async function changeVolume(player: Player, volume: number): Promise<number> {
  const value = Math.min(150, Math.max(0, Math.round(volume)));
  await player.setVolume(value);
  await saveSession(player);
  return value;
}
