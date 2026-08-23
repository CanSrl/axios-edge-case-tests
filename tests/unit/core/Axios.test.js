import { describe, it, expect, vi } from 'vitest';
import axios from '../../../index.js';
import { createMockAdapter, deferred, mockResponse } from '../../setup/mocks.js';

describe('core::Axios', () => {
  describe('request error stack decoration', () => {
    async function expectAdapterFailurePreserved() {
      const failure = new Error('adapter failure');

      await expect(
        axios.request({
          url: 'http://localhost/test',
          adapter: () => Promise.reject(failure),
        })
      ).rejects.toBe(failure);
    }

    it('preserves the original error when Error.prepareStackTrace returns a non-string stack', async () => {
      const original = Error.prepareStackTrace;
      // Simulates instrumentation that overrides the V8 hook to return
      // structured call-site data instead of a formatted string.
      Error.prepareStackTrace = () => ({});

      try {
        await expectAdapterFailurePreserved();
      } finally {
        Error.prepareStackTrace = original;
      }
    });

    it('preserves the original error when Error.prepareStackTrace throws', async () => {
      const original = Error.prepareStackTrace;
      Error.prepareStackTrace = () => {
        throw new Error('stack formatting failure');
      };

      try {
        await expectAdapterFailurePreserved();
      } finally {
        Error.prepareStackTrace = original;
      }
    });

    it('preserves the original error when Error.captureStackTrace throws', async () => {
      const original = Error.captureStackTrace;
      Error.captureStackTrace = () => {
        throw new Error('stack capture failure');
      };

      try {
        await expectAdapterFailurePreserved();
      } finally {
        Error.captureStackTrace = original;
      }
    });
  });
});

