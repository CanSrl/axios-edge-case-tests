import { describe, it, expect } from 'vitest';
import setFormDataHeaders from '../../../lib/core/setFormDataHeaders.js';
import AxiosHeaders from '../../../lib/core/AxiosHeaders.js';

const formHeaders = () => ({
  'content-type': 'multipart/form-data; boundary=abc',
  'content-length': '42',
  'x-custom': 'leaked',
});

describe('core::setFormDataHeaders', () => {
  describe("policy 'content-only'", () => {
    it('copies only the content headers', () => {
      const headers = new AxiosHeaders();

      setFormDataHeaders(headers, formHeaders(), 'content-only');

      expect(headers.toJSON()).toEqual({
        'content-type': 'multipart/form-data; boundary=abc',
        'content-length': '42',
      });
    });

    it('matches the content headers case-insensitively', () => {
      const headers = new AxiosHeaders();

      setFormDataHeaders(
        headers,
        { 'Content-Type': 'ct', 'CONTENT-LENGTH': '1', 'X-Other': 'no' },
        'content-only'
      );

      expect(headers.getContentType()).toBe('ct');
      expect(headers.get('content-length')).toBe('1');
      expect(headers.has('x-other')).toBe(false);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
    ])('leaves the headers untouched when formHeaders is %s', (description, value) => {
      const headers = new AxiosHeaders();

      setFormDataHeaders(headers, value, 'content-only');

      expect(headers.toJSON()).toEqual({});
    });

    it('leaves the headers untouched for an empty formHeaders object', () => {
      const headers = new AxiosHeaders();

      setFormDataHeaders(headers, {}, 'content-only');

      expect(headers.toJSON()).toEqual({});
    });

    it('overwrites an existing content-type', () => {
      const headers = new AxiosHeaders({ 'Content-Type': 'application/json' });

      setFormDataHeaders(headers, { 'content-type': 'multipart/form-data' }, 'content-only');

      expect(headers.getContentType()).toBe('multipart/form-data');
    });

    it('preserves unrelated headers already present', () => {
      const headers = new AxiosHeaders({ Accept: 'application/json' });

      setFormDataHeaders(headers, formHeaders(), 'content-only');

      expect(headers.get('Accept')).toBe('application/json');
    });

    it('does not copy prototype-shaped keys as content headers', () => {
      const headers = new AxiosHeaders();

      setFormDataHeaders(
        headers,
        { __proto__: 'polluted', constructor: 'polluted' },
        'content-only'
      );

      expect(headers.toJSON()).toEqual({});
      expect({}.polluted).toBeUndefined();
    });
  });

  describe('other policies', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['an unrelated value', 'merge'],
      ['an empty string', ''],
    ])('merges every form header when the policy is %s', (description, policy) => {
      const headers = new AxiosHeaders();

      setFormDataHeaders(headers, formHeaders(), policy);

      expect(headers.get('x-custom')).toBe('leaked');
      expect(headers.getContentType()).toBe('multipart/form-data; boundary=abc');
      expect(headers.get('content-length')).toBe('42');
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
    ])('does not throw when formHeaders is %s', (description, value) => {
      const headers = new AxiosHeaders();

      expect(() => setFormDataHeaders(headers, value, undefined)).not.toThrow();
      expect(headers.toJSON()).toEqual({});
    });
  });
});
