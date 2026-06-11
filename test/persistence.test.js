import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMetricsStore } from '../src/metrics-store.js';
import { loadSnapshot, saveSnapshot } from '../src/persistence.js';

test('loadSnapshot returns null when the file does not exist', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'metrics-snapshot-'));
  try {
    const result = await loadSnapshot(join(dir, 'missing.json'));
    assert.equal(result, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('saveSnapshot/loadSnapshot round-trip restores pushed metrics after a restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'metrics-snapshot-'));
  const file = join(dir, 'snapshot.json');
  try {
    const store = createMetricsStore({ defaultMetricsEnabled: false });
    store.push({ name: 'jobs_processed_total', type: 'counter', labels: { status: 'success' }, value: 3 });
    store.push({ name: 'queue_size', type: 'gauge', labels: { queue: 'emails' }, value: 9 });

    await saveSnapshot(file, store.exportState());

    // Simulate a pod restart: a fresh store loads the persisted snapshot.
    const restored = createMetricsStore({ defaultMetricsEnabled: false });
    const snapshot = await loadSnapshot(file);
    restored.importState(snapshot);

    const text = await restored.registry.metrics();
    assert.match(text, /jobs_processed_total\{status="success"\} 3/);
    assert.match(text, /queue_size\{queue="emails"\} 9/);

    // Counter keeps accumulating from the restored value.
    restored.push({ name: 'jobs_processed_total', labels: { status: 'success' }, value: 2 });
    const text2 = await restored.registry.metrics();
    assert.match(text2, /jobs_processed_total\{status="success"\} 5/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
