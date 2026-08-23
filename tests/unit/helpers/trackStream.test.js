import { describe, it, expect, vi } from 'vitest';
import { streamChunk, readBytes, trackStream } from '../../../lib/helpers/trackStream.js';

const sizesOf = (chunks) => chunks.map((chunk) => chunk.length);

const readAll = async (stream) => {
  const reader = stream.getReader();
  const chunks = [];

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
  }

  return chunks;
};

const sourceOf = (...chunks) =>
  new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });

describe('helpers::trackStream', () => {
  describe('streamChunk', () => {
    it.each([
      ['zero', 0],
      ['undefined', undefined],
      ['null', null],
    ])('yields the chunk whole when chunkSize is %s', (description, chunkSize) => {
      expect(sizesOf([...streamChunk(new Uint8Array(3), chunkSize)])).toEqual([3]);
    });

    it('yields the chunk whole when it is smaller than chunkSize', () => {
      expect(sizesOf([...streamChunk(new Uint8Array(3), 10)])).toEqual([3]);
    });

    it('yields a single chunk when its length equals chunkSize', () => {
      expect(sizesOf([...streamChunk(new Uint8Array(4), 4)])).toEqual([4]);
    });

    it('splits evenly when the length is a multiple of chunkSize', () => {
      expect(sizesOf([...streamChunk(new Uint8Array(4), 2)])).toEqual([2, 2]);
    });

    it('emits a short final chunk for the remainder', () => {
      expect(sizesOf([...streamChunk(new Uint8Array(5), 2)])).toEqual([2, 2, 1]);
    });

    it('yields a single empty chunk for an empty input', () => {
      expect(sizesOf([...streamChunk(new Uint8Array(0), 2)])).toEqual([0]);
    });

    it('preserves the byte content across a split', () => {
      const chunks = [...streamChunk(new Uint8Array([1, 2, 3, 4, 5]), 2)];

      expect([...chunks[0]]).toEqual([1, 2]);
      expect([...chunks[2]]).toEqual([5]);
    });
  });

  describe('readBytes', () => {
    it('re-chunks an async iterable', async () => {
      const iterable = (async function* () {
        yield new Uint8Array(4);
      })();

      const chunks = [];

      for await (const chunk of readBytes(iterable, 3)) {
        chunks.push(chunk);
      }

      expect(sizesOf(chunks)).toEqual([3, 1]);
    });

    it('re-chunks a ReadableStream that has no async iterator', async () => {
      const chunks = [];

      for await (const chunk of readBytes(sourceOf(new Uint8Array(5)), 2)) {
        chunks.push(chunk);
      }

      expect(sizesOf(chunks)).toEqual([2, 2, 1]);
    });

    it('produces nothing for an empty source', async () => {
      const chunks = [];

      for await (const chunk of readBytes(sourceOf(), 2)) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([]);
    });
  });

  describe('trackStream', () => {
    it('re-chunks the source and reports cumulative progress', async () => {
      const progress = [];
      const stream = trackStream(sourceOf(new Uint8Array(3), new Uint8Array(2)), 2, (loaded) =>
        progress.push(loaded)
      );

      const chunks = await readAll(stream);

      expect(sizesOf(chunks)).toEqual([2, 1, 2]);
      expect(progress).toEqual([2, 3, 5]);
    });

    it('emits Uint8Array chunks', async () => {
      const chunks = await readAll(trackStream(sourceOf(new Uint8Array([1, 2])), null, null));

      expect(chunks[0]).toBeInstanceOf(Uint8Array);
    });

    it('calls onFinish without an argument when the source completes', async () => {
      const onFinish = vi.fn();

      await readAll(trackStream(sourceOf(new Uint8Array(2)), null, null, onFinish));

      expect(onFinish).toHaveBeenCalledTimes(1);
      expect(onFinish).toHaveBeenCalledWith(undefined);
    });

    it('calls onFinish exactly once for an empty source', async () => {
      const onFinish = vi.fn();

      await readAll(trackStream(sourceOf(), null, null, onFinish));

      expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it('reports no progress for an empty source', async () => {
      const onProgress = vi.fn();

      await readAll(trackStream(sourceOf(), null, onProgress));

      expect(onProgress).not.toHaveBeenCalled();
    });

    it('passes the cancellation reason to onFinish', async () => {
      const onFinish = vi.fn();
      const stream = trackStream(sourceOf(new Uint8Array(3)), null, null, onFinish);

      await stream.cancel('client gave up');

      expect(onFinish).toHaveBeenCalledWith('client gave up');
    });

    it('cancels the underlying source once reading has started', async () => {
      const cancel = vi.fn();
      const source = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(1));
          controller.enqueue(new Uint8Array(1));
        },
        cancel,
      });

      const stream = trackStream(source, null, null);
      const reader = stream.getReader();

      await reader.read();
      await reader.cancel('done');

      expect(cancel).toHaveBeenCalled();
    });

    it('reports an error thrown by the source through onFinish and the reader', async () => {
      const onFinish = vi.fn();
      const failure = new Error('source exploded');
      const source = new ReadableStream({
        pull() {
          throw failure;
        },
      });

      const reader = trackStream(source, null, null, onFinish).getReader();

      await expect(reader.read()).rejects.toThrow('source exploded');
      expect(onFinish).toHaveBeenCalledTimes(1);
      expect(onFinish).toHaveBeenCalledWith(failure);
    });

    it('does not call onFinish again after an error', async () => {
      const onFinish = vi.fn();
      const source = new ReadableStream({
        pull() {
          throw new Error('boom');
        },
      });

      const stream = trackStream(source, null, null, onFinish);
      const reader = stream.getReader();

      await reader.read().catch(() => {});
      await reader.cancel().catch(() => {});

      expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it('works without progress or finish callbacks', async () => {
      const chunks = await readAll(trackStream(sourceOf(new Uint8Array(4)), 2));

      expect(sizesOf(chunks)).toEqual([2, 2]);
    });
  });
});
