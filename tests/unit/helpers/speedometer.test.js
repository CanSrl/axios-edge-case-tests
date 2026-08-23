import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import speedometer from '../../../lib/helpers/speedometer.js';

describe('helpers::speedometer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const advance = (ms) => vi.setSystemTime(Date.now() + ms);

  it('returns undefined for the first sample', () => {
    const push = speedometer(10, 1000);

    expect(push(100)).toBeUndefined();
  });

  it('stays undefined until the minimum window has elapsed', () => {
    const push = speedometer(10, 1000);

    push(100);
    advance(500);
    expect(push(100)).toBeUndefined();
    advance(499);
    expect(push(100)).toBeUndefined();
  });

  it('reports a rate once the minimum window has elapsed', () => {
    const push = speedometer(10, 1000);

    push(1000);
    advance(1000);

    expect(push(1000)).toBe(1000);
  });

  it('treats a zero minimum window as always reporting', () => {
    const push = speedometer(10, 0);

    push(100);
    advance(1000);

    expect(push(100)).toBe(100);
  });

  it('returns undefined when no time has passed since the oldest sample', () => {
    const push = speedometer(2, 0);

    expect(push(10)).toBeUndefined();
    expect(push(10)).toBeUndefined();
  });

  it('defaults to 10 samples when samplesCount is omitted', () => {
    const push = speedometer();

    push(1000);
    advance(1000);

    expect(push(1000)).toBe(1000);
  });

  it.each([
    ['undefined', undefined],
    ['0', 0],
    ['null', null],
  ])('falls back to the default sample count when samplesCount is %s', (description, value) => {
    const push = speedometer(value, 0);

    push(1);
    advance(1000);

    expect(push(1)).toBe(1);
  });

  it('defaults the minimum window to 1000ms when it is omitted', () => {
    const push = speedometer(10);

    push(100);
    advance(999);
    expect(push(100)).toBeUndefined();
    advance(1);
    expect(push(100)).toBe(200);
  });

  it('drops the oldest sample once the ring buffer wraps', () => {
    const push = speedometer(3, 0);

    push(1000);
    advance(1000);
    push(10);
    advance(1000);

    expect(push(10)).toBe(505);

    advance(1000);

    expect(push(10)).toBe(10);
  });

  it('keeps reporting a stable rate for a steady stream', () => {
    const push = speedometer(4, 0);

    push(50);
    advance(1000);
    push(50);
    advance(1000);
    push(50);
    advance(1000);

    const beforeWrap = push(50);
    advance(1000);
    const afterWrap = push(50);

    expect(beforeWrap).toBe(50);
    expect(afterWrap).toBe(50);
  });

  it('reports a zero rate for zero-length chunks', () => {
    const push = speedometer(3, 0);

    push(0);
    advance(1000);

    expect(push(0)).toBe(0);
  });
});
