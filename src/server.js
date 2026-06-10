import crypto from 'node:crypto';
import express from 'express';
import { handlePipelineEvent } from './handlers/pipeline.js';
import { handleJobEvent } from './handlers/job.js';

/**
 * Constant-time string comparison to avoid leaking the secret via timing.
 */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Builds the Express application. Kept separate from the listening logic so it
 * can be exercised directly in tests.
 */
export function createApp({ config, metrics, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: config.bodyLimit }));

  // Liveness/readiness probe.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Prometheus scrape endpoint.
  app.get(config.metricsPath, async (_req, res) => {
    try {
      res.set('Content-Type', metrics.registry.contentType);
      res.end(await metrics.registry.metrics());
    } catch (err) {
      logger.error('failed to render metrics', { error: err.message });
      res.status(500).end();
    }
  });

  // GitLab webhook receiver.
  app.post(config.webhookPath, (req, res) => {
    if (config.webhookSecret && !safeEqual(req.get('X-Gitlab-Token'), config.webhookSecret)) {
      metrics.webhookEvents.inc({ event: 'unknown', result: 'rejected' });
      logger.warn('rejected webhook with invalid token');
      res.status(401).json({ error: 'invalid token' });
      return;
    }

    const kind = req.body?.object_kind ?? 'unknown';
    const context = {
      namespace: req.get(config.namespaceHeader),
      service: req.get(config.serviceHeader),
    };

    try {
      switch (kind) {
        case 'pipeline': {
          const info = handlePipelineEvent(req.body, metrics, context);
          metrics.webhookEvents.inc({ event: kind, result: 'processed' });
          logger.info('processed pipeline event', info);
          break;
        }
        case 'build': {
          const info = handleJobEvent(req.body, metrics, context);
          metrics.webhookEvents.inc({ event: kind, result: 'processed' });
          logger.info('processed job event', info);
          break;
        }
        default:
          metrics.webhookEvents.inc({ event: kind, result: 'ignored' });
          logger.debug('ignored unsupported event', { kind });
      }
      res.status(202).json({ status: 'accepted', kind });
    } catch (err) {
      metrics.webhookEvents.inc({ event: kind, result: 'error' });
      logger.error('failed to process webhook', { kind, error: err.message });
      res.status(500).json({ error: 'processing failed' });
    }
  });

  return app;
}
