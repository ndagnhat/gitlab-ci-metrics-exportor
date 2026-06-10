/**
 * Loads runtime configuration from environment variables.
 * Every option has a sensible default so the exporter can run with zero config.
 */
export function loadConfig(env = process.env) {
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number.parseInt(env.PORT ?? '9252', 10),
    // Path that exposes the Prometheus metrics.
    metricsPath: env.METRICS_PATH ?? '/metrics',
    // Path that receives GitLab webhook POST requests.
    webhookPath: env.WEBHOOK_PATH ?? '/webhook',
    // Secret token GitLab sends in the `X-Gitlab-Token` header.
    // When empty, token validation is disabled (not recommended in production).
    webhookSecret: env.GITLAB_WEBHOOK_SECRET ?? '',
    // Maximum accepted webhook body size.
    bodyLimit: env.BODY_LIMIT ?? '5mb',
    logLevel: env.LOG_LEVEL ?? 'info',
    // Whether to expose default Node.js process metrics alongside the GitLab ones.
    defaultMetricsEnabled: (env.DEFAULT_METRICS ?? 'true') === 'true',
  };
}
