import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createMetrics } from './metrics.js';
import { createApp } from './server.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const metrics = createMetrics({ defaultMetricsEnabled: config.defaultMetricsEnabled });
const app = createApp({ config, metrics, logger });

const server = app.listen(config.port, config.host, () => {
  logger.info('gitlab-ci-metrics-exporter started', {
    host: config.host,
    port: config.port,
    metricsPath: config.metricsPath,
    webhookPath: config.webhookPath,
    tokenAuth: Boolean(config.webhookSecret),
  });
});

function shutdown(signal) {
  logger.info('shutting down', { signal });
  server.close(() => process.exit(0));
  // Force exit if connections do not drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
