import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createMetricsStore } from './metrics-store.js';
import { createApp } from './server.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const metricsStore = createMetricsStore({ defaultMetricsEnabled: config.defaultMetricsEnabled });
const app = createApp({ config, metricsStore, logger });

const server = app.listen(config.port, config.host, () => {
  logger.info('metrics-push-exporter started', {
    host: config.host,
    port: config.port,
    metricsPath: config.metricsPath,
    tokenAuth: Boolean(config.authToken),
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
