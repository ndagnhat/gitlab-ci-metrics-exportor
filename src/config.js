/**
 * Loads runtime configuration from environment variables.
 * Every option has a sensible default so the exporter can run with zero config.
 */
export function loadConfig(env = process.env) {
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number.parseInt(env.PORT ?? '9252', 10),
    // Path used for both scraping (GET) and pushing metrics (POST).
    metricsPath: env.METRICS_PATH ?? '/metrics',
    // Bearer token required on pushes via the `Authorization: Bearer <token>`
    // header. When empty, push authentication is disabled.
    authToken: env.PUSH_AUTH_TOKEN ?? '',
    // Maximum accepted request body size.
    bodyLimit: env.BODY_LIMIT ?? '1mb',
    logLevel: env.LOG_LEVEL ?? 'info',
    // Whether to expose default Node.js process metrics alongside pushed metrics.
    defaultMetricsEnabled: (env.DEFAULT_METRICS ?? 'true') === 'true',
    // File path used to persist/restore pushed metrics across restarts.
    // Empty disables persistence (metrics are lost on restart).
    persistencePath: env.PERSISTENCE_PATH ?? '',
    // How often (ms) to write the metrics snapshot to PERSISTENCE_PATH.
    persistenceIntervalMs: Number.parseInt(env.PERSISTENCE_INTERVAL_MS ?? '30000', 10),
  };
}
