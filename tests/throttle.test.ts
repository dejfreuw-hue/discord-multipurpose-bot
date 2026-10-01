import { afterEach, describe, expect, it, vi } from 'vitest';
import { throttler } from '../src/core/throttle.js';

describe('throttler', () => {
  afterEach(() => vi.useRealTimers());

  it('runs once per interval and always catches the last change', async () => {
    vi.useFakeTimers();
    const run = throttler(1000);
    const task = vi.fn(async () => undefined);
    run('k', task);
    run('k', task);
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);

    run('k', task);
    run('k', task);
    await vi.advanceTimersByTimeAsync(500);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('keeps keys independent', async () => {
    vi.useFakeTimers();
    const run = throttler(1000);
    const task = vi.fn(async () => undefined);
    run('a', task);
    run('b', task);
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(2);
  });
});

describe('throttler with slow tasks', () => {
  afterEach(() => vi.useRealTimers());

  it('never overlaps runs and re-runs once for calls made during a run', async () => {
    vi.useFakeTimers();
    const run = throttler(100);
    let active = 0;
    let maxActive = 0;
    const task = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 500));
      active--;
    });
    run('k', task);
    await vi.advanceTimersByTimeAsync(10);
    run('k', task);
    run('k', task);
    await vi.advanceTimersByTimeAsync(2000);
    expect(task).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });
});
