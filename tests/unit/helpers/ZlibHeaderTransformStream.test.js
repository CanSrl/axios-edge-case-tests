import { describe, it, expect } from 'vitest';
import zlib from 'zlib';
import ZlibHeaderTransformStream from '../../../lib/helpers/ZlibHeaderTransformStream.js';

const ZLIB_HEADER = [0x78, 0x9c];

const pipeThrough = (chunks) =>
  new Promise((resolve, reject) => {
    const stream = new ZlibHeaderTransformStream();
    const received = [];

    stream.on('data', (chunk) => received.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(received)));

    chunks.forEach((chunk) => stream.write(chunk));
    stream.end();
  });

describe('helpers::ZlibHeaderTransformStream', () => {
  it('prepends a default zlib header when the payload has none', async () => {
    const output = await pipeThrough([Buffer.from([1, 2, 3])]);

    expect([...output]).toEqual([...ZLIB_HEADER, 1, 2, 3]);
  });

  it('leaves a payload that already starts with 0x78 untouched', async () => {
    const output = await pipeThrough([Buffer.from([0x78, 0x9c, 5])]);

    expect([...output]).toEqual([0x78, 0x9c, 5]);
  });

  it('does not treat 0x78 in a later position as a header', async () => {
    const output = await pipeThrough([Buffer.from([1, 0x78])]);

    expect([...output]).toEqual([...ZLIB_HEADER, 1, 0x78]);
  });

  it('prepends the header only once across multiple chunks', async () => {
    const output = await pipeThrough([Buffer.from([1]), Buffer.from([2]), Buffer.from([3])]);

    expect([...output]).toEqual([...ZLIB_HEADER, 1, 2, 3]);
  });

  it('defers the decision past a leading empty chunk', async () => {
    const output = await pipeThrough([Buffer.alloc(0), Buffer.from([1, 2])]);

    expect([...output]).toEqual([...ZLIB_HEADER, 1, 2]);
  });

  it('defers the decision past a leading empty chunk when the payload is already headed', async () => {
    const output = await pipeThrough([Buffer.alloc(0), Buffer.from([0x78, 0x9c, 7])]);

    expect([...output]).toEqual([0x78, 0x9c, 7]);
  });

  it('emits nothing for an empty stream', async () => {
    const output = await pipeThrough([]);

    expect(output.byteLength).toBe(0);
  });

  it('emits nothing but an empty chunk when every chunk is empty', async () => {
    const output = await pipeThrough([Buffer.alloc(0), Buffer.alloc(0)]);

    expect(output.byteLength).toBe(0);
  });

  it('produces output inflatable by zlib for headerless deflate-raw data', async () => {
    const raw = zlib.deflateRawSync(Buffer.from('hello edge case'));
    const output = await pipeThrough([raw]);
    const inflated = zlib.inflateSync(output, {
      finishFlush: zlib.constants.Z_SYNC_FLUSH,
    });

    expect(inflated.toString()).toBe('hello edge case');
  });

  it('keeps already-headed deflate data inflatable', async () => {
    const deflated = zlib.deflateSync(Buffer.from('already headed'));
    const output = await pipeThrough([deflated]);

    expect(output[0]).toBe(0x78);
    expect(zlib.inflateSync(output).toString()).toBe('already headed');
  });
});
