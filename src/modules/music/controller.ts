import { UserError } from '../../core/errors.js';
import { defineComponent } from '../../core/module.js';
import { changeVolume, cycleLoop, pause, previous, resume, shuffle, skip, stop } from './actions.js';
import { queuePanel } from './commands/queue.js';
import { activePlayer, assertControl } from './control.js';
import { nowPlayingPanel } from './nowplaying.js';

const VOLUME_STEP = 10;

/** The buttons under the now-playing message. */
export const controller = defineComponent({
  kind: 'button',
  id: 'music:ctl',
  async run(ctx, [action]) {
    const player = activePlayer(ctx);
    if (action === 'queue') {
      await ctx.whisper(queuePanel(ctx, player, 0));
      return;
    }
    await assertControl(ctx, player);

    switch (action) {
      case 'pause':
        await pause(player);
        break;
      case 'resume':
        await resume(player);
        break;
      case 'skip':
        await skip(player);
        // A new now-playing message follows from trackStart; this one can stay as it is.
        return;
      case 'previous':
        await previous(player);
        return;
      case 'stop':
        await stop(player);
        await ctx.update(ctx.panel().text(ctx.t('music.stop.byUser', { user: ctx.member.toString() })));
        return;
      case 'loop':
        await cycleLoop(player);
        break;
      case 'shuffle':
        await shuffle(player);
        break;
      case 'voldown':
        await changeVolume(player, player.volume - VOLUME_STEP);
        break;
      case 'volup':
        await changeVolume(player, player.volume + VOLUME_STEP);
        break;
      default:
        throw new UserError('errors.expired');
    }
    await ctx.update(nowPlayingPanel(ctx.bot, player, (k, v) => ctx.t(k, v), ctx.color));
  },
});
