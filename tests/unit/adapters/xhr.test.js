import { afterEach, describe, expect, it, vi } from 'vitest';
import { createXHRStub } from '../../setup/mocks.js';

// The xhr adapter fixes `isXHRAdapterSupported` and `platform.origin` at module load,
// so each case stubs the globals first and imports axios into a fresh module registry.
// The stub fires only readystatechange and loadend with status 0, which is both the
// Firefox 152 navigation-cancel shape (https://bugzilla.mozilla.org/show_bug.cgi?id=1505389)
// and the shape of a successful file: read in an environment without responseURL.

class StubXMLHttpRequest {
  constructor() {
    this.readyState = 0;
    this.status = 0;
    this.statusText = '';
    this.responseText = '';
    this.response = '';
    this.timeout = 0;
    this.onloadend = null;
    this.onabort = null;
    this.onerror = null;
    this.ontimeout = null;
    this.onreadystatechange = null;
  }

  open() {}

  setRequestHeader() {}

  getAllResponseHeaders() {
    return '';
  }

  abort() {}

  send() {
    setTimeout(() => {
      this.readyState = 4;
      this.onreadystatechange && this.onreadystatechange();
      this.onloadend && this.onloadend();
    });
  }
}

async function importAxiosForPage(originHref) {
  vi.resetModules();
  vi.stubGlobal('window', { location: { href: originHref } });
  vi.stubGlobal('document', { cookie: '' });
  vi.stubGlobal('XMLHttpRequest', StubXMLHttpRequest);
  const { default: axios } = await import('../../../index.js');
  return axios;
}

describe('xhr adapter status 0 handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('should resolve a relative file: read when responseURL is unavailable', async () => {
    const axios = await importAxiosForPage('file:///app/index.html');
    const response = await axios.get('data.json', { adapter: 'xhr' });
    expect(response.status).toBe(0);
  });

  it('should reject with ECONNABORTED for a relative request from an http page', async () => {
    const axios = await importAxiosForPage('http://localhost/index.html');
    const reason = await axios.get('data.json', { adapter: 'xhr' }).catch((error) => error);
    expect(reason).toBeInstanceOf(axios.AxiosError);
    expect(reason.code).toBe(axios.AxiosError.ECONNABORTED);
    expect(reason.message).toBe('Request aborted');
  });

  it('should reject before validateStatus can accept a status 0 response', async () => {
    const axios = await importAxiosForPage('http://localhost/index.html');
    const validateStatus = vi.fn(() => true);
    const reason = await axios
      .get('data.json', { adapter: 'xhr', validateStatus })
      .catch((error) => error);
    expect(reason).toBeInstanceOf(axios.AxiosError);
    expect(reason.code).toBe(axios.AxiosError.ECONNABORTED);
    expect(validateStatus).not.toHaveBeenCalled();
  });

  it('should resolve an absolute file: read from an http page when responseURL is unavailable', async () => {
    const axios = await importAxiosForPage('http://localhost/index.html');
    const response = await axios.get('file:///app/data.json', { adapter: 'xhr' });
    expect(response.status).toBe(0);
  });

  it('should reject with ECONNABORTED for an absolute http request from a file: page', async () => {
    const axios = await importAxiosForPage('file:///app/index.html');
    const reason = await axios
      .get('https://api.example.com/things', { adapter: 'xhr' })
      .catch((error) => error);
    expect(reason).toBeInstanceOf(axios.AxiosError);
    expect(reason.code).toBe(axios.AxiosError.ECONNABORTED);
  });

  it.each([
    ['an ASCII space', ' https://api.example.com/things'],
    ['a C0 control', '\u0000https://api.example.com/things'],
  ])(
    'should reject an absolute http request from a file: page when prefixed by %s',
    async (description, url) => {
      const axios = await importAxiosForPage('file:///app/index.html');
      const reason = await axios.get(url, { adapter: 'xhr' }).catch((error) => error);
      expect(reason).toBeInstanceOf(axios.AxiosError);
      expect(reason.code).toBe(axios.AxiosError.ECONNABORTED);
    }
  );
});

async function importAxiosWithXHR(XHRClass, originHref = 'http://localhost/index.html') {
  vi.resetModules();
  vi.stubGlobal('window', { location: { href: originHref } });
  vi.stubGlobal('document', { cookie: '' });
  vi.stubGlobal('XMLHttpRequest', XHRClass);
  const { default: axios } = await import('../../../index.js');
  return axios;
}

