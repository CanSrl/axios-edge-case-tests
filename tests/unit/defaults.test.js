import { describe, it, expect } from 'vitest';
import stream from 'stream';
import defaults from '../../lib/defaults/index.js';
import transitionalDefaults from '../../lib/defaults/transitional.js';
import AxiosHeaders from '../../lib/core/AxiosHeaders.js';
import AxiosError from '../../lib/core/AxiosError.js';

const transformRequest = (data, rawHeaders, context) => {
  const headers = new AxiosHeaders(rawHeaders);
  const result = defaults.transformRequest[0].call(context || {}, data, headers);

  return { result, headers };
};

const transformResponse = (data, context) =>
  defaults.transformResponse[0].call(context || {}, data);

describe('defaults::transitional', () => {
  it('exposes the documented transitional flags', () => {
    expect(transitionalDefaults).toEqual({
      silentJSONParsing: true,
      forcedJSONParsing: true,
      clarifyTimeoutError: false,
      legacyInterceptorReqResOrdering: true,
      advertiseZstdAcceptEncoding: false,
      validateStatusUndefinedResolves: true,
    });
  });

  it('is the object exposed on defaults', () => {
    expect(defaults.transitional).toBe(transitionalDefaults);
  });
});

describe('defaults::transformRequest', () => {
  it('serializes a plain object to JSON and sets the content type', () => {
    const { result, headers } = transformRequest({ a: 1 }, {});

    expect(result).toBe('{"a":1}');
    expect(headers.getContentType()).toBe('application/json');
  });

  it('leaves a valid JSON string untouched without setting a content type', () => {
    const { result, headers } = transformRequest('{"a":1}', {});

    expect(result).toBe('{"a":1}');
    expect(headers.getContentType()).toBeUndefined();
  });

  it('trims a valid JSON string when the content type is json', () => {
    const { result } = transformRequest('  {"a":1}  ', { 'Content-Type': 'application/json' });

    expect(result).toBe('{"a":1}');
  });

  it('does not trim a string that is not routed through the json path', () => {
    expect(transformRequest('  {"a":1}  ', {}).result).toBe('  {"a":1}  ');
  });

  it('passes a non-JSON string through unchanged', () => {
    const { result, headers } = transformRequest('not json', {});

    expect(result).toBe('not json');
    expect(headers.getContentType()).toBeUndefined();
  });

  it('stringifies a non-JSON string when the content type is json', () => {
    const { result } = transformRequest('not json', { 'Content-Type': 'application/json' });

    expect(result).toBe('"not json"');
  });

  it('stringifies a number when the content type is json', () => {
    expect(transformRequest(42, { 'Content-Type': 'application/json' }).result).toBe('42');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a boolean', true],
  ])('passes %s through unchanged without a json content type', (description, data) => {
    expect(transformRequest(data, {}).result).toBe(data);
  });

  it('serializes URLSearchParams and sets the urlencoded content type', () => {
    const { result, headers } = transformRequest(new URLSearchParams({ a: '1' }), {});

    expect(result).toBe('a=1');
    expect(headers.getContentType()).toBe('application/x-www-form-urlencoded;charset=utf-8');
  });

  it('does not override an existing urlencoded content type', () => {
    const { headers } = transformRequest(new URLSearchParams({ a: '1' }), {
      'Content-Type': 'text/plain',
    });

    expect(headers.getContentType()).toBe('text/plain');
  });

  it('unwraps an ArrayBufferView to its buffer', () => {
    const view = new Uint8Array([1, 2, 3]);

    expect(transformRequest(view, {}).result).toBe(view.buffer);
  });

  it.each([
    ['a Buffer', Buffer.from('x')],
    ['an ArrayBuffer', new ArrayBuffer(4)],
  ])('passes %s through unchanged', (description, data) => {
    expect(transformRequest(data, {}).result).toBe(data);
  });

  it('passes a node stream through unchanged', () => {
    const readable = stream.Readable.from(['chunk']);

    expect(transformRequest(readable, {}).result).toBe(readable);
  });

  it('passes a Blob through unchanged', () => {
    const blob = new Blob(['x']);

    expect(transformRequest(blob, {}).result).toBe(blob);
  });

  it('urlencodes an object when the content type says so', () => {
    const { result } = transformRequest(
      { a: 1, b: 2 },
      { 'Content-Type': 'application/x-www-form-urlencoded' }
    );

    expect(result).toBe('a=1&b=2');
  });

  it('rethrows a non-SyntaxError raised while probing a string payload', () => {
    const exploding = {
      toString: () => {
        throw new Error('should not be reached');
      },
    };

    expect(() => transformRequest(exploding, { 'Content-Type': 'text/plain' })).not.toThrow();
  });
});

