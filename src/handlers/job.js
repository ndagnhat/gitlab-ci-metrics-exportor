import { FINISHED_STATUSES } from '../metrics.js';

function toNumber(value) {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Resolves a human-friendly runner label from the webhook payload.
 * Falls back gracefully across GitLab versions / shared vs specific runners.
 */
function runnerLabel(runner) {
  if (!runner) return 'none';
  return runner.description ?? (runner.id != null ? String(runner.id) : 'none');
}

/**
 * Handles a GitLab `build` (job) webhook event and updates the relevant metrics.
 *
 * `context.namespace` and `context.service` come from custom HTTP headers
 * configured on the GitLab webhook, identifying which team/service owns the
 * project that triggered the job.
 *
 * @see https://docs.gitlab.com/ee/user/project/integrations/webhook_events.html#job-events
 */
export function handleJobEvent(payload, metrics, context = {}) {
  const labels = {
    project: payload?.project?.path_with_namespace ?? payload?.project_name ?? 'unknown',
    ref: payload?.ref ?? 'unknown',
    stage: payload?.build_stage ?? 'unknown',
    name: payload?.build_name ?? 'unknown',
    runner: runnerLabel(payload?.runner),
    namespace: context.namespace || 'unknown',
    service: context.service || 'unknown',
  };
  const status = payload?.build_status ?? 'unknown';

  const id = toNumber(payload?.build_id);
  if (id !== undefined) metrics.jobId.set(labels, id);

  metrics.setJobStatus(labels, status);

  const duration = toNumber(payload?.build_duration);
  if (duration !== undefined) metrics.jobDuration.set(labels, duration);

  const queued = toNumber(payload?.build_queued_duration);
  if (queued !== undefined) metrics.jobQueuedDuration.set(labels, queued);

  if (FINISHED_STATUSES.has(status)) {
    metrics.jobRunCount.inc({ ...labels, status });
    const finishedAt = payload?.build_finished_at ? Date.parse(payload.build_finished_at) : Date.now();
    if (!Number.isNaN(finishedAt)) {
      metrics.jobTimestamp.set(labels, finishedAt / 1000);
    }
  }

  return { ...labels, status };
}
