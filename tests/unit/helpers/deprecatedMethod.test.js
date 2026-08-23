import { afterEach, describe, expect, it, vi } from 'vitest';
import deprecatedMethod from '../../../lib/helpers/deprecatedMethod.js';

describe('helpers::deprecatedMethod', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns about the deprecated method', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    deprecatedMethod('oldMethod');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'DEPRECATED method `oldMethod`. This method will be removed in a future release.'
    );
  });

  it('names the replacement when one is provided', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    deprecatedMethod('oldMethod', 'newMethod');

    expect(warn).toHaveBeenCalledWith(
      'DEPRECATED method `oldMethod`. Use `newMethod` instead. This method will be removed in a future release.'
    );
  });

  it('emits a second warning for the docs link', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    deprecatedMethod('oldMethod', 'newMethod', 'https://example.com/docs');

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith(
      'For more information about usage see https://example.com/docs'
    );
  });

  it('omits the replacement clause without omitting the docs link', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    deprecatedMethod('oldMethod', undefined, 'https://example.com/docs');

    expect(warn).toHaveBeenNthCalledWith(
      1,
      'DEPRECATED method `oldMethod`. This method will be removed in a future release.'
    );
    expect(warn).toHaveBeenNthCalledWith(
      2,
      'For more information about usage see https://example.com/docs'
    );
  });

  it.each([
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('treats %s as no replacement', (description, instead) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    deprecatedMethod('oldMethod', instead);

    expect(warn).toHaveBeenCalledWith(
      'DEPRECATED method `oldMethod`. This method will be removed in a future release.'
    );
  });

  it.each([
    ['an empty string', ''],
    ['null', null],
  ])('does not emit a docs warning when docs is %s', (description, docs) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    deprecatedMethod('oldMethod', 'newMethod', docs);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('swallows a console.warn that throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {
      throw new Error('console unavailable');
    });

    expect(() => deprecatedMethod('oldMethod', 'newMethod', 'https://example.com')).not.toThrow();
  });

  it('returns undefined', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(deprecatedMethod('oldMethod')).toBeUndefined();
  });
});
