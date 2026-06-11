# gitlab-ci-metrics-exporter

A lightweight, **generic Prometheus push exporter** written in **Node.js**.

Clients (CI pipelines, scripts, GitLab webhook relays, anything that can make
an HTTP request) **push metric samples as JSON**, and the exporter exposes
them at `/metrics` for Prometheus to scrape — similar in spirit to the
[Prometheus Pushgateway](https://github.com/prometheus/pushgateway), but with
a simple JSON API and native support for **gauges, counters and histograms**.

> **Note:** v1.x of this project parsed GitLab CI webhook payloads directly.
> v2 is a generic push exporter — feed it whatever metrics you like (including
> ones derived from GitLab webhooks upstream). See the `v1.0.0` tag for the
> previous architecture.

## How it works

```
your app/script ──(POST JSON metric)──▶ /metrics ──▶ in-memory registry ──▶ (GET) /metrics ──▶ Prometheus
```

1. Your application pushes one or more metric samples to `POST /metrics`.
2. The exporter registers the metric (gauge/counter/histogram) on first use,
   then applies the value (`set`/`inc`/`dec`/`observe`).
3. Prometheus scrapes `GET /metrics` as usual.

## Quick start

```bash
npm install
PUSH_AUTH_TOKEN=mysecret npm start
# exporter listening on :9252
```

Push a gauge:

```bash
curl -X POST http://localhost:9252/metrics \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mysecret" \
  --data @examples/push-gauge.json

curl -s http://localhost:9252/metrics | grep gitlab_ci
```

### Docker

```bash
docker build -t gitlab-ci-metrics-exporter .
docker run -p 9252:9252 -e PUSH_AUTH_TOKEN=mysecret gitlab-ci-metrics-exporter
```

A prebuilt image is published to GitHub Container Registry on every push to
`main` and on version tags (see `.github/workflows/docker-publish.yml`):

```bash
docker run -p 9252:9252 -e PUSH_AUTH_TOKEN=mysecret \
  ghcr.io/<owner>/<repo>:latest
```

Or with the bundled Prometheus:

```bash
PUSH_AUTH_TOKEN=mysecret docker compose up
```

### Kubernetes / OpenShift

A Helm chart is provided in [`charts/gitlab-ci-metrics-exporter`](charts/gitlab-ci-metrics-exporter)
for deploying to Kubernetes or OpenShift, including an optional OpenShift
`Route`, PVC-backed persistence, and a Prometheus Operator `ServiceMonitor`.
See the chart's [README](charts/gitlab-ci-metrics-exporter/README.md) for
usage.

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable          | Default    | Description                                                  |
| ----------------- | ---------- | ------------------------------------------------------------- |
| `HOST`            | `0.0.0.0`  | Bind address                                                  |
| `PORT`            | `9252`     | Bind port                                                     |
| `METRICS_PATH`    | `/metrics` | Path used for both `GET` (scrape) and `POST` (push)           |
| `PUSH_AUTH_TOKEN` | _(empty)_  | Required `Authorization: Bearer <token>` on pushes. Empty disables auth |
| `BODY_LIMIT`      | `1mb`      | Max request body size                                         |
| `LOG_LEVEL`       | `info`     | `error` \| `warn` \| `info` \| `debug`                        |
| `DEFAULT_METRICS` | `true`     | Also expose default Node.js process metrics                   |
| `PERSISTENCE_PATH` | _(empty)_ | File path to persist/restore pushed metrics across restarts. Empty disables persistence |
| `PERSISTENCE_INTERVAL_MS` | `30000` | How often to write the metrics snapshot to `PERSISTENCE_PATH` |

## Persistence

By default, all metrics are kept **in memory only** and are lost when the
process restarts. To survive restarts (e.g. a pod restart in Kubernetes),
set `PERSISTENCE_PATH` to a file on a persistent volume:

```bash
PERSISTENCE_PATH=/data/state.json PUSH_AUTH_TOKEN=mysecret npm start
```

The exporter will:

- load the snapshot at startup (if the file exists) and restore all gauge,
  counter and histogram values, including counter totals so they keep
  accumulating correctly;
- write a snapshot every `PERSISTENCE_INTERVAL_MS` (default 30s);
- write a final snapshot on graceful shutdown (`SIGTERM`/`SIGINT`).

In Kubernetes, mount a PVC at the directory containing `PERSISTENCE_PATH`
(e.g. `/data`) so the snapshot survives pod restarts. This still requires a
**single replica/pod** — see "Notes & limitations" below.

## Pushing metrics

`POST /metrics` accepts:

- a single metric object,
- a JSON array of metric objects, or
- `{ "metrics": [ ... ] }`

### Metric object fields

| Field    | Required          | Description                                                                 |
| -------- | ----------------- | ---------------------------------------------------------------------------- |
| `name`   | yes                | Prometheus metric name (`^[a-zA-Z_:][a-zA-Z0-9_:]*$`)                        |
| `type`   | on first push only | `gauge` \| `counter` \| `histogram`. Must stay the same for a given `name`  |
| `help`   | no                 | Description shown in the `# HELP` line (first push only)                    |
| `labels` | no (default `{}`)  | Label name → value map. The set of label names is fixed after first push    |
| `value`  | no (default `1`)   | Numeric value to apply                                                       |
| `method` | no                 | How `value` is applied (see below)                                          |
| `buckets`| no                 | Histogram bucket boundaries, e.g. `[0.1, 0.5, 1, 5]` (first push only)       |

### `method` by metric type

| Type        | Allowed `method`        | Default     | Effect                                |
| ----------- | ------------------------ | ----------- | -------------------------------------- |
| `gauge`     | `set`, `inc`, `dec`       | `set`       | Sets / increments / decrements         |
| `counter`   | `inc`                     | `inc`       | Adds `value` (must be ≥ 0, cumulative) |
| `histogram` | `observe`                 | `observe`   | Records an observation                 |

### Examples

Gauge — set `gitlab_ci_pipeline_duration_seconds` to `42`:

```json
{
  "name": "gitlab_ci_pipeline_duration_seconds",
  "type": "gauge",
  "help": "Duration in seconds of the most recent pipeline",
  "labels": { "project": "group/app", "ref": "main", "env": "prod" },
  "value": 42
}
```

Counter — increment `gitlab_ci_pipeline_run_count` by 1:

```json
{
  "name": "gitlab_ci_pipeline_run_count",
  "type": "counter",
  "labels": { "project": "group/app", "ref": "main", "status": "success" },
  "value": 1
}
```

Histogram — observe a job duration, defining buckets on first push:

```json
{
  "name": "gitlab_ci_job_duration_seconds",
  "type": "histogram",
  "labels": { "project": "group/app", "stage": "test" },
  "value": 12.5,
  "buckets": [1, 5, 10, 30, 60, 120, 300]
}
```

Batch push (see `examples/push-batch.json`):

```bash
curl -X POST http://localhost:9252/metrics \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mysecret" \
  --data @examples/push-batch.json
```

### Responses

- `202 Accepted` – `{ "status": "accepted", "count": <n> }`
- `400 Bad Request` – `{ "error": "...", "index": <n>, "applied": <n> }` —
  validation failed for item `index`; the first `applied` items in the batch
  were already applied.
- `401 Unauthorized` – missing/invalid bearer token.

### Validation rules

- A metric `name` and its `type` and label set are fixed on first push; later
  pushes with a different `type` or different label keys for the same `name`
  are rejected.
- Counters can only be incremented (`value >= 0`); use a `gauge` if you need
  values that can go down.

## Development

```bash
npm install
npm test     # node:test based unit + HTTP integration tests
npm run dev  # watch mode
```

## Project layout

```
src/
  index.js            # entry point: wires config + server + metrics store
  config.js           # env-based configuration
  logger.js           # JSON line logger
  metrics-store.js     # dynamic prom-client registry (gauge/counter/histogram)
  persistence.js       # optional snapshot save/restore for PERSISTENCE_PATH
  server.js           # Express app: /metrics (GET+POST), /health
test/                 # unit + integration tests
examples/             # sample push payloads & prometheus config
charts/               # Helm chart for Kubernetes/OpenShift deployment
```

## Notes & limitations

- Metrics are held **in memory**; restarting the exporter resets them unless
  `PERSISTENCE_PATH` is set (see "Persistence" above). Run a single instance
  behind a stable address and rely on Prometheus for long-term storage.
- There is no metric expiry/TTL — pushed series remain until the process
  restarts (unlike the official Pushgateway, which also has no TTL by
  default).
- Persistence is a periodic/best-effort snapshot, not a transaction log: any
  pushes received between the last snapshot and an unclean shutdown (e.g.
  `SIGKILL`) are lost.

## License

MIT
