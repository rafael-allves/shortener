import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { before, after, test, type TestContext } from 'node:test';
import express from 'express';
import { RateLimit } from '../config/rateLimit.ts';
import { redis } from '../config/redis.ts';

before(async () => {
  await redis.connect();
  assert.equal(await redis.ping(), 'PONG', 'Redis must be reachable before the tests run.');
});

after(async () => {
  if (redis.isOpen) {
    await redis.close();
  }
});

// Integration tests use real Redis expiration and a unique namespace per test.
async function setup(t: TestContext, options: { limit?: number; trustProxy?: boolean } = {}) {
  assert.equal(redis.isReady, true, 'Redis must be connected before creating the HTTP test server.');
  const keyPrefix = `ratelimit:test:${randomUUID()}`;
  const clientKey = `${keyPrefix}:127.0.0.1`;
  let routeCalls = 0;
  const limiter = new RateLimit({
    limit: options.limit ?? 2,
    windowMs: 2_000,
    keyPrefix,
  });
  assert.equal(typeof limiter.middleware, 'function', 'Implement RateLimit.middleware() first.');

  const app = express();
  // Trust forwarded IPs only in the explicit proxy simulation test.
  app.set('trust proxy', options.trustProxy ? 'loopback' : false);
  app.post('/api/links', limiter.middleware(), (_req, res) => {
    routeCalls++;
    res.status(201).json({ message: 'Protected route reached.' });
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  // Port 0 lets the OS choose a free port; never use your running API's port.
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    const closed = new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
    server.closeAllConnections();
    await closed;
    const keys = await redis.keys(`${keyPrefix}:*`);
    if (keys.length) await redis.del(keys);
  });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    request: (headers: Record<string, string> = {}) => fetch(`${origin}/api/links`, { method: 'POST', headers }),
    health: () => fetch(`${origin}/api/health`),
    clientKey,
    routeCalls: () => routeCalls,
  };
}

test('HTTP: accepted requests return 201 and decreasing quota headers', async t => {
  const api = await setup(t);

  for (const remaining of ['1', '0']) {
    const response = await api.request();
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('ratelimit-limit'), '2');
    assert.equal(response.headers.get('ratelimit-remaining'), remaining);
    assert.equal(response.headers.get('ratelimit-reset'), '2');
    assert.equal(response.headers.get('retry-after'), null);
    assert.deepEqual(await response.json(), { message: 'Protected route reached.' });
  }
  assert.equal(api.routeCalls(), 2);
});

test('HTTP: exceeding the quota returns 429, retry headers, and a JSON error', async t => {
  const api = await setup(t);
  await api.request();
  await api.request();

  const response = await api.request();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('ratelimit-limit'), '2');
  assert.equal(response.headers.get('ratelimit-remaining'), '0');
  assert.equal(response.headers.get('ratelimit-reset'), '2');
  assert.equal(response.headers.get('retry-after'), '2');
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await response.json(), { error: 'Too many requests.' });
  assert.equal(api.routeCalls(), 2, 'Blocked requests must not execute the route handler.');
});

test('HTTP: retry headers round up seconds and rejections do not extend the window', async t => {
  const api = await setup(t, { limit: 1 });
  await api.request();
  await redis.pExpire(api.clientKey, 1_800);
  const ttlBefore = await redis.pTTL(api.clientKey);
  const first = await api.request();
  assert.equal(first.status, 429);
  assert.equal(first.headers.get('ratelimit-reset'), '2');

  assert.ok(await redis.pTTL(api.clientKey) <= ttlBefore, 'Rejection must not extend expiry.');
  await redis.pExpire(api.clientKey, 800);
  const second = await api.request();
  assert.equal(second.status, 429);
  assert.equal(second.headers.get('ratelimit-reset'), '1');
  assert.equal(second.headers.get('retry-after'), '1');
  assert.equal(second.headers.get('ratelimit-remaining'), '0');
});

test('HTTP: requests are accepted again after Redis expires the window', async t => {
  const api = await setup(t, { limit: 1 });
  await api.request();
  await redis.pExpire(api.clientKey, 800);
  assert.equal((await api.request()).status, 429);

  await delay(850);
  assert.equal(await redis.exists(api.clientKey), 0);
  const response = await api.request();
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('ratelimit-limit'), '1');
  assert.equal(response.headers.get('ratelimit-remaining'), '0');
  assert.equal(response.headers.get('ratelimit-reset'), '2');
  assert.equal(api.routeCalls(), 2);
});

test('HTTP: spoofed forwarding headers cannot bypass the quota without a trusted proxy', async t => {
  const api = await setup(t, { limit: 1 });
  assert.equal((await api.request({ 'X-Forwarded-For': '192.0.2.1' })).status, 201);

  const response = await api.request({ 'X-Forwarded-For': '192.0.2.2' });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('ratelimit-remaining'), '0');
  assert.equal(api.routeCalls(), 1);
});

test('HTTP: clients forwarded by a trusted local proxy have independent quotas', async t => {
  const api = await setup(t, { limit: 1, trustProxy: true });
  assert.equal((await api.request({ 'X-Forwarded-For': '192.0.2.1' })).status, 201);
  assert.equal((await api.request({ 'X-Forwarded-For': '192.0.2.1' })).status, 429);

  const otherClient = await api.request({ 'X-Forwarded-For': '192.0.2.2' });
  assert.equal(otherClient.status, 201);
  assert.equal(otherClient.headers.get('ratelimit-remaining'), '0');
  assert.equal(api.routeCalls(), 2);
});

test('HTTP: an unprotected health route remains available after the quota is exhausted', async t => {
  const api = await setup(t, { limit: 1 });
  await api.request();
  assert.equal((await api.request()).status, 429);

  const response = await api.health();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.equal(response.headers.get('ratelimit-limit'), null);
});

test('HTTP: concurrent requests execute the protected route only up to its quota', async t => {
  const api = await setup(t, { limit: 3 });
  const responses = await Promise.all(Array.from({ length: 10 }, () => api.request()));

  assert.equal(responses.filter(response => response.status === 201).length, 3);
  assert.equal(responses.filter(response => response.status === 429).length, 7);
  assert.equal(api.routeCalls(), 3);
  for (const response of responses.filter(response => response.status === 429)) {
    assert.equal(response.headers.get('ratelimit-limit'), '3');
    assert.equal(response.headers.get('ratelimit-remaining'), '0');
    assert.deepEqual(await response.json(), { error: 'Too many requests.' });
  }
});
