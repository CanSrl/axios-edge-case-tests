import { vi } from 'vitest';

export const deferred = () => {
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

export const mockResponse = (overrides) => ({
  data: undefined,
  status: 200,
  statusText: 'OK',
  headers: {},
  config: {},
  request: {},
  ...overrides,
});

export const createMockAdapter = (impl) => {
  const adapter = vi.fn(async (config) => {
    const result = typeof impl === 'function' ? await impl(config) : impl;

    return mockResponse({ config, ...result });
  });

  Object.defineProperty(adapter, 'lastConfig', {
    get() {
      const { calls } = adapter.mock;
      return calls.length ? calls[calls.length - 1][0] : undefined;
    },
  });

  return adapter;
};

export const createXHRStub = (options) => {
  const {
    status = 200,
    statusText = 'OK',
    responseText = '',
    response = undefined,
    responseURL = undefined,
    responseHeaders = {},
    autoRespond = true,
    hasUpload = true,
    onSend = null,
  } = options || {};

  const instances = [];

  class MockXMLHttpRequest {
    constructor() {
      this.readyState = 0;
      this.status = 0;
      this.statusText = '';
      this.responseText = '';
      this.response = '';
      this.responseURL = responseURL;
      this.responseType = '';
      this.timeout = 0;
      this.withCredentials = undefined;
      this.requestHeaders = {};
      this.sent = false;
      this.aborted = false;
      this.listeners = {};
      this.onloadend = null;
      this.onabort = null;
      this.onerror = null;
      this.ontimeout = null;
      this.onreadystatechange = null;

      if (hasUpload) {
        this.upload = {
          listeners: {},
          addEventListener: (type, fn) => {
            (this.upload.listeners[type] = this.upload.listeners[type] || []).push(fn);
          },
          removeEventListener: (type, fn) => {
            const list = this.upload.listeners[type];
            if (list) {
              const index = list.indexOf(fn);
              index !== -1 && list.splice(index, 1);
            }
          },
          dispatch: (type, event) => {
            (this.upload.listeners[type] || []).forEach((fn) => fn(event));
          },
        };
      }

      instances.push(this);
    }

    open(method, url) {
      this.method = method;
      this.url = url;
      this.readyState = 1;
    }

    setRequestHeader(name, value) {
      this.requestHeaders[name] = value;
    }

    getAllResponseHeaders() {
      return Object.entries(this.responseHeaders || {})
        .map(([name, value]) => `${name}: ${value}`)
        .join('\r\n');
    }

    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    }

    removeEventListener(type, fn) {
      const list = this.listeners[type];
      if (list) {
        const index = list.indexOf(fn);
        index !== -1 && list.splice(index, 1);
      }
    }

    dispatch(type, event) {
      (this.listeners[type] || []).forEach((fn) => fn(event));
    }

    abort() {
      this.aborted = true;
      this.onabort && this.onabort();
    }

    send(body) {
      this.sent = true;
      this.body = body;

      if (onSend) {
        onSend(this);
        return;
      }

      if (autoRespond) {
        setTimeout(() => this.respond());
      }
    }

    respond(overrides) {
      const settings = {
        status,
        statusText,
        responseText,
        response,
        responseHeaders,
        ...overrides,
      };

      this.readyState = 4;
      this.status = settings.status;
      this.statusText = settings.statusText;
      this.responseText = settings.responseText;
      this.response = settings.response === undefined ? settings.responseText : settings.response;
      this.responseHeaders = settings.responseHeaders;

      this.onreadystatechange && this.onreadystatechange();
      this.onloadend && this.onloadend({ type: 'loadend' });
    }

    failWith(event) {
      this.onerror && this.onerror(event);
    }

    timeoutNow() {
      this.ontimeout && this.ontimeout();
    }
  }

  MockXMLHttpRequest.instances = instances;
  Object.defineProperty(MockXMLHttpRequest, 'last', {
    get: () => instances[instances.length - 1],
  });

  return MockXMLHttpRequest;
};

export const createFetchStub = (impl) => {
  const requests = [];

  const fetchStub = vi.fn(async (request) => {
    requests.push(request);

    const result = typeof impl === 'function' ? await impl(request) : impl;

    return result === undefined ? new Response('') : result;
  });

  fetchStub.requests = requests;

  return fetchStub;
};
