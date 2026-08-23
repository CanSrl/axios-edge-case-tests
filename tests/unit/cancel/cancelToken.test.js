import { describe, it, expect, vi } from 'vitest';
import CancelToken from '../../../lib/cancel/CancelToken.js';
import CanceledError from '../../../lib/cancel/CanceledError.js';

describe('cancel::CancelToken', () => {
  describe('constructor', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a string', 'cancel'],
      ['an object', {}],
      ['a number', 0],
    ])('throws a TypeError when the executor is %s', (description, executor) => {
      expect(() => new CancelToken(executor)).toThrow(TypeError);
      expect(() => new CancelToken(executor)).toThrow('executor must be a function.');
    });

    it('leaves reason undefined until cancellation is requested', () => {
      const token = new CancelToken(() => {});
      expect(token.reason).toBeUndefined();
      expect(() => token.throwIfRequested()).not.toThrow();
    });
  });

  describe('cancel', () => {
    it('propagates message, config and request to the CanceledError', () => {
      const config = { url: '/foo' };
      const request = { id: 1 };
      const { token, cancel } = CancelToken.source();

      cancel('stop', config, request);

      expect(token.reason).toBeInstanceOf(CanceledError);
      expect(token.reason.message).toBe('stop');
      expect(token.reason.config).toBe(config);
      expect(token.reason.request).toBe(request);
    });

    it('ignores repeated cancellation and keeps the first reason', () => {
      const { token, cancel } = CancelToken.source();

      cancel('first');
      const firstReason = token.reason;
      cancel('second');

      expect(token.reason).toBe(firstReason);
      expect(token.reason.message).toBe('first');
    });

    it('throws the stored reason from throwIfRequested', () => {
      const { token, cancel } = CancelToken.source();

      cancel('aborted');

      expect(() => token.throwIfRequested()).toThrow(CanceledError);
      expect(() => token.throwIfRequested()).toThrow('aborted');
    });
  });

  describe('subscribe', () => {
    it('invokes every listener once and releases them after dispatch', async () => {
      const { token, cancel } = CancelToken.source();
      const first = vi.fn();
      const second = vi.fn();

      token.subscribe(first);
      token.subscribe(second);
      cancel('done');
      await Promise.resolve();

      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
      expect(first.mock.calls[0][0]).toBe(token.reason);
      expect(token._listeners).toBeNull();
    });

    it('invokes a listener synchronously when cancellation already happened', () => {
      const { token, cancel } = CancelToken.source();
      const listener = vi.fn();

      cancel('already');
      token.subscribe(listener);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(token.reason);
    });
  });

  describe('unsubscribe', () => {
    it('is a no-op when no listener was ever registered', () => {
      const token = new CancelToken(() => {});

      expect(() => token.unsubscribe(() => {})).not.toThrow();
      expect(token._listeners).toBeUndefined();
    });

    it('keeps registered listeners when removing an unknown listener', () => {
      const token = new CancelToken(() => {});
      const listener = () => {};

      token.subscribe(listener);
      token.unsubscribe(() => {});

      expect(token._listeners).toEqual([listener]);
    });

    it('removes only the requested listener', async () => {
      const { token, cancel } = CancelToken.source();
      const removed = vi.fn();
      const kept = vi.fn();

      token.subscribe(removed);
      token.subscribe(kept);
      token.unsubscribe(removed);
      cancel();
      await Promise.resolve();

      expect(removed).not.toHaveBeenCalled();
      expect(kept).toHaveBeenCalledTimes(1);
    });
  });

  describe('promise', () => {
    it('resolves the overridden then with the cancellation reason', async () => {
      const { token, cancel } = CancelToken.source();
      const chained = token.promise.then((reason) => reason.message);

      cancel('through-then');

      await expect(chained).resolves.toBe('through-then');
    });

    it('detaches the subscription when the derived promise is cancelled', () => {
      const { token } = CancelToken.source();
      const chained = token.promise.then(() => {});

      expect(token._listeners).toHaveLength(1);
      chained.cancel();

      expect(token._listeners).toHaveLength(0);
    });
  });

  describe('toAbortSignal', () => {
    it('returns a signal that is not aborted before cancellation', () => {
      const { token } = CancelToken.source();
      const signal = token.toAbortSignal();

      expect(signal.aborted).toBe(false);
      expect(typeof signal.unsubscribe).toBe('function');
    });

    it('aborts on a microtask rather than synchronously', async () => {
      const { token, cancel } = CancelToken.source();
      const signal = token.toAbortSignal();

      cancel('signalled');
      expect(signal.aborted).toBe(false);

      await Promise.resolve();

      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBeInstanceOf(CanceledError);
      expect(signal.reason.message).toBe('signalled');
    });

    it('is already aborted when cancellation happened before it was created', () => {
      const { token, cancel } = CancelToken.source();

      cancel('before');
      const signal = token.toAbortSignal();

      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBeInstanceOf(CanceledError);
      expect(signal.reason.message).toBe('before');
    });

    it('detaches its listener through unsubscribe', async () => {
      const { token, cancel } = CancelToken.source();
      const signal = token.toAbortSignal();

      signal.unsubscribe();
      expect(token._listeners).toHaveLength(0);

      cancel('after-unsubscribe');
      await Promise.resolve();

      expect(signal.aborted).toBe(false);
    });

    it('keeps independent signals isolated from one another', async () => {
      const { token, cancel } = CancelToken.source();
      const first = token.toAbortSignal();
      const second = token.toAbortSignal();

      first.unsubscribe();
      cancel('one-left');
      await Promise.resolve();

      expect(first.aborted).toBe(false);
      expect(second.aborted).toBe(true);
    });
  });

  describe('source', () => {
    it('exposes a token and a cancel function bound to it', () => {
      const source = CancelToken.source();

      expect(source.token).toBeInstanceOf(CancelToken);
      expect(typeof source.cancel).toBe('function');
      expect(source.token.reason).toBeUndefined();

      source.cancel();

      expect(source.token.reason).toBeInstanceOf(CanceledError);
      expect(source.token.reason.message).toBe('canceled');
    });
  });
});
