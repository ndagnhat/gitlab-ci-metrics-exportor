import { Registry, Counter, Gauge, collectDefaultMetrics } from 'prom-client';

// Possible pipeline statuses reported by GitLab in webhook events.
export const PIPELINE_STATUSES = [
  'created',
  'waiting_for_resource',
  'preparing',
  'pending',
  'running',
  'success',
  'failed',
  'canceled',
  'skipped',
  'manual',
  'scheduled',
];

// Possible job (build) statuses reported by GitLab in webhook events.
export const JOB_STATUSES = [
  'created',
  'pending',
  'running',
  'success',
  'failed',
  'canceled',
  'skipped',
  'manual',
];

// Statuses considered terminal — used to bump run counters and timestamps.
export const FINISHED_STATUSES = new Set(['success', 'failed', 'canceled', 'skipped']);

const PIPELINE_LABELS = ['project', 'ref', 'source', 'env', 'namespace', 'service'];
const JOB_LABELS = ['project', 'ref', 'stage', 'name', 'runner'];

/**
 * Creates a fresh metrics registry plus all the GitLab CI metric collectors.
 * Returning a self-contained object makes the metrics easy to unit test in
 * isolation (each test gets its own registry, no global state).
 */
export function createMetrics({ defaultMetricsEnabled = true } = {}) {
  const registry = new Registry();
  if (defaultMetricsEnabled) collectDefaultMetrics({ register: registry });

  // --- Pipeline metrics -----------------------------------------------------
  const pipelineId = new Gauge({
    name: 'gitlab_ci_pipeline_id',
    help: 'ID of the most recent GitLab CI pipeline for a ref',
    labelNames: PIPELINE_LABELS,
    registers: [registry],
  });
  const pipelineStatus = new Gauge({
    name: 'gitlab_ci_pipeline_status',
    help: 'Current pipeline status (value is 1 for the active status, the series is removed otherwise)',
    labelNames: [...PIPELINE_LABELS, 'status'],
    registers: [registry],
  });
  const pipelineDuration = new Gauge({
    name: 'gitlab_ci_pipeline_duration_seconds',
    help: 'Duration in seconds of the most recent pipeline',
    labelNames: PIPELINE_LABELS,
    registers: [registry],
  });
  const pipelineQueuedDuration = new Gauge({
    name: 'gitlab_ci_pipeline_queued_duration_seconds',
    help: 'Time in seconds the most recent pipeline spent queued before running',
    labelNames: PIPELINE_LABELS,
    registers: [registry],
  });
  const pipelineTimestamp = new Gauge({
    name: 'gitlab_ci_pipeline_timestamp',
    help: 'Unix timestamp (seconds) at which the most recent pipeline finished',
    labelNames: PIPELINE_LABELS,
    registers: [registry],
  });
  const pipelineRunCount = new Counter({
    name: 'gitlab_ci_pipeline_run_count',
    help: 'Total number of finished pipeline runs observed, by final status',
    labelNames: [...PIPELINE_LABELS, 'status'],
    registers: [registry],
  });

  // --- Job (build) metrics --------------------------------------------------
  const jobId = new Gauge({
    name: 'gitlab_ci_job_id',
    help: 'ID of the most recent job',
    labelNames: JOB_LABELS,
    registers: [registry],
  });
  const jobStatus = new Gauge({
    name: 'gitlab_ci_job_status',
    help: 'Current job status (value is 1 for the active status, the series is removed otherwise)',
    labelNames: [...JOB_LABELS, 'status'],
    registers: [registry],
  });
  const jobDuration = new Gauge({
    name: 'gitlab_ci_job_duration_seconds',
    help: 'Duration in seconds of the most recent job',
    labelNames: JOB_LABELS,
    registers: [registry],
  });
  const jobQueuedDuration = new Gauge({
    name: 'gitlab_ci_job_queued_duration_seconds',
    help: 'Time in seconds the most recent job spent queued before running',
    labelNames: JOB_LABELS,
    registers: [registry],
  });
  const jobTimestamp = new Gauge({
    name: 'gitlab_ci_job_timestamp',
    help: 'Unix timestamp (seconds) at which the most recent job finished',
    labelNames: JOB_LABELS,
    registers: [registry],
  });
  const jobRunCount = new Counter({
    name: 'gitlab_ci_job_run_count',
    help: 'Total number of finished job runs observed, by final status',
    labelNames: [...JOB_LABELS, 'status'],
    registers: [registry],
  });

  // --- Exporter self metrics ------------------------------------------------
  const webhookEvents = new Counter({
    name: 'gitlab_ci_webhook_events_total',
    help: 'Total number of GitLab webhook events received, by kind and result',
    labelNames: ['event', 'result'],
    registers: [registry],
  });

  /**
   * Sets exactly one active status series to 1 and removes the others, so a
   * given pipeline never appears to be in two states at once.
   */
  function setPipelineStatus(labels, status) {
    for (const s of PIPELINE_STATUSES) {
      if (s === status) pipelineStatus.set({ ...labels, status: s }, 1);
      else pipelineStatus.remove({ ...labels, status: s });
    }
    if (!PIPELINE_STATUSES.includes(status)) {
      pipelineStatus.set({ ...labels, status }, 1);
    }
  }

  function setJobStatus(labels, status) {
    for (const s of JOB_STATUSES) {
      if (s === status) jobStatus.set({ ...labels, status: s }, 1);
      else jobStatus.remove({ ...labels, status: s });
    }
    if (!JOB_STATUSES.includes(status)) {
      jobStatus.set({ ...labels, status }, 1);
    }
  }

  return {
    registry,
    pipelineId,
    pipelineStatus,
    pipelineDuration,
    pipelineQueuedDuration,
    pipelineTimestamp,
    pipelineRunCount,
    jobId,
    jobStatus,
    jobDuration,
    jobQueuedDuration,
    jobTimestamp,
    jobRunCount,
    webhookEvents,
    setPipelineStatus,
    setJobStatus,
  };
}
