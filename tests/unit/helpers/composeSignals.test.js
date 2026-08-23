import { describe, it, expect, vi } from 'vitest';
import composeSignals from '../../../lib/helpers/composeSignals.js';
import AxiosError from '../../../lib/core/AxiosError.js';
import CanceledError from '../../../lib/cancel/CanceledError.js';

describe('helpers::composeSignals', () => {
  it('registers abort listeners as once-only listeners', () => {
    const controller = new AbortController();
    const calls = [];
    const nativeAdd = controller.signal.addEventListener.bind(controller.signal);

    controller.signal.addEventListener = (type, fn, options) => {
      calls.push({ type, options });
      return nativeAdd(type, fn, options);
    };

    const signal = composeSignals([controller.signal]);

    try {
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ type: 'abort', options: { once: true } });
    } finally {
      signal.unsubscribe();
    }
  });
});

describe('helpers::composeSignals options', () => {
  it.each([
    ['an empty array', []],
    ['only falsy entries', [null, undefined, false]],
    ['null', null],
    ['undefined', undefined],
  ])('returns undefined for %s without a timeout', (description, signals) => {
    expect(composeSignals(signals, 0)).toBeUndefined();
  });

  it('returns a signal when a timeout is given without any source signal', () => {
    const signal = composeSignals([], 1000);

    try {
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
    } finally {
      signal.unsubscribe();
    }
  });

  it('returns a signal when a source signal is given without a timeout', () => {
    const controller = new AbortController();
    const signal = composeSignals([controller.signal], 0);

    try {
      expect(signal).toBeInstanceOf(AbortSignal);
    } finally {
      signal.unsubscribe();
    }
  });

  it('ignores falsy entries alongside a real signal', () => {
    const controller = new AbortController();
    const signal = composeSignals([null, controller.signal, undefined]);

    try {
      controller.abort();
      expect(signal.aborted).toBe(true);
    } finally {
      signal.unsubscribe();
    }
  });
});

describe('helpers::composeSignals abort reasons', () => {
  it('preserves an AxiosError abort reason by identity', () => {
    const controller = new AbortController();
    const reason = new AxiosError('upstream failed', AxiosError.ERR_NETWORK);

    controller.abort(reason);
    const signal = composeSignals([controller.signal]);

    try {
      expect(signal.reason).toBe(reason);
    } finally {
      signal.unsubscribe();
    }
  });

  it('wraps a plain Error reason in a CanceledError', () => {
    const controller = new AbortController();

    controller.abort(new Error('plain failure'));
    const signal = composeSignals([controller.signal]);

    try {
      expect(signal.reason).toBeInstanceOf(CanceledError);
      expect(signal.reason.message).toBe('plain failure');
    } finally {
      signal.unsubscribe();
    }
  });

  it('uses a non-Error reason as the CanceledError message', () => {
    const controller = new AbortController();

    controller.abort('string reason');
    const signal = composeSignals([controller.signal]);

    try {
      expect(signal.reason).toBeInstanceOf(CanceledError);
      expect(signal.reason.message).toBe('string reason');
    } finally {
      signal.unsubscribe();
    }
  });

  it('keeps the first abort reason when several signals abort', async () => {
    const first = new AbortController();
    const second = new AbortController();
    const signal = composeSignals([first.signal, second.signal]);

    try {
      first.abort(new Error('first'));
      second.abort(new Error('second'));

      expect(signal.reason.message).toBe('first');
    } finally {
      signal.unsubscribe();
    }
  });

  it('aborts with ETIMEDOUT when the timeout elapses', async () => {
    const signal = composeSignals([], 10);

    await new Promise((resolve) => signal.addEventListener('abort', resolve));

    expect(signal.reason).toBeInstanceOf(AxiosError);
    expect(signal.reason.code).toBe(AxiosError.ETIMEDOUT);
    expect(signal.reason.message).toBe('timeout of 10ms exceeded');
  });
});

describe('helpers::composeSignals unsubscribe', () => {
  it('clears the pending timeout so no abort is raised afterwards', async () => {
    const signal = composeSignals([], 10);

    signal.unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(signal.aborted).toBe(false);
  });

  it('is safe to call more than once', async () => {
    const controller = new AbortController();
    const signal = composeSignals([controller.signal], 10);

    signal.unsubscribe();
    signal.unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(signal.aborted).toBe(false);
  });

  it('detaches source signal listeners', async () => {
    const controller = new AbortController();
    const signal = composeSignals([controller.signal]);

    signal.unsubscribe();
    await new Promise((resolve) => setTimeout(resolve));
    controller.abort();

    expect(signal.aborted).toBe(false);
  });

  it('uses a signal own unsubscribe hook when it exposes one', async () => {
    const controller = new AbortController();
    const unsubscribe = vi.fn();

    controller.signal.unsubscribe = unsubscribe;

    const signal = composeSignals([controller.signal]);

    signal.unsubscribe();
    await new Promise((resolve) => setTimeout(resolve));

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(typeof unsubscribe.mock.calls[0][0]).toBe('function');
  });

  it('detaches listeners automatically once an abort has been handled', async () => {
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
    const signal = composeSignals([controller.signal]);

    controller.abort();

    expect(signal.aborted).toBe(true);
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));

    removeEventListener.mockRestore();
  });
});
