import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics } from '../src/metrics.js';
import { handlePipelineEvent } from '../src/handlers/pipeline.js';
import { handleJobEvent } from '../src/handlers/job.js';

test('pipeline event exposes the expected metrics', async () => {
  const metrics = createMetrics({ defaultMetricsEnabled: false });

  handlePipelineEvent(
    {
      object_kind: 'pipeline',
      object_attributes: {
        id: 123,
        name: 'Prod pipeline',
        ref: 'main',
        source: 'push',
        status: 'success',
        duration: 42,
        queued_duration: 3,
        finished_at: '2026-06-10T10:00:00Z',
      },
      project: { path_with_namespace: 'group/app' },
    },
    metrics,
    { namespace: 'platform', service: 'checkout' },
  );

  const text = await metrics.registry.metrics();
  assert.match(
    text,
    /gitlab_ci_pipeline_id\{project="group\/app",ref="main",source="push",env="prod",namespace="platform",service="checkout"\} 123/,
  );
  assert.match(
    text,
    /gitlab_ci_pipeline_status\{project="group\/app",ref="main",source="push",env="prod",namespace="platform",service="checkout",status="success"\} 1/,
  );
  assert.match(text, /gitlab_ci_pipeline_duration_seconds\{[^}]*\} 42/);
  assert.match(text, /gitlab_ci_pipeline_queued_duration_seconds\{[^}]*\} 3/);
  assert.match(text, /gitlab_ci_pipeline_run_count\{[^}]*status="success"\} 1/);
  const expectedTs = Date.parse('2026-06-10T10:00:00Z') / 1000;
  assert.match(text, new RegExp(`gitlab_ci_pipeline_timestamp\\{[^}]*\\} ${expectedTs}`));
});

test('pipeline status is mutually exclusive across updates', async () => {
  const metrics = createMetrics({ defaultMetricsEnabled: false });
  const base = {
    object_kind: 'pipeline',
    project: { path_with_namespace: 'group/app' },
  };

  handlePipelineEvent({ ...base, object_attributes: { id: 1, ref: 'main', source: 'push', status: 'running' } }, metrics);
  handlePipelineEvent({ ...base, object_attributes: { id: 1, ref: 'main', source: 'push', status: 'success' } }, metrics);

  const text = await metrics.registry.metrics();
  assert.doesNotMatch(text, /gitlab_ci_pipeline_status\{[^}]*status="running"\} 1/);
  assert.match(text, /gitlab_ci_pipeline_status\{[^}]*status="success"\} 1/);
});

test('job event exposes the expected metrics', async () => {
  const metrics = createMetrics({ defaultMetricsEnabled: false });

  handleJobEvent(
    {
      object_kind: 'build',
      ref: 'main',
      build_id: 999,
      build_name: 'unit-tests',
      build_stage: 'test',
      build_status: 'failed',
      build_duration: 12.5,
      build_queued_duration: 1.2,
      build_finished_at: '2026-06-10T10:05:00Z',
      project: { path_with_namespace: 'group/app' },
      runner: { id: 7, description: 'shared-runner' },
    },
    metrics,
    { namespace: 'platform', service: 'checkout' },
  );

  const text = await metrics.registry.metrics();
  assert.match(
    text,
    /gitlab_ci_job_id\{[^}]*name="unit-tests"[^}]*namespace="platform",service="checkout"\} 999/,
  );
  assert.match(text, /gitlab_ci_job_status\{[^}]*runner="shared-runner"[^}]*status="failed"\} 1/);
  assert.match(text, /gitlab_ci_job_duration_seconds\{[^}]*\} 12.5/);
  assert.match(text, /gitlab_ci_job_run_count\{[^}]*status="failed"\} 1/);
});

test('pipeline env label is derived from object_attributes.name', async () => {
  const cases = [
    ['Prod pipeline', 'prod'],
    ['Staging Pipeline', 'staging'],
    ['Pre-Prod   pipeline', 'pre-prod'],
    [undefined, 'unknown'],
    ['', 'unknown'],
    ['custom-name', 'custom-name'],
  ];

  for (const [name, expectedEnv] of cases) {
    const metrics = createMetrics({ defaultMetricsEnabled: false });
    handlePipelineEvent(
      {
        object_kind: 'pipeline',
        object_attributes: { id: 1, name, ref: 'main', source: 'push', status: 'running' },
        project: { path_with_namespace: 'group/app' },
      },
      metrics,
    );
    const text = await metrics.registry.metrics();
    assert.match(
      text,
      new RegExp(`gitlab_ci_pipeline_id\\{[^}]*env="${expectedEnv}"[^}]*\\} 1`),
      `expected env="${expectedEnv}" for name=${JSON.stringify(name)}`,
    );
  }
});

test('pipeline namespace/service labels come from webhook context, defaulting to unknown', async () => {
  const metrics = createMetrics({ defaultMetricsEnabled: false });
  const event = {
    object_kind: 'pipeline',
    object_attributes: { id: 1, ref: 'main', source: 'push', status: 'running' },
    project: { path_with_namespace: 'group/app' },
  };

  handlePipelineEvent(event, metrics);
  let text = await metrics.registry.metrics();
  assert.match(text, /gitlab_ci_pipeline_id\{[^}]*namespace="unknown",service="unknown"\} 1/);

  const metrics2 = createMetrics({ defaultMetricsEnabled: false });
  handlePipelineEvent(event, metrics2, { namespace: 'platform', service: 'checkout' });
  text = await metrics2.registry.metrics();
  assert.match(text, /gitlab_ci_pipeline_id\{[^}]*namespace="platform",service="checkout"\} 1/);
});

test('job namespace/service labels come from webhook context, defaulting to unknown', async () => {
  const metrics = createMetrics({ defaultMetricsEnabled: false });
  const event = {
    object_kind: 'build',
    ref: 'main',
    build_id: 1,
    build_name: 'unit-tests',
    build_stage: 'test',
    build_status: 'running',
    project: { path_with_namespace: 'group/app' },
  };

  handleJobEvent(event, metrics);
  let text = await metrics.registry.metrics();
  assert.match(text, /gitlab_ci_job_id\{[^}]*namespace="unknown",service="unknown"\} 1/);

  const metrics2 = createMetrics({ defaultMetricsEnabled: false });
  handleJobEvent(event, metrics2, { namespace: 'platform', service: 'checkout' });
  text = await metrics2.registry.metrics();
  assert.match(text, /gitlab_ci_job_id\{[^}]*namespace="platform",service="checkout"\} 1/);
});

test('handlers tolerate missing/partial fields', () => {
  const metrics = createMetrics({ defaultMetricsEnabled: false });
  assert.doesNotThrow(() => handlePipelineEvent({}, metrics));
  assert.doesNotThrow(() => handleJobEvent({}, metrics));
});
