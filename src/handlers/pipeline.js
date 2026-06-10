import { FINISHED_STATUSES } from '../metrics.js';

/**
 * Converts a number-like value to a finite number, or returns undefined.
 */
function toNumber(value) {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Handles a GitLab `pipeline` webhook event and updates the relevant metrics.
 *
 * @see https://docs.gitlab.com/ee/user/project/integrations/webhook_events.html#pipeline-events
 */
export function handlePipelineEvent(payload, metrics) {
  const attrs = payload?.object_attributes ?? {};
  const labels = {
    project: payload?.project?.path_with_namespace ?? 'unknown',
    ref: attrs.ref ?? 'unknown',
    source: attrs.source ?? 'unknown',
  };
  const status = attrs.status ?? 'unknown';

  const id = toNumber(attrs.id);
  if (id !== undefined) metrics.pipelineId.set(labels, id);

  metrics.setPipelineStatus(labels, status);

  const duration = toNumber(attrs.duration);
  if (duration !== undefined) metrics.pipelineDuration.set(labels, duration);

  const queued = toNumber(attrs.queued_duration);
  if (queued !== undefined) metrics.pipelineQueuedDuration.set(labels, queued);

  if (FINISHED_STATUSES.has(status)) {
    metrics.pipelineRunCount.inc({ ...labels, status });
    const finishedAt = attrs.finished_at ? Date.parse(attrs.finished_at) : Date.now();
    if (!Number.isNaN(finishedAt)) {
      metrics.pipelineTimestamp.set(labels, finishedAt / 1000);
    }
  }

  return { ...labels, status };
}