describe('xhr adapter failure and cancellation paths', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('should reject with ERR_NETWORK when the request errors', async () => {
    const XHR = createXHRStub({
      autoRespond: false,
      onSend: (xhr) => setTimeout(() => xhr.failWith()),
    });
    const axios = await importAxiosWithXHR(XHR);

    const reason = await axios.get('/things', { adapter: 'xhr' }).catch((error) => error);

    expect(reason).toBeInstanceOf(axios.AxiosError);
    expect(reason.code).toBe(axios.AxiosError.ERR_NETWORK);
    expect(reason.message).toBe('Network Error');
    expect(reason.event).toBeNull();
  });

  it('should surface the error event message and attach the event', async () => {
    const event = { type: 'error', message: 'DNS failure' };
    const XHR = createXHRStub({
      autoRespond: false,
      onSend: (xhr) => setTimeout(() => xhr.failWith(event)),
    });
    const axios = await importAxiosWithXHR(XHR);

    const reason = await axios.get('/things', { adapter: 'xhr' }).catch((error) => error);

    expect(reason.message).toBe('DNS failure');
    expect(reason.event).toBe(event);
  });

  it('should reject with ECONNABORTED when the request is aborted by the browser', async () => {
    const XHR = createXHRStub({
      autoRespond: false,
      onSend: (xhr) => setTimeout(() => xhr.abort()),
    });
    const axios = await importAxiosWithXHR(XHR);

    const reason = await axios.get('/things', { adapter: 'xhr' }).catch((error) => error);

    expect(reason.code).toBe(axios.AxiosError.ECONNABORTED);
    expect(reason.message).toBe('Request aborted');
  });

  it('should reject a timeout with ECONNABORTED by default', async () => {
    const XHR = createXHRStub({
      autoRespond: false,
      onSend: (xhr) => setTimeout(() => xhr.timeoutNow()),
    });
    const axios = await importAxiosWithXHR(XHR);

    const reason = await axios
      .get('/things', { adapter: 'xhr', timeout: 25 })
      .catch((error) => error);

    expect(reason.code).toBe(axios.AxiosError.ECONNABORTED);
    expect(reason.message).toBe('timeout of 25ms exceeded');
  });

  it('should reject a timeout with ETIMEDOUT when clarifyTimeoutError is set', async () => {
    const XHR = createXHRStub({
      autoRespond: false,
      onSend: (xhr) => setTimeout(() => xhr.timeoutNow()),
    });
    const axios = await importAxiosWithXHR(XHR);

    const reason = await axios
      .get('/things', {
        adapter: 'xhr',
        timeout: 25,
        transitional: { clarifyTimeoutError: true },
      })
      .catch((error) => error);

    expect(reason.code).toBe(axios.AxiosError.ETIMEDOUT);
  });

  it('should use a generic timeout message when no timeout was configured', async () => {
    const XHR = createXHRStub({
      autoRespond: false,
      onSend: (xhr) => setTimeout(() => xhr.timeoutNow()),
    });
    const axios = await importAxiosWithXHR(XHR);

    const reason = await axios.get('/things', { adapter: 'xhr' }).catch((error) => error);

    expect(reason.message).toBe('timeout exceeded');
  });

  it('should prefer a custom timeoutErrorMessage', async () => {
    const XHR = createXHRStub({
      autoRespond: false,
      onSend: (xhr) => setTimeout(() => xhr.timeoutNow()),
    });
    const axios = await importAxiosWithXHR(XHR);

    const reason = await axios
      .get('/things', { adapter: 'xhr', timeout: 25, timeoutErrorMessage: 'too slow' })
      .catch((error) => error);

    expect(reason.message).toBe('too slow');
  });

  it('should reject an unsupported protocol before sending', async () => {
    const XHR = createXHRStub({ autoRespond: false });
    const axios = await importAxiosWithXHR(XHR);

    const reason = await axios
      .get('ftp://example.com/things', { adapter: 'xhr' })
      .catch((error) => error);

    expect(reason.code).toBe(axios.AxiosError.ERR_BAD_REQUEST);
    expect(reason.message).toBe('Unsupported protocol ftp:');
    expect(XHR.last.sent).toBe(false);
  });

  it('should abort the request and reject with the cancel reason for a cancelToken', async () => {
    const XHR = createXHRStub({ autoRespond: false });
    const axios = await importAxiosWithXHR(XHR);
    const source = axios.CancelToken.source();

    const pending = axios.get('/things', { adapter: 'xhr', cancelToken: source.token });
    source.cancel('user cancelled');

    const reason = await pending.catch((error) => error);

    expect(axios.isCancel(reason)).toBe(true);
    expect(reason.message).toBe('user cancelled');
    expect(XHR.last.aborted).toBe(true);
  });

  it('should reject immediately for an already aborted signal', async () => {
    const XHR = createXHRStub({ autoRespond: false });
    const axios = await importAxiosWithXHR(XHR);
    const controller = new AbortController();

    controller.abort();

    const reason = await axios
      .get('/things', { adapter: 'xhr', signal: controller.signal })
      .catch((error) => error);

    expect(axios.isCancel(reason)).toBe(true);
    expect(XHR.instances).toHaveLength(0);
  });

  it('should abort when the signal fires mid-flight', async () => {
    const XHR = createXHRStub({ autoRespond: false });
    const axios = await importAxiosWithXHR(XHR);
    const controller = new AbortController();

    const pending = axios.get('/things', { adapter: 'xhr', signal: controller.signal });
    controller.abort();

    const reason = await pending.catch((error) => error);

    expect(axios.isCancel(reason)).toBe(true);
    expect(XHR.last.aborted).toBe(true);
  });
});

