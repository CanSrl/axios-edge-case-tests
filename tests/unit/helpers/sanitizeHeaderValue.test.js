import { describe, it, expect } from 'vitest';
import {
  sanitizeHeaderValue,
  sanitizeByteStringHeaderValue,
  toByteStringHeaderObject,
} from '../../../lib/helpers/sanitizeHeaderValue.js';
import AxiosHeaders from '../../../lib/core/AxiosHeaders.js';

describe('helpers::sanitizeHeaderValue', () => {
  describe('sanitizeHeaderValue', () => {
    it.each([
      ['CRLF', 'a\r\nb', 'ab'],
      ['a bare CR', 'a\rb', 'ab'],
      ['a bare LF', 'a\nb', 'ab'],
      ['NUL', 'a\u0000b', 'ab'],
      ['DEL', 'a\u007fb', 'ab'],
      ['a vertical tab', 'a\u000bb', 'ab'],
      ['a run of control characters', 'a\r\n\u0000\u001fb', 'ab'],
      ['an injected header line', 'x\r\nX-Injected: 1', 'xX-Injected: 1'],
    ])('strips %s', (description, input, expected) => {
      expect(sanitizeHeaderValue(input)).toBe(expected);
    });

    it('preserves horizontal tabs inside the value', () => {
      expect(sanitizeHeaderValue('a\tb')).toBe('a\tb');
    });

    it('trims leading and trailing spaces and tabs only', () => {
      expect(sanitizeHeaderValue('  \t value \t ')).toBe('value');
      expect(sanitizeHeaderValue('   ')).toBe('');
    });

    it('returns the original string when nothing needs trimming', () => {
      const value = 'application/json';
      expect(sanitizeHeaderValue(value)).toBe(value);
    });

    it('preserves non-latin1 characters', () => {
      expect(sanitizeHeaderValue('café ☕')).toBe('café ☕');
    });

    it.each([
      ['a number', 123, '123'],
      ['null', null, 'null'],
      ['undefined', undefined, 'undefined'],
      ['a boolean', false, 'false'],
    ])('coerces %s to a string', (description, input, expected) => {
      expect(sanitizeHeaderValue(input)).toBe(expected);
    });

    it('sanitizes each entry of an array', () => {
      expect(sanitizeHeaderValue(['a\r\nb', ' c ', 'd'])).toEqual(['ab', 'c', 'd']);
    });

    it('sanitizes nested arrays recursively', () => {
      expect(sanitizeHeaderValue([['a\r\nb']])).toEqual([['ab']]);
    });

    it('returns an empty array unchanged', () => {
      expect(sanitizeHeaderValue([])).toEqual([]);
    });

    it('handles an empty string', () => {
      expect(sanitizeHeaderValue('')).toBe('');
    });
  });

  describe('sanitizeByteStringHeaderValue', () => {
    it('drops characters outside the latin1 range', () => {
      expect(sanitizeByteStringHeaderValue('café ☕')).toBe('café');
      expect(sanitizeByteStringHeaderValue('ÿĀ')).toBe('ÿ');
    });

    it('keeps horizontal tabs but strips other control characters', () => {
      expect(sanitizeByteStringHeaderValue('a\tb')).toBe('a\tb');
      expect(sanitizeByteStringHeaderValue('a\r\n\u0000b')).toBe('ab');
      expect(sanitizeByteStringHeaderValue('a\u007fb')).toBe('ab');
    });

    it('sanitizes each entry of an array', () => {
      expect(sanitizeByteStringHeaderValue(['a☕', 'b\r\nc'])).toEqual(['a', 'bc']);
    });
  });

  describe('toByteStringHeaderObject', () => {
    it('returns a null-prototype object', () => {
      const result = toByteStringHeaderObject(new AxiosHeaders({ 'X-Foo': 'bar' }));

      expect(Object.getPrototypeOf(result)).toBeNull();
    });

    it('sanitizes header values to latin1 byte strings', () => {
      const headers = new AxiosHeaders({ 'X-Unicode': 'a\u2028b☕' });

      expect(toByteStringHeaderObject(headers)['X-Unicode']).toBe('ab');
    });

    it('preserves array header values', () => {
      const headers = new AxiosHeaders();
      headers.set('Set-Cookie', ['a=1', 'b=2']);

      expect(toByteStringHeaderObject(headers)['Set-Cookie']).toEqual(['a=1', 'b=2']);
    });

    it('produces an empty object for empty headers', () => {
      expect(toByteStringHeaderObject(new AxiosHeaders())).toEqual({});
    });

    it('does not expose inherited keys through the returned object', () => {
      const headers = new AxiosHeaders({ 'X-Foo': 'bar' });
      const result = toByteStringHeaderObject(headers);

      expect(result.toString).toBeUndefined();
      expect(result.constructor).toBeUndefined();
    });
  });
});
