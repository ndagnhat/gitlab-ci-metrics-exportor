import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetricsStore } from '../src/metrics-store.js';
import { createLogger } from '../src/logger.js';
import { createApp } from '../src/server.js';

const baseConfig = {
  metricsPath: '/metrics',
  authToken: 'topsecret',
  bodyLimit: '1mb',
};

function startApp(overrides = {}) {
  const config = { ...baseConfig, ...overrides };
  const metricsStore = createMetricsStore({ defaultMetricsEnabled: false });
  const logger = createLogger('error');
  const app = createApp({ config, metricsStore, logger });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        metricsStore,
        url: (path) => `http://127.0.0.1:${port}${path}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test('rejects push with missing/invalid auth token', async () => {
  const app = await startApp();
  try {
    const res = await fetch(app.url('/metrics'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'm', type: 'gauge', value: 1 }),
    });
    assert.equal(res.status, 401);
  } finally {
    await app.close();
  }
});

test('pushes a single gauge metric and reflects it in /metrics', async () => {
  const app = await startApp();
  try {
    const res = await fetch(app.url('/metrics'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer topsecret' },
      body: JSON.stringify({
        name: 'queue_size',
        type: 'gauge',
        help: 'Items in queue',
        labels: { queue: 'emails' },
        value: 5,
      }),
    });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { status: 'accepted', count: 1 });

    const text = await (await fetch(app.url('/metrics'))).text();
    assert.match(text, /queue_size\{queue="emails"\} 5/);
  } finally {
    await app.close();
  }
});

test('pushes a batch of metrics via { metrics: [...] }', async () => {
  const app = await startApp();
  try {
    const res = await fetch(app.url('/metrics'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer topsecret' },
      body: JSON.stringify({
        metrics: [
          { name: 'jobs_total', type: 'counter', labels: { status: 'success' }, value: 3 },
          { name: 'jobs_total', type: 'counter', labels: { status: 'failed' }, value: 1 },
        ],
      }),
    });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { status: 'accepted', count: 2 });

    const text = await (await fetch(app.url('/metrics'))).text();
    assert.match(text, /jobs_total\{status="success"\} 3/);
    assert.match(text, /jobs_total\{status="failed"\} 1/);
  } finally {
    await app.close();
  }
});

test('rejects an invalid push with a descriptive error', async () => {
  const app = await startApp();
  try {
    const res = await fetch(app.url('/metrics'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer topsecret' },
      body: JSON.stringify({ name: 'bad metric name', type: 'gauge', value: 1 }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /invalid metric name/);
  } finally {
    await app.close();
  }
});

test('works without auth when authToken is empty', async () => {
  const app = await startApp({ authToken: '' });
  try {
    const res = await fetch(app.url('/metrics'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'm', type: 'gauge', value: 1 }),
    });
    assert.equal(res.status, 202);
  } finally {
    await app.close();
  }
});

test('health endpoint responds ok', async () => {
  const app = await startApp();
  try {
    const res = await fetch(app.url('/health'));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  } finally {
    await app.close();
  }
});
