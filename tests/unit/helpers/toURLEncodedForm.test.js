import { describe, it, expect } from 'vitest';
import toURLEncodedForm from '../../../lib/helpers/toURLEncodedForm.js';
import AxiosError from '../../../lib/core/AxiosError.js';

describe('helpers::toURLEncodedForm', () => {
  it('serializes flat values', () => {
    expect(toURLEncodedForm({ a: 1, b: 'two' }).toString()).toBe('a=1&b=two');
  });

  it('serializes arrays with bracket notation', () => {
    expect(toURLEncodedForm({ b: [1, 2] }).toString()).toBe('b%5B%5D=1&b%5B%5D=2');
  });

  it('serializes nested objects with bracket notation', () => {
    expect(toURLEncodedForm({ a: { b: { c: 1 } } }).toString()).toBe('a%5Bb%5D%5Bc%5D=1');
  });

  it('honors the dots serializer option', () => {
    expect(toURLEncodedForm({ a: { b: 1 } }, { dots: true }).toString()).toBe('a.b=1');
  });

  it('encodes a Buffer value as base64 on node', () => {
    expect(toURLEncodedForm({ f: Buffer.from('hi') }).toString()).toBe('f=aGk%3D');
  });

  it('encodes an empty Buffer as an empty value', () => {
    expect(toURLEncodedForm({ f: Buffer.alloc(0) }).toString()).toBe('f=');
  });

  it('appends a nested Buffer under its leaf key rather than its full path', () => {
    expect(toURLEncodedForm({ a: { f: Buffer.from('hi') } }).toString()).toBe('f=aGk%3D');
  });

  it('serializes a Date as an ISO string', () => {
    expect(toURLEncodedForm({ d: new Date(0) }).toString()).toBe('d=1970-01-01T00%3A00%3A00.000Z');
  });

  it.each([
    ['null values', { a: null }],
    ['undefined values', { a: undefined }],
  ])('skips %s', (description, data) => {
    expect(toURLEncodedForm(data).toString()).toBe('');
  });

  it('produces an empty string for an empty object', () => {
    expect(toURLEncodedForm({}).toString()).toBe('');
  });

  it('percent-encodes reserved characters in keys and values', () => {
    expect(toURLEncodedForm({ 'a&b': 'c=d' }).toString()).toBe('a%26b=c%3Dd');
  });

  it('serializes booleans as their string form', () => {
    expect(toURLEncodedForm({ t: true, f: false }).toString()).toBe('t=true&f=false');
  });

  it('lets a custom visitor override the default serialization', () => {
    const params = toURLEncodedForm(
      { a: 1, secret: 'hidden' },
      {
        visitor(value, key, path, helpers) {
          if (key === 'secret') {
            return false;
          }

          return helpers.defaultVisitor.apply(this, arguments);
        },
      }
    );

    expect(params.toString()).toBe('a=1');
  });

  it('rejects data nested deeper than the depth limit', () => {
    let deep = 'leaf';

    for (let i = 0; i < 120; i++) {
      deep = { nested: deep };
    }

    let error;

    try {
      toURLEncodedForm(deep);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(AxiosError);
    expect(error.code).toBe(AxiosError.ERR_FORM_DATA_DEPTH_EXCEEDED);
  });

  it('does not pollute Object.prototype through a __proto__ key', () => {
    const data = JSON.parse('{"__proto__": {"polluted": "yes"}}');

    toURLEncodedForm(data).toString();

    expect({}.polluted).toBeUndefined();
  });
});
