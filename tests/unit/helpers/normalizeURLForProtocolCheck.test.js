import { describe, it, expect } from 'vitest';
import normalizeURLForProtocolCheck from '../../../lib/helpers/normalizeURLForProtocolCheck.js';
import parseProtocol from '../../../lib/helpers/parseProtocol.js';

describe('helpers::normalizeURLForProtocolCheck', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', { toString: () => 'http://example.com' }],
    ['an array', ['http://example.com']],
  ])('returns %s unchanged', (description, input) => {
    expect(normalizeURLForProtocolCheck(input)).toBe(input);
  });

  it('returns an empty string unchanged', () => {
    expect(normalizeURLForProtocolCheck('')).toBe('');
  });

  it.each([
    ['a leading space', ' http://example.com'],
    ['leading tabs', '\t\thttp://example.com'],
    ['a leading newline', '\nhttp://example.com'],
    ['a leading carriage return', '\rhttp://example.com'],
    ['a leading NUL', '\u0000http://example.com'],
    ['a leading unit separator', '\u001fhttp://example.com'],
    ['mixed leading control characters', ' \u0000\u001f\t http://example.com'],
  ])('trims %s', (description, input) => {
    expect(normalizeURLForProtocolCheck(input)).toBe('http://example.com');
  });

  it.each([
    ['tabs', 'ht\ttp://example.com'],
    ['newlines', 'ht\ntp://example.com'],
    ['carriage returns', 'ht\rtp://example.com'],
    ['all three interleaved', 'h\tt\nt\rp://example.com'],
  ])('removes interior %s', (description, input) => {
    expect(normalizeURLForProtocolCheck(input)).toBe('http://example.com');
  });

  it('preserves interior spaces', () => {
    expect(normalizeURLForProtocolCheck('a b')).toBe('a b');
  });

  it('does not trim characters above 0x20', () => {
    expect(normalizeURLForProtocolCheck('!http://example.com')).toBe('!http://example.com');
  });

  it('returns the input untouched when there is nothing to normalize', () => {
    expect(normalizeURLForProtocolCheck('http://example.com')).toBe('http://example.com');
  });

  it('trims a string made only of control characters to empty', () => {
    expect(normalizeURLForProtocolCheck(' \t\r\n\u0000')).toBe('');
  });

  describe('protocol detection after normalization', () => {
    it.each([
      ['a leading space', ' javascript:alert(1)'],
      ['an interior newline', 'java\nscript:alert(1)'],
      ['an interior tab', 'java\tscript:alert(1)'],
      ['a leading NUL and interior CR', '\u0000java\rscript:alert(1)'],
    ])('exposes the real scheme hidden by %s', (description, input) => {
      expect(parseProtocol(normalizeURLForProtocolCheck(input))).toBe('javascript');
    });

    it('does not report a protocol for the raw obfuscated form', () => {
      expect(parseProtocol('java\nscript:alert(1)')).not.toBe('javascript');
    });
  });
});
