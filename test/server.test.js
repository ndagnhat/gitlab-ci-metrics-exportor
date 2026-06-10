import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics } from '../src/metrics.js';
import { createLogger } from '../src/logger.js';
import { createApp } from '../src/server.js';

const baseConfig = {
  metricsPath: '/metrics',
  webhookPath: '/webhook',
  webhookSecret: 'topsecret',
  bodyLimit: '1mb',
};

function startApp(overrides = {}) {
  const config = { ...baseConfig, ...overrides };
  const metrics = createMetrics({ defaultMetricsEnabled: false });
  const logger = createLogger('error');
  const app = createApp({ config, metrics, logger });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        metrics,
        url: (path) => `http://127.0.0.1:${port}${path}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test('rejects webhook with wrong token', async () => {
  const app = await startApp();
  try {
    const res = await fetch(app.url('/webhook'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Gitlab-Token': 'wrong' },
      body: JSON.stringify({ object_kind: 'pipeline' }),
    });
    assert.equal(res.status, 401);
  } finally {
    await app.close();
  }
});

test('accepts a valid pipeline webhook and reflects it in /metrics', async () => {
  const app = await startApp();
  try {
    const res = await fetch(app.url('/webhook'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Gitlab-Token': 'topsecret' },
      body: JSON.stringify({
        object_kind: 'pipeline',
        object_attributes: { id: 5, ref: 'main', source: 'push', status: 'running' },
        project: { path_with_namespace: 'group/app' },
      }),
    });
    assert.equal(res.status, 202);

    const metricsRes = await fetch(app.url('/metrics'));
    const text = await metricsRes.text();
    assert.match(text, /gitlab_ci_pipeline_id\{[^}]*\} 5/);
    assert.match(text, /gitlab_ci_webhook_events_total\{event="pipeline",result="processed"\} 1/);
  } finally {
    await app.close();
  }
});

test('ignores unsupported event kinds without failing', async () => {
  const app = await startApp();
  try {
    const res = await fetch(app.url('/webhook'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Gitlab-Token': 'topsecret' },
      body: JSON.stringify({ object_kind: 'push' }),
    });
    assert.equal(res.status, 202);

    const text = await (await fetch(app.url('/metrics'))).text();
    assert.match(text, /gitlab_ci_webhook_events_total\{event="push",result="ignored"\} 1/);
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
