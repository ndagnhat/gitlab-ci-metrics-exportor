import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createMetricsStore } from './metrics-store.js';
import { loadSnapshot, saveSnapshot } from './persistence.js';
import { createApp } from './server.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const metricsStore = createMetricsStore({ defaultMetricsEnabled: config.defaultMetricsEnabled });

if (config.persistencePath) {
  try {
    const snapshot = await loadSnapshot(config.persistencePath);
    if (snapshot) {
      metricsStore.importState(snapshot);
      logger.info('restored metrics snapshot', {
        path: config.persistencePath,
        metrics: snapshot.metrics?.length ?? 0,
      });
    }
  } catch (err) {
    logger.warn('failed to restore metrics snapshot', { path: config.persistencePath, error: err.message });
  }
}

const app = createApp({ config, metricsStore, logger });

const server = app.listen(config.port, config.host, () => {
  logger.info('metrics-push-exporter started', {
    host: config.host,
    port: config.port,
    metricsPath: config.metricsPath,
    tokenAuth: Boolean(config.authToken),
    persistence: Boolean(config.persistencePath),
  });
});

let persistenceTimer;
if (config.persistencePath) {
  const persist = () =>
    saveSnapshot(config.persistencePath, metricsStore.exportState()).catch((err) => {
      logger.warn('failed to save metrics snapshot', { path: config.persistencePath, error: err.message });
    });

  persistenceTimer = setInterval(persist, config.persistenceIntervalMs);
  persistenceTimer.unref();
}

function shutdown(signal) {
  logger.info('shutting down', { signal });
  if (persistenceTimer) clearInterval(persistenceTimer);

  const finish = () => server.close(() => process.exit(0));
  if (config.persistencePath) {
    saveSnapshot(config.persistencePath, metricsStore.exportState())
      .catch((err) => logger.warn('failed to save metrics snapshot', { path: config.persistencePath, error: err.message }))
      .finally(finish);
  } else {
    finish();
  }
  // Force exit if connections do not drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
