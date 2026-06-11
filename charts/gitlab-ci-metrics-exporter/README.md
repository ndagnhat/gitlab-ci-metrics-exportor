# gitlab-ci-metrics-exporter Helm chart

Deploys the [gitlab-ci-metrics-exporter](../../README.md) generic Prometheus
push exporter. Designed to run as a **single replica** (the registry is kept
in memory, optionally persisted to one PVC) — see the main README's
"Notes & limitations".

## Install (OpenShift)

```bash
helm install metrics-exporter ./charts/gitlab-ci-metrics-exporter \
  --namespace my-namespace \
  --set auth.pushAuthToken=mysecret \
  --set route.enabled=true \
  --set persistence.enabled=true
```

This will create a Deployment, Service, ConfigMap, Secret (with the push
token), PVC (mounted at `/data`), ServiceAccount, and an OpenShift `Route`
(TLS edge-terminated, redirecting HTTP to HTTPS).

The image already runs as a non-root user and `/data` is group-writable
(group `0`), so it works under OpenShift's default `restricted` SCC without
any extra `securityContext` tuning.

After install, the `helm install` output (NOTES) prints the Route URL and a
sample `curl` command to push a metric.

## Install (plain Kubernetes)

```bash
helm install metrics-exporter ./charts/gitlab-ci-metrics-exporter \
  --set auth.pushAuthToken=mysecret \
  --set ingress.enabled=true \
  --set ingress.host=metrics-exporter.example.com \
  --set persistence.enabled=true \
  --set persistence.storageClassName=standard
```

## Key values

| Key | Default | Description |
| --- | --- | --- |
| `image.repository` / `image.tag` | `ghcr.io/ndagnhat/gitlab-ci-metrics-exportor` / chart `appVersion` | Image to deploy |
| `auth.pushAuthToken` | _(empty)_ | Bearer token for `POST /metrics`; chart creates a Secret. Leave empty to disable auth (not recommended) |
| `auth.existingSecret` / `auth.existingSecretKey` | _(empty)_ / `PUSH_AUTH_TOKEN` | Use a pre-existing Secret instead |
| `persistence.enabled` | `false` | Mount a PVC at `persistence.mountPath` and set `PERSISTENCE_PATH` so metrics survive pod restarts |
| `persistence.size` / `persistence.storageClassName` | `1Gi` / _(cluster default)_ | PVC size / storage class |
| `route.enabled` | `false` | Create an OpenShift `Route` |
| `ingress.enabled` | `false` | Create a Kubernetes `Ingress` (alternative to `route`) |
| `serviceMonitor.enabled` | `false` | Create a Prometheus Operator `ServiceMonitor` |
| `resources` | `200m`/`256Mi` limits, `50m`/`64Mi` requests | Pod resource requests/limits |

See `values.yaml` for the full list (mirrors the exporter's environment
variables documented in the main README).

## Upgrading / restarts

The Deployment uses `strategy: Recreate` (single replica with a possible
RWO PVC) — expect a brief downtime during upgrades or pod restarts. With
`persistence.enabled=true`, gauge/counter/histogram values are restored from
the PVC after the restart.
