# gitlab-ci-metrics-exporter

A lightweight **Prometheus exporter** written in **Node.js**, inspired by
[radiofrance/gitlab-ci-pipelines-exporter](https://github.com/radiofrance/gitlab-ci-pipelines-exporter).

Instead of polling the GitLab API, it **receives GitLab webhook payloads**
(pipeline and job events) and turns them into Prometheus metrics in real time.
This avoids API rate limits and gives you metrics the moment a pipeline or job
changes state.

## How it works

```
GitLab ──(webhook: pipeline / job events)──▶ /webhook ──▶ in-memory metrics ──▶ /metrics ──▶ Prometheus
```

1. You configure a **webhook** on a GitLab project/group pointing at this
   exporter's `/webhook` endpoint, with **Pipeline events** and **Job events**
   enabled.
2. The exporter validates the secret token, parses the payload, and updates its
   metrics.
3. Prometheus scrapes `/metrics`.

## Quick start

```bash
npm install
GITLAB_WEBHOOK_SECRET=mysecret npm start
# exporter listening on :9252
```

Send it a sample event:

```bash
curl -X POST http://localhost:9252/webhook \
  -H "Content-Type: application/json" \
  -H "X-Gitlab-Token: mysecret" \
  -H "X-Namespace: platform" \
  -H "X-Service: checkout" \
  --data @examples/pipeline-event.json

curl -s http://localhost:9252/metrics | grep gitlab_ci
```

### Docker

```bash
docker build -t gitlab-ci-metrics-exporter .
docker run -p 9252:9252 -e GITLAB_WEBHOOK_SECRET=mysecret gitlab-ci-metrics-exporter
```

A prebuilt image is published to GitHub Container Registry on every push to
`main` and on version tags (see `.github/workflows/docker-publish.yml`):

```bash
docker run -p 9252:9252 -e GITLAB_WEBHOOK_SECRET=mysecret \
  ghcr.io/<owner>/<repo>:latest
```

Or with the bundled Prometheus:

```bash
GITLAB_WEBHOOK_SECRET=mysecret docker compose up
```

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable                | Default     | Description                                              |
| ----------------------- | ----------- | -------------------------------------------------------- |
| `HOST`                  | `0.0.0.0`   | Bind address                                             |
| `PORT`                  | `9252`      | Bind port                                                |
| `METRICS_PATH`          | `/metrics`  | Prometheus scrape path                                   |
| `WEBHOOK_PATH`          | `/webhook`  | GitLab webhook receiver path                             |
| `GITLAB_WEBHOOK_SECRET` | _(empty)_   | Expected `X-Gitlab-Token`. Empty disables token checks   |
| `BODY_LIMIT`            | `5mb`       | Max webhook body size                                    |
| `NAMESPACE_HEADER`      | `X-Namespace` | HTTP header read for the `namespace` pipeline label    |
| `SERVICE_HEADER`        | `X-Service` | HTTP header read for the `service` pipeline label        |
| `LOG_LEVEL`             | `info`      | `error` \| `warn` \| `info` \| `debug`                   |
| `DEFAULT_METRICS`       | `true`      | Also expose default Node.js process metrics              |

## Exposed metrics

### Pipeline metrics

Labels: `project`, `ref`, `source`, `env`, `namespace`, `service` (`status` added where noted).

- `env` is derived from the pipeline's `object_attributes.name` (set via the
  `workflow:name` keyword), e.g. `"Prod pipeline"` → `env="prod"`. Falls back
  to `"unknown"` when no name is set.
- `namespace` and `service` come from the `X-Namespace` / `X-Service` custom
  HTTP headers (configurable via `NAMESPACE_HEADER` / `SERVICE_HEADER`) sent
  by the GitLab webhook. Falls back to `"unknown"` when not present.

| Metric                                       | Type    | Description                                          |
| -------------------------------------------- | ------- | ---------------------------------------------------- |
| `gitlab_ci_pipeline_id`                      | gauge   | ID of the most recent pipeline                       |
| `gitlab_ci_pipeline_status{status}`          | gauge   | `1` for the active status, series removed otherwise  |
| `gitlab_ci_pipeline_duration_seconds`        | gauge   | Duration of the most recent pipeline                 |
| `gitlab_ci_pipeline_queued_duration_seconds` | gauge   | Queued time of the most recent pipeline              |
| `gitlab_ci_pipeline_timestamp`               | gauge   | Unix time the most recent pipeline finished          |
| `gitlab_ci_pipeline_run_count{status}`       | counter | Finished pipeline runs, by final status              |

### Job (build) metrics

Labels: `project`, `ref`, `stage`, `name`, `runner` (`status` added where noted).

| Metric                                  | Type    | Description                                         |
| --------------------------------------- | ------- | -------------------------------------------------- |
| `gitlab_ci_job_id`                      | gauge   | ID of the most recent job                          |
| `gitlab_ci_job_status{status}`          | gauge   | `1` for the active status, series removed otherwise|
| `gitlab_ci_job_duration_seconds`        | gauge   | Duration of the most recent job                    |
| `gitlab_ci_job_queued_duration_seconds` | gauge   | Queued time of the most recent job                 |
| `gitlab_ci_job_timestamp`               | gauge   | Unix time the most recent job finished             |
| `gitlab_ci_job_run_count{status}`       | counter | Finished job runs, by final status                 |

### Exporter metrics

| Metric                                          | Type    | Description                                                         |
| ----------------------------------------------- | ------- | ------------------------------------------------------------------ |
| `gitlab_ci_webhook_events_total{event,result}`  | counter | Webhook events received (`processed`/`ignored`/`rejected`/`error`) |

## Setting up the GitLab webhook

1. Go to **Project (or Group) → Settings → Webhooks**.
2. **URL**: `https://<your-exporter-host>/webhook`
3. **Secret token**: the same value as `GITLAB_WEBHOOK_SECRET`.
4. Enable **Pipeline events** and **Job events**.
5. (Optional) Under **Custom headers**, add headers named `X-Namespace` and
   `X-Service` (or whatever you set `NAMESPACE_HEADER` / `SERVICE_HEADER` to)
   with values identifying the owning team/service, e.g. `platform` /
   `checkout`. These populate the `namespace` and `service` labels on
   pipeline metrics.
6. Save, then use **Test** to send a sample event.

## Example PromQL

```promql
# Pipeline success ratio over the last day
sum(rate(gitlab_ci_pipeline_run_count{status="success"}[1d]))
  / sum(rate(gitlab_ci_pipeline_run_count[1d]))

# Currently running pipelines
gitlab_ci_pipeline_status{status="running"}

# Latest job durations, top 10
topk(10, gitlab_ci_job_duration_seconds)
```

## Development

```bash
npm install
npm test     # node:test based unit + HTTP integration tests
npm run dev  # watch mode
```

## Project layout

```
src/
  index.js            # entry point: wires config + server + metrics
  config.js           # env-based configuration
  logger.js           # JSON line logger
  metrics.js          # prom-client registry & collectors
  server.js           # Express app: /webhook, /metrics, /health
  handlers/
    pipeline.js       # GitLab "pipeline" event → metrics
    job.js            # GitLab "build" (job) event → metrics
test/                 # unit + integration tests
examples/             # sample payloads & prometheus config
```

## Notes & limitations

- Metrics are held **in memory**; restarting the exporter resets them. Run a
  single instance behind a stable address and rely on Prometheus for long-term
  storage.
- Only `pipeline` and `build` (job) events are processed; other event kinds are
  acknowledged and counted as `ignored`.

## License

MIT