describe('core::Axios interceptor chains', () => {
  it('runs request interceptors last-registered-first and response interceptors first-registered-first', async () => {
    const order = [];
    const instance = axios.create({ adapter: createMockAdapter() });

    instance.interceptors.request.use((config) => {
      order.push('request-1');
      return config;
    });
    instance.interceptors.request.use((config) => {
      order.push('request-2');
      return config;
    });
    instance.interceptors.response.use((response) => {
      order.push('response-1');
      return response;
    });
    instance.interceptors.response.use((response) => {
      order.push('response-2');
      return response;
    });

    await instance.get('/things');

    expect(order).toEqual(['request-2', 'request-1', 'response-1', 'response-2']);
  });

  it('preserves the reverse order for synchronous request interceptors', async () => {
    const order = [];
    const instance = axios.create({ adapter: createMockAdapter() });

    instance.interceptors.request.use(
      (config) => {
        order.push('sync-1');
        return config;
      },
      null,
      { synchronous: true }
    );
    instance.interceptors.request.use(
      (config) => {
        order.push('sync-2');
        return config;
      },
      null,
      { synchronous: true }
    );

    await instance.get('/things');

    expect(order).toEqual(['sync-2', 'sync-1']);
  });

  it('skips an interceptor whose runWhen returns false', async () => {
    const interceptor = vi.fn((config) => config);
    const instance = axios.create({ adapter: createMockAdapter() });

    instance.interceptors.request.use(interceptor, null, { runWhen: () => false });
    await instance.get('/things');

    expect(interceptor).not.toHaveBeenCalled();
  });

  it('runs an interceptor whose runWhen returns true', async () => {
    const interceptor = vi.fn((config) => config);
    const instance = axios.create({ adapter: createMockAdapter() });

    instance.interceptors.request.use(interceptor, null, { runWhen: () => true });
    await instance.get('/things');

    expect(interceptor).toHaveBeenCalledTimes(1);
  });

  it('receives the request config in runWhen', async () => {
    const runWhen = vi.fn(() => false);
    const instance = axios.create({ adapter: createMockAdapter() });

    instance.interceptors.request.use((config) => config, null, { runWhen });
    await instance.get('/things');

    expect(runWhen.mock.calls[0][0].url).toBe('/things');
  });

  it('rejects the request when runWhen throws', async () => {
    const adapter = createMockAdapter();
    const instance = axios.create({ adapter });

    instance.interceptors.request.use((config) => config, null, {
      runWhen: () => {
        throw new Error('runWhen exploded');
      },
    });

    await expect(instance.get('/things')).rejects.toThrow('runWhen exploded');
    expect(adapter).not.toHaveBeenCalled();
  });

  it('never reaches the adapter when a request interceptor throws', async () => {
    const adapter = createMockAdapter();
    const instance = axios.create({ adapter });

    instance.interceptors.request.use(() => {
      throw new Error('interceptor rejected');
    });

    await expect(instance.get('/things')).rejects.toThrow('interceptor rejected');
    expect(adapter).not.toHaveBeenCalled();
  });

  it('passes an adapter failure to the response rejection handler', async () => {
    const failure = new Error('adapter blew up');
    const instance = axios.create({
      adapter: () => Promise.reject(failure),
    });
    const onRejected = vi.fn((error) => Promise.reject(error));

    instance.interceptors.response.use(null, onRejected);

    await expect(instance.get('/things')).rejects.toBe(failure);
    expect(onRejected).toHaveBeenCalledWith(failure);
  });

  it('lets a response rejection handler recover the request', async () => {
    const instance = axios.create({
      adapter: () => Promise.reject(new Error('transient')),
    });

    instance.interceptors.response.use(null, () => mockResponse({ data: 'recovered' }));

    await expect(instance.get('/things')).resolves.toMatchObject({ data: 'recovered' });
  });

  it('does not run an ejected interceptor', async () => {
    const ejected = vi.fn((config) => config);
    const kept = vi.fn((config) => config);
    const instance = axios.create({ adapter: createMockAdapter() });

    const id = instance.interceptors.request.use(ejected);
    instance.interceptors.request.use(kept);
    instance.interceptors.request.eject(id);

    await instance.get('/things');

    expect(ejected).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it('does not run any interceptor after clear', async () => {
    const interceptor = vi.fn((config) => config);
    const instance = axios.create({ adapter: createMockAdapter() });

    instance.interceptors.request.use(interceptor);
    instance.interceptors.request.clear();

    await instance.get('/things');

    expect(interceptor).not.toHaveBeenCalled();
  });
});

describe('core::Axios config handling', () => {
  it('lowercases the method before reaching the adapter', async () => {
    const adapter = createMockAdapter();
    const instance = axios.create({ adapter });

    await instance.request({ url: '/things', method: 'POST' });

    expect(adapter.lastConfig.method).toBe('post');
  });

  it('defaults the method to get', async () => {
    const adapter = createMockAdapter();
    const instance = axios.create({ adapter });

    await instance.request({ url: '/things' });

    expect(adapter.lastConfig.method).toBe('get');
  });

  it('accepts the url as the first argument', async () => {
    const adapter = createMockAdapter();
    const instance = axios.create({ adapter });

    await instance.request('/string-first');

    expect(adapter.lastConfig.url).toBe('/string-first');
  });

  it('merges a config object passed alongside the url', async () => {
    const adapter = createMockAdapter();
    const instance = axios.create({ adapter });

    await instance.request('/things', { method: 'delete' });

    expect(adapter.lastConfig.url).toBe('/things');
    expect(adapter.lastConfig.method).toBe('delete');
  });

  it('builds a full URI without dispatching a request', () => {
    const adapter = createMockAdapter();
    const instance = axios.create({ baseURL: 'https://api.example.com', adapter });

    expect(instance.getUri({ url: '/things', params: { a: 1 } })).toBe(
      'https://api.example.com/things?a=1'
    );
    expect(adapter).not.toHaveBeenCalled();
  });
});

describe('core::Axios cancellation', () => {
  it('rejects before the adapter runs when the token is already cancelled', async () => {
    const adapter = createMockAdapter();
    const instance = axios.create({ adapter });
    const source = axios.CancelToken.source();

    source.cancel('cancelled up front');

    const reason = await instance
      .get('/things', { cancelToken: source.token })
      .catch((error) => error);

    expect(axios.isCancel(reason)).toBe(true);
    expect(reason.message).toBe('cancelled up front');
    expect(adapter).not.toHaveBeenCalled();
  });

  it('rejects before the adapter runs when the signal is already aborted', async () => {
    const adapter = createMockAdapter();
    const instance = axios.create({ adapter });
    const controller = new AbortController();

    controller.abort();

    const reason = await instance
      .get('/things', { signal: controller.signal })
      .catch((error) => error);

    expect(axios.isCancel(reason)).toBe(true);
    expect(adapter).not.toHaveBeenCalled();
  });

  it('rejects with the cancellation reason raised by an in-flight adapter', async () => {
    const pending = deferred();
    const instance = axios.create({ adapter: () => pending.promise });
    const source = axios.CancelToken.source();

    const request = instance.get('/things', { cancelToken: source.token });

    source.cancel('cancelled mid-flight');
    pending.reject(source.token.reason);

    const reason = await request.catch((error) => error);

    expect(axios.isCancel(reason)).toBe(true);
    expect(reason.message).toBe('cancelled mid-flight');
  });

  it('still runs request interceptors registered before a pre-cancelled dispatch', async () => {
    const interceptor = vi.fn((config) => config);
    const adapter = createMockAdapter();
    const instance = axios.create({ adapter });
    const source = axios.CancelToken.source();

    instance.interceptors.request.use(interceptor);
    source.cancel('nope');

    await instance.get('/things', { cancelToken: source.token }).catch(() => {});

    expect(interceptor).toHaveBeenCalledTimes(1);
    expect(adapter).not.toHaveBeenCalled();
  });
});
