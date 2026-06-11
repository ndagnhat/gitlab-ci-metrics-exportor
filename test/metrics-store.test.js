import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetricsStore } from '../src/metrics-store.js';

test('gauge: registers on first push and supports set/inc/dec', async () => {
  const store = createMetricsStore({ defaultMetricsEnabled: false });

  store.push({ name: 'queue_size', type: 'gauge', help: 'Items in queue', labels: { queue: 'emails' }, value: 5 });
  store.push({ name: 'queue_size', labels: { queue: 'emails' }, value: 2, method: 'inc' });
  store.push({ name: 'queue_size', labels: { queue: 'emails' }, value: 1, method: 'dec' });

  const text = await store.registry.metrics();
  assert.match(text, /# HELP queue_size Items in queue/);
  assert.match(text, /# TYPE queue_size gauge/);
  assert.match(text, /queue_size\{queue="emails"\} 6/);
});

test('counter: registers on first push, accumulates, and rejects negative values', async () => {
  const store = createMetricsStore({ defaultMetricsEnabled: false });

  store.push({ name: 'jobs_processed_total', type: 'counter', labels: { status: 'success' } }); // value defaults to 1
  store.push({ name: 'jobs_processed_total', labels: { status: 'success' }, value: 4 });

  const text = await store.registry.metrics();
  assert.match(text, /# TYPE jobs_processed_total counter/);
  assert.match(text, /jobs_processed_total\{status="success"\} 5/);

  assert.throws(
    () => store.push({ name: 'jobs_processed_total', labels: { status: 'success' }, value: -1 }),
    /negative/,
  );
});

test('histogram: registers with custom buckets and records observations', async () => {
  const store = createMetricsStore({ defaultMetricsEnabled: false });

  store.push({
    name: 'request_duration_seconds',
    type: 'histogram',
    labels: { route: '/api' },
    value: 0.2,
    buckets: [0.1, 0.5, 1],
  });
  store.push({ name: 'request_duration_seconds', labels: { route: '/api' }, value: 0.7 });

  const text = await store.registry.metrics();
  assert.match(text, /# TYPE request_duration_seconds histogram/);
  assert.match(text, /request_duration_seconds_bucket\{le="0.1",route="\/api"\} 0/);
  assert.match(text, /request_duration_seconds_bucket\{le="0.5",route="\/api"\} 1/);
  assert.match(text, /request_duration_seconds_bucket\{le="1",route="\/api"\} 2/);
  assert.match(text, /request_duration_seconds_count\{route="\/api"\} 2/);
});

test('rejects pushes for an unregistered metric without a type', () => {
  const store = createMetricsStore({ defaultMetricsEnabled: false });
  assert.throws(() => store.push({ name: 'unknown_metric', value: 1 }), /not registered yet/);
});

test('rejects type changes after registration', () => {
  const store = createMetricsStore({ defaultMetricsEnabled: false });
  store.push({ name: 'm', type: 'gauge', value: 1 });
  assert.throws(() => store.push({ name: 'm', type: 'counter', value: 1 }), /already registered as "gauge"/);
});

test('rejects label set changes after registration', () => {
  const store = createMetricsStore({ defaultMetricsEnabled: false });
  store.push({ name: 'm', type: 'gauge', labels: { a: '1' }, value: 1 });
  assert.throws(() => store.push({ name: 'm', labels: { a: '1', b: '2' }, value: 1 }), /expects labels \[a\]/);
});

test('rejects invalid metric and label names', () => {
  const store = createMetricsStore({ defaultMetricsEnabled: false });
  assert.throws(() => store.push({ name: '1-invalid', type: 'gauge', value: 1 }), /invalid metric name/);
  assert.throws(
    () => store.push({ name: 'valid_name', type: 'gauge', labels: { 'bad-label': 'x' }, value: 1 }),
    /invalid label name/,
  );
});

test('rejects unsupported types and methods', () => {
  const store = createMetricsStore({ defaultMetricsEnabled: false });
  assert.throws(() => store.push({ name: 'm', type: 'summary', value: 1 }), /unsupported type/);

  store.push({ name: 'c', type: 'counter', value: 1 });
  assert.throws(() => store.push({ name: 'c', value: 1, method: 'dec' }), /only supports method "inc"/);

  store.push({ name: 'g', type: 'gauge', value: 1 });
  assert.throws(() => store.push({ name: 'g', value: 1, method: 'observe' }), /supports methods "set", "inc", "dec"/);
});
