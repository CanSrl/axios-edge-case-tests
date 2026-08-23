import { describe, it, expect, vi } from 'vitest';
import readBlob from '../../../lib/helpers/readBlob.js';

const drain = async (blob) => {
  const chunks = [];

  for await (const chunk of readBlob(blob)) {
    chunks.push(chunk);
  }

  return chunks;
};

describe('helpers::readBlob', () => {
  it('reads through stream() when it is available', async () => {
    const blob = {
      stream: () =>
        (async function* () {
          yield 'a';
          yield 'b';
        })(),
    };

    await expect(drain(blob)).resolves.toEqual(['a', 'b']);
  });

  it('prefers stream() over arrayBuffer()', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(8));
    const blob = {
      stream: () =>
        (async function* () {
          yield 'from-stream';
        })(),
      arrayBuffer,
    };

    await expect(drain(blob)).resolves.toEqual(['from-stream']);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('yields the whole buffer at once through arrayBuffer()', async () => {
    const source = new Uint8Array([1, 2, 3]);
    const chunks = await drain({ arrayBuffer: async () => source.buffer });

    expect(chunks).toHaveLength(1);
    expect(new Uint8Array(chunks[0])).toEqual(source);
  });

  it('prefers arrayBuffer() over the async iterator', async () => {
    const blob = {
      arrayBuffer: async () => new Uint8Array([9]).buffer,
      [Symbol.asyncIterator]: async function* () {
        yield 'iterated';
      },
    };

    const chunks = await drain(blob);

    expect(new Uint8Array(chunks[0])).toEqual(new Uint8Array([9]));
  });

  it('falls back to the async iterator', async () => {
    const blob = {
      [Symbol.asyncIterator]: async function* () {
        yield 'x';
        yield 'y';
      },
    };

    await expect(drain(blob)).resolves.toEqual(['x', 'y']);
  });

  it('yields the value itself when no reading protocol is supported', async () => {
    const blob = { size: 3 };

    await expect(drain(blob)).resolves.toEqual([blob]);
  });

  it.each([
    ['a string', 'plain'],
    ['a number', 7],
  ])('yields %s unchanged', async (description, value) => {
    await expect(drain(value)).resolves.toEqual([value]);
  });

  it('propagates an error thrown by stream()', async () => {
    const blob = {
      stream: () =>
        (async function* () {
          throw new Error('stream failed');
        })(),
    };

    await expect(drain(blob)).rejects.toThrow('stream failed');
  });

  it('propagates a rejected arrayBuffer()', async () => {
    const blob = {
      arrayBuffer: async () => {
        throw new Error('buffer failed');
      },
    };

    await expect(drain(blob)).rejects.toThrow('buffer failed');
  });

  it('reads a real Blob through its stream', async () => {
    const chunks = await drain(new Blob(['edge']));
    const merged = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));

    expect(merged.toString()).toBe('edge');
  });

  it('produces no chunks for an empty async iterator', async () => {
    const blob = {
      [Symbol.asyncIterator]: async function* () {},
    };

    await expect(drain(blob)).resolves.toEqual([]);
  });
});
