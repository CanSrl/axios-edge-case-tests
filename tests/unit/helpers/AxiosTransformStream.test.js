import { describe, it, expect, vi } from 'vitest';
import AxiosTransformStream from '../../../lib/helpers/AxiosTransformStream.js';

const collect = (stream, chunks) =>
  new Promise((resolve, reject) => {
    const sizes = [];

    stream.on('data', (chunk) => sizes.push(chunk.length));
    stream.on('error', reject);
    stream.on('end', () => resolve(sizes));

    chunks.forEach((chunk) => stream.write(chunk));
    stream.end();
  });

describe('helpers::AxiosTransformStream', () => {
  describe('options', () => {
    it('defaults the readable high water mark to 64KB', () => {
      expect(new AxiosTransformStream({}).readableHighWaterMark).toBe(64 * 1024);
    });

    it('ignores an explicitly undefined chunkSize', () => {
      expect(new AxiosTransformStream({ chunkSize: undefined }).readableHighWaterMark).toBe(
        64 * 1024
      );
    });

    it('uses the provided chunkSize as the readable high water mark', () => {
      expect(new AxiosTransformStream({ chunkSize: 128 }).readableHighWaterMark).toBe(128);
    });

    it('accepts being constructed without options', () => {
      expect(new AxiosTransformStream().readableHighWaterMark).toBe(64 * 1024);
    });
  });

  describe('chunk splitting', () => {
    it('passes a payload smaller than the high water mark straight through', async () => {
      const stream = new AxiosTransformStream({ chunkSize: 64 * 1024 });

      await expect(collect(stream, [Buffer.alloc(10)])).resolves.toEqual([10]);
    });

    it('splits a payload at the high water mark', async () => {
      const stream = new AxiosTransformStream({ chunkSize: 4, minChunkSize: 1 });

      await expect(collect(stream, [Buffer.alloc(10)])).resolves.toEqual([4, 4, 2]);
    });

    it('does not split when the remainder would be at most minChunkSize', async () => {
      const stream = new AxiosTransformStream({ chunkSize: 10, minChunkSize: 100 });

      await expect(collect(stream, [Buffer.alloc(50)])).resolves.toEqual([50]);
    });

    it('stops splitting once the remainder reaches minChunkSize', async () => {
      const stream = new AxiosTransformStream({ chunkSize: 10, minChunkSize: 100 });

      await expect(collect(stream, [Buffer.alloc(200)])).resolves.toEqual([
        10, 10, 10, 10, 10, 10, 10, 10, 10, 110,
      ]);
    });

    it('treats minChunkSize false as no lower bound', async () => {
      const stream = new AxiosTransformStream({ chunkSize: 4, minChunkSize: false });

      await expect(collect(stream, [Buffer.alloc(10)])).resolves.toEqual([4, 4, 2]);
    });

    it('emits nothing for an empty write', async () => {
      const stream = new AxiosTransformStream({ chunkSize: 4, minChunkSize: 1 });

      await expect(collect(stream, [Buffer.alloc(0)])).resolves.toEqual([]);
    });

    it('delivers every byte when the high water mark is tiny', async () => {
      const stream = new AxiosTransformStream({ chunkSize: 4, minChunkSize: 1 });
      const sizes = await collect(stream, [Buffer.alloc(1024)]);

      expect(sizes.reduce((total, size) => total + size, 0)).toBe(1024);
      expect(sizes.every((size) => size <= 4)).toBe(true);
    });
  });

  describe('progress events', () => {
    it('reports cumulative bytes seen', async () => {
      const stream = new AxiosTransformStream({ chunkSize: 4, minChunkSize: 1 });
      const seen = [];

      stream.on('progress', (bytes) => seen.push(bytes));
      await collect(stream, [Buffer.alloc(6)]);

      expect(seen).toEqual([4, 6]);
    });

    it('accumulates across multiple written chunks', async () => {
      const stream = new AxiosTransformStream({ chunkSize: 64 * 1024 });
      const seen = [];

      stream.on('progress', (bytes) => seen.push(bytes));
      await collect(stream, [Buffer.alloc(3), Buffer.alloc(5)]);

      expect(seen).toEqual([3, 8]);
    });

    it('does not emit progress when no listener was attached before writing', async () => {
      const stream = new AxiosTransformStream({ chunkSize: 4, minChunkSize: 1 });
      const listener = vi.fn();

      await collect(stream, [Buffer.alloc(6)]);
      stream.on('progress', listener);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('rate limiting', () => {
    it('does not throttle when maxRate is zero', async () => {
      const stream = new AxiosTransformStream({ maxRate: 0 });

      await expect(collect(stream, [Buffer.alloc(1000)])).resolves.toEqual([1000]);
    });

    it('caps the bytes emitted within a single time window', async () => {
      const stream = new AxiosTransformStream({ maxRate: 2000, timeWindow: 50 });
      const started = Date.now();
      const sizes = await collect(stream, [Buffer.alloc(300)]);

      expect(sizes[0]).toBe(100);
      expect(sizes.reduce((total, size) => total + size, 0)).toBe(300);
      expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    });

    it('delivers the full payload despite throttling', async () => {
      const stream = new AxiosTransformStream({ maxRate: 4000, timeWindow: 20 });
      const sizes = await collect(stream, [Buffer.alloc(400)]);

      expect(sizes.reduce((total, size) => total + size, 0)).toBe(400);
    });
  });
});
