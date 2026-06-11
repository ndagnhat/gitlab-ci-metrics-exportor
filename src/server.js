import crypto from 'node:crypto';
import express from 'express';

/**
 * Constant-time string comparison to avoid leaking the auth token via timing.
 */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function extractBearerToken(req) {
  const header = req.get('Authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
}

/**
 * Builds the Express application. Kept separate from the listening logic so it
 * can be exercised directly in tests.
 */
export function createApp({ config, metricsStore, logger }) {
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
      res.set('Content-Type', metricsStore.registry.contentType);
      res.end(await metricsStore.registry.metrics());
    } catch (err) {
      logger.error('failed to render metrics', { error: err.message });
      res.status(500).end();
    }
  });

  // Generic metric push endpoint. Accepts a single metric object, or a batch
  // as either a JSON array or `{ "metrics": [...] }`.
  app.post(config.metricsPath, (req, res) => {
    if (config.authToken && !safeEqual(extractBearerToken(req), config.authToken)) {
      logger.warn('rejected metric push with invalid token');
      res.status(401).json({ error: 'invalid or missing token' });
      return;
    }

    const body = req.body;
    let items;
    if (Array.isArray(body)) items = body;
    else if (body && Array.isArray(body.metrics)) items = body.metrics;
    else items = [body];

    if (items.length === 0) {
      res.status(400).json({ error: 'no metrics provided' });
      return;
    }

    let applied = 0;
    for (const item of items) {
      try {
        const info = metricsStore.push(item ?? {});
        logger.debug('pushed metric', info);
        applied++;
      } catch (err) {
        logger.warn('rejected metric push', { error: err.message, index: applied });
        res.status(400).json({ error: err.message, index: applied, applied });
        return;
      }
    }

    res.status(202).json({ status: 'accepted', count: applied });
  });

  return app;
}
