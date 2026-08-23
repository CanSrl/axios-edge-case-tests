import { describe, it, expect } from 'vitest';
import formDataToStream from '../../../lib/helpers/formDataToStream.js';

class SpecFormData {
  constructor() {
    this._entries = [];
    this[Symbol.toStringTag] = 'FormData';
  }
  append(name, value) {
    this._entries.push([name, value]);
  }
  entries() {
    return this._entries[Symbol.iterator]();
  }
  [Symbol.iterator]() {
    return this._entries[Symbol.iterator]();
  }
}

const makeBlobLike = ({ type, name, size, payload }) => ({
  type,
  name,
  size: size ?? payload.byteLength,
  [Symbol.asyncIterator]: async function* () {
    yield payload;
  },
});

const collect = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
};

describe('formDataToStream', () => {
  it('should strip CRLF sequences from blob.type to prevent multipart header injection', async () => {
    const fd = new SpecFormData();
    fd.append(
      'photo',
      makeBlobLike({
        type: 'image/jpeg\r\nX-Injected-Header: PWNED\r\nX-Evil: bad',
        name: 'photo.jpg',
        payload: Buffer.from('PAYLOAD'),
      })
    );

    const body = await collect(formDataToStream(fd, () => {}));

    expect(body).not.toContain('\r\nX-Injected-Header');
    expect(body).not.toContain('\r\nX-Evil');
    expect(body).toContain('Content-Type: image/jpegX-Injected-Header: PWNEDX-Evil: bad\r\n');
  });

  it('should strip bare \\r and bare \\n from blob.type', async () => {
    const fd = new SpecFormData();
    fd.append(
      'f',
      makeBlobLike({
        type: 'text/plain\rX-A: 1\nX-B: 2',
        name: 'f.txt',
        payload: Buffer.from('x'),
      })
    );

    const body = await collect(formDataToStream(fd, () => {}));

    expect(body).not.toMatch(/^X-A:/m);
    expect(body).not.toMatch(/^X-B:/m);
  });

  it('should preserve legitimate Content-Type values', async () => {
    const fd = new SpecFormData();
    fd.append(
      'doc',
      makeBlobLike({
        type: 'application/json; charset=utf-8',
        name: 'doc.json',
        payload: Buffer.from('{}'),
      })
    );

    const body = await collect(formDataToStream(fd, () => {}));

    expect(body).toContain('Content-Type: application/json; charset=utf-8\r\n');
  });

  it('should default missing blob.type to application/octet-stream', async () => {
    const fd = new SpecFormData();
    fd.append(
      'bin',
      makeBlobLike({
        type: '',
        name: 'bin',
        payload: Buffer.from([0x00, 0x01]),
      })
    );

    const body = await collect(formDataToStream(fd, () => {}));

    expect(body).toContain('Content-Type: application/octet-stream\r\n');
  });

  it('should escape CRLF and quotes in blob.name (Content-Disposition)', async () => {
    const fd = new SpecFormData();
    fd.append(
      'up',
      makeBlobLike({
        type: 'text/plain',
        name: 'evil\r\nX-Bad: 1".jpg',
        payload: Buffer.from('x'),
      })
    );

    const body = await collect(formDataToStream(fd, () => {}));

    expect(body).not.toContain('\r\nX-Bad: 1');
    expect(body).toContain('filename="evil%0D%0AX-Bad: 1%22.jpg"');
  });

  it('should report stable contentLength that matches emitted bytes', async () => {
    const fd = new SpecFormData();
    fd.append(
      'photo',
      makeBlobLike({
        type: 'image/jpeg\r\nX-Injected: PWNED',
        name: 'photo.jpg',
        payload: Buffer.from('PAYLOAD'),
      })
    );

    let reportedLength;
    const stream = formDataToStream(
      fd,
      (h) => {
        reportedLength = h['Content-Length'];
      },
      { boundary: 'test-boundary-abc' }
    );

    const body = await collect(stream);

    expect(Buffer.byteLength(body, 'utf8')).toBe(reportedLength);
  });
});

describe('formDataToStream argument validation', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a plain object', { a: 1 }],
    ['a string', 'form'],
    ['an array', []],
  ])('should throw a TypeError for %s', (description, value) => {
    expect(() => formDataToStream(value)).toThrow(TypeError);
    expect(() => formDataToStream(value)).toThrow('FormData instance required');
  });

  it.each([
    ['an empty boundary', ''],
    ['a boundary longer than 70 characters', 'b'.repeat(71)],
  ])('should reject %s', (description, boundary) => {
    expect(() => formDataToStream(new SpecFormData(), null, { boundary })).toThrow(
      'boundary must be 1-70 characters long'
    );
  });

  it.each([
    ['a single character boundary', 'b'],
    ['a 70 character boundary', 'b'.repeat(70)],
  ])('should accept %s', (description, boundary) => {
    expect(() => formDataToStream(new SpecFormData(), null, { boundary })).not.toThrow();
  });

  it('should not require a headers handler', () => {
    const form = new SpecFormData();
    form.append('field', 'value');

    expect(() => formDataToStream(form)).not.toThrow();
  });
});

describe('formDataToStream computed headers', () => {
  it('should report the boundary in the content type', () => {
    let computed;

    formDataToStream(
      new SpecFormData(),
      (headers) => {
        computed = headers;
      },
      { boundary: 'my-boundary' }
    );

    expect(computed['Content-Type']).toBe('multipart/form-data; boundary=my-boundary');
  });

  it('should build the boundary from the tag and size options', () => {
    let computed;

    formDataToStream(
      new SpecFormData(),
      (headers) => {
        computed = headers;
      },
      { tag: 'custom-tag', size: 5 }
    );

    const boundary = computed['Content-Type'].split('boundary=')[1];

    expect(boundary.startsWith('custom-tag-')).toBe(true);
    expect(boundary).toHaveLength('custom-tag-'.length + 5);
  });

  it('should emit only the footer for an empty form', async () => {
    let computed;

    const stream = formDataToStream(
      new SpecFormData(),
      (headers) => {
        computed = headers;
      },
      { boundary: 'empty-boundary' }
    );

    const body = await collect(stream);

    expect(body).toBe('--empty-boundary--\r\n');
    expect(computed['Content-Length']).toBe(Buffer.byteLength(body));
  });

  it('should count the content length of a multi-part form', async () => {
    const form = new SpecFormData();
    form.append('a', '1');
    form.append(
      'b',
      makeBlobLike({ type: 'text/plain', name: 'b.txt', payload: Buffer.from('xyz') })
    );

    let computed;
    const stream = formDataToStream(form, (headers) => {
      computed = headers;
    });

    const body = await collect(stream);

    expect(computed['Content-Length']).toBe(Buffer.byteLength(body));
  });

  it('should normalize bare newlines in string values to CRLF', async () => {
    const form = new SpecFormData();
    form.append('field', 'line1\nline2');

    const body = await collect(formDataToStream(form, null, { boundary: 'nl-boundary' }));

    expect(body).toContain('line1\r\nline2');
  });

  it('should keep existing CRLF sequences in string values intact', async () => {
    const form = new SpecFormData();
    form.append('field', 'line1\r\nline2');

    const body = await collect(formDataToStream(form, null, { boundary: 'crlf-boundary' }));

    expect(body).toContain('line1\r\nline2');
    expect(body).not.toContain('line1\r\r\nline2');
  });
});