describe('defaults::transformResponse', () => {
  it('returns a ReadableStream unchanged', () => {
    const body = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    expect(transformResponse(body)).toBe(body);
  });

  it('returns a Response unchanged', () => {
    const response = new Response('body');

    expect(transformResponse(response)).toBe(response);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
  ])('returns %s unchanged', (description, data) => {
    expect(transformResponse(data)).toBe(data);
  });

  it('returns a non-string payload unchanged', () => {
    const data = { already: 'parsed' };

    expect(transformResponse(data)).toBe(data);
  });

  it('does not parse when forcedJSONParsing is disabled', () => {
    const data = '{"a":1}';
    const result = transformResponse(data, {
      transitional: { ...transitionalDefaults, forcedJSONParsing: false },
    });

    expect(result).toBe(data);
  });

  it('does not parse when a non-json responseType is requested', () => {
    const data = '{"a":1}';

    expect(transformResponse(data, { responseType: 'text' })).toBe(data);
  });

  it('parses when responseType is json even if forcedJSONParsing is disabled', () => {
    const result = transformResponse('{"a":1}', {
      responseType: 'json',
      transitional: { ...transitionalDefaults, forcedJSONParsing: false },
    });

    expect(result).toEqual({ a: 1 });
  });

  it('applies a parseReviver while parsing', () => {
    const result = transformResponse('{"a":1}', {
      parseReviver: (key, value) => (key === 'a' ? value + 1 : value),
    });

    expect(result).toEqual({ a: 2 });
  });

  it('swallows a parse failure while silentJSONParsing is on', () => {
    expect(transformResponse('not json')).toBe('not json');
  });

  it('throws ERR_BAD_RESPONSE for malformed json in strict mode', () => {
    let error;

    try {
      transformResponse('not json', {
        responseType: 'json',
        transitional: { ...transitionalDefaults, silentJSONParsing: false },
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(AxiosError);
    expect(error.code).toBe(AxiosError.ERR_BAD_RESPONSE);
  });

  it('rethrows a non-SyntaxError raised by the reviver in strict mode', () => {
    const failure = new Error('reviver exploded');

    expect(() =>
      transformResponse('{"a":1}', {
        responseType: 'json',
        transitional: { ...transitionalDefaults, silentJSONParsing: false },
        parseReviver: () => {
          throw failure;
        },
      })
    ).toThrow(failure);
  });

  it('falls back to the module defaults when the config has no transitional', () => {
    expect(transformResponse('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('ignores a transitional inherited from the prototype chain', () => {
    const context = Object.create({
      transitional: { ...transitionalDefaults, forcedJSONParsing: false },
    });

    expect(transformResponse('{"a":1}', context)).toEqual({ a: 1 });
  });
});

describe('defaults::validateStatus', () => {
  it.each([
    [199, false],
    [200, true],
    [299, true],
    [300, false],
    [404, false],
    [500, false],
  ])('treats %i as %s', (status, expected) => {
    expect(defaults.validateStatus(status)).toBe(expected);
  });
});
