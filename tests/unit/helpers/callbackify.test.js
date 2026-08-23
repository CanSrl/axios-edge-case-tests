import { describe, it, expect, vi } from 'vitest';
import callbackify from '../../../lib/helpers/callbackify.js';

const invoke = (fn, ...args) =>
  new Promise((resolve) => {
    fn(...args, (...result) => resolve(result));
  });

describe('helpers::callbackify', () => {
  it.each([
    ['a plain function', (a, b) => a + b],
    ['a generator function', function* () {}],
    ['an arrow function', () => {}],
  ])('returns %s untouched', (description, fn) => {
    expect(callbackify(fn)).toBe(fn);
  });

  it('adapts an async function to a node-style callback', async () => {
    const wrapped = callbackify(async (value) => value * 2);

    await expect(invoke(wrapped, 21)).resolves.toEqual([null, 42]);
  });

  it('forwards every argument except the callback', async () => {
    const fn = vi.fn(async () => 'ok');
    const wrapped = callbackify(fn);

    await invoke(wrapped, 'a', 'b', 'c');

    expect(fn).toHaveBeenCalledWith('a', 'b', 'c');
  });

  it('preserves the call receiver', async () => {
    const target = {
      value: 'from-this',
      method: callbackify(async function () {
        return this.value;
      }),
    };

    await expect(invoke(target.method.bind(target))).resolves.toEqual([null, 'from-this']);
  });

  it('spreads the reducer output into the callback arguments', async () => {
    const wrapped = callbackify(
      async () => ['1.2.3.4', 4],
      (value) => value
    );

    await expect(invoke(wrapped)).resolves.toEqual([null, '1.2.3.4', 4]);
  });

  it('passes the resolved value to the reducer', async () => {
    const reducer = vi.fn((value) => [value]);
    const wrapped = callbackify(async () => 'resolved', reducer);

    await invoke(wrapped);

    expect(reducer).toHaveBeenCalledWith('resolved');
  });

  it('reports a rejection through the callback error argument', async () => {
    const failure = new Error('rejected');
    const wrapped = callbackify(async () => {
      throw failure;
    });

    await expect(invoke(wrapped)).resolves.toEqual([failure]);
  });

  it('reports a throwing reducer through the callback error argument', async () => {
    const wrapped = callbackify(
      async () => 'value',
      () => {
        throw new Error('reducer exploded');
      }
    );

    const [error, value] = await invoke(wrapped);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('reducer exploded');
    expect(value).toBeUndefined();
  });

  it('does not call the callback twice when the reducer throws', async () => {
    const callback = vi.fn();
    const wrapped = callbackify(
      async () => 'value',
      () => {
        throw new Error('boom');
      }
    );

    wrapped(callback);
    await new Promise((resolve) => setTimeout(resolve));

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('resolves with undefined when the async function returns nothing', async () => {
    const wrapped = callbackify(async () => {});

    await expect(invoke(wrapped)).resolves.toEqual([null, undefined]);
  });

  it('does not treat a promise-returning non-async function as async', () => {
    const fn = () => Promise.resolve('value');

    expect(callbackify(fn)).toBe(fn);
  });
});