describe('xhr adapter request shaping', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it.each([
    ['true', true, true],
    ['a truthy value', 1, true],
    ['false', false, false],
  ])('should coerce withCredentials %s to a boolean', async (description, value, expected) => {
    const XHR = createXHRStub();
    const axios = await importAxiosWithXHR(XHR);

    await axios.get('/things', { adapter: 'xhr', withCredentials: value });

    expect(XHR.last.withCredentials).toBe(expected);
  });

  it('should leave withCredentials untouched when it is not configured', async () => {
    const XHR = createXHRStub();
    const axios = await importAxiosWithXHR(XHR);

    await axios.get('/things', { adapter: 'xhr' });

    expect(XHR.last.withCredentials).toBeUndefined();
  });

  it('should not forward a json responseType to the request', async () => {
    const XHR = createXHRStub();
    const axios = await importAxiosWithXHR(XHR);

    await axios.get('/things', { adapter: 'xhr', responseType: 'json' });

    expect(XHR.last.responseType).toBe('');
  });

  it('should forward a non-json responseType to the request', async () => {
    const XHR = createXHRStub();
    const axios = await importAxiosWithXHR(XHR);

    await axios.get('/things', { adapter: 'xhr', responseType: 'blob' });

    expect(XHR.last.responseType).toBe('blob');
  });

  it('should drop the content-type header when there is no request body', async () => {
    const XHR = createXHRStub();
    const axios = await importAxiosWithXHR(XHR);

    await axios.get('/things', {
      adapter: 'xhr',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(XHR.last.requestHeaders['Content-Type']).toBeUndefined();
  });

  it('should strip CRLF from outgoing header values', async () => {
    const XHR = createXHRStub();
    const axios = await importAxiosWithXHR(XHR);

    await axios.get('/things', {
      adapter: 'xhr',
      headers: { 'X-Custom': 'value\r\nX-Injected: 1' },
    });

    expect(XHR.last.requestHeaders['X-Custom']).toBe('valueX-Injected: 1');
  });

  it('should send null instead of an empty body', async () => {
    const XHR = createXHRStub();
    const axios = await importAxiosWithXHR(XHR);

    await axios.get('/things', { adapter: 'xhr' });

    expect(XHR.last.body).toBeNull();
  });

  it('should expose the parsed response headers on the response', async () => {
    const XHR = createXHRStub({
      responseText: 'ok',
      responseHeaders: { 'x-powered-by': 'axios', 'content-type': 'text/plain' },
    });
    const axios = await importAxiosWithXHR(XHR);

    const response = await axios.get('/things', { adapter: 'xhr' });

    expect(response.data).toBe('ok');
    expect(response.headers['x-powered-by']).toBe('axios');
  });

  it('should reject a non-2xx status through settle', async () => {
    const XHR = createXHRStub({ status: 404, statusText: 'Not Found' });
    const axios = await importAxiosWithXHR(XHR);

    const reason = await axios.get('/things', { adapter: 'xhr' }).catch((error) => error);

    expect(reason.code).toBe(axios.AxiosError.ERR_BAD_REQUEST);
    expect(reason.response.status).toBe(404);
  });
});
