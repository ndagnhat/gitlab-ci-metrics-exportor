import { Registry, Gauge, Counter, Histogram, collectDefaultMetrics } from 'prom-client';
import { hashObject } from 'prom-client/lib/util.js';

const TYPES = { gauge: Gauge, counter: Counter, histogram: Histogram };

// Prometheus metric / label naming rules.
const NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Creates an in-memory store of Prometheus collectors that are registered
 * lazily, the first time a metric with a given name is pushed. Subsequent
 * pushes for the same name must use the same type and label set.
 */
export function createMetricsStore({ defaultMetricsEnabled = true } = {}) {
  const registry = new Registry();
  if (defaultMetricsEnabled) collectDefaultMetrics({ register: registry });

  const collectors = new Map();

  /**
   * Applies a single pushed metric sample to the registry.
   * Throws a descriptive Error if the sample is invalid or conflicts with a
   * previously registered metric of the same name.
   */
  function push({ name, type, help, labels = {}, value = 1, method, buckets } = {}) {
    if (typeof name !== 'string' || !NAME_RE.test(name)) {
      throw new Error(`invalid metric name: ${JSON.stringify(name)}`);
    }
    if (labels === null || typeof labels !== 'object' || Array.isArray(labels)) {
      throw new Error(`"labels" must be an object for metric "${name}"`);
    }
    const labelNames = Object.keys(labels);
    for (const key of labelNames) {
      if (!LABEL_RE.test(key)) {
        throw new Error(`invalid label name "${key}" for metric "${name}"`);
      }
    }

    let entry = collectors.get(name);
    if (!entry) {
      if (!type) {
        throw new Error(`metric "${name}" is not registered yet; "type" is required on first push`);
      }
      const Ctor = TYPES[type];
      if (!Ctor) {
        throw new Error(`unsupported type "${type}" for metric "${name}" (expected gauge, counter or histogram)`);
      }

      const options = {
        name,
        help: help || `${name} (pushed metric)`,
        labelNames,
        registers: [registry],
      };
      if (type === 'histogram' && Array.isArray(buckets) && buckets.length > 0) {
        if (!buckets.every((b) => typeof b === 'number' && Number.isFinite(b))) {
          throw new Error(`"buckets" for metric "${name}" must be an array of numbers`);
        }
        options.buckets = buckets;
      }

      entry = { type, collector: new Ctor(options), labelNames: [...labelNames].sort() };
      collectors.set(name, entry);
    } else {
      if (type && type !== entry.type) {
        throw new Error(`metric "${name}" is already registered as "${entry.type}", cannot push as "${type}"`);
      }
      const sortedNew = [...labelNames].sort();
      if (JSON.stringify(sortedNew) !== JSON.stringify(entry.labelNames)) {
        throw new Error(
          `metric "${name}" expects labels [${entry.labelNames.join(', ')}], got [${sortedNew.join(', ')}]`,
        );
      }
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      throw new Error(`invalid "value" for metric "${name}": ${JSON.stringify(value)}`);
    }

    switch (entry.type) {
      case 'counter': {
        const m = method ?? 'inc';
        if (m !== 'inc') throw new Error(`counter "${name}" only supports method "inc", got "${m}"`);
        if (numericValue < 0) throw new Error(`counter "${name}" cannot be incremented by a negative value`);
        entry.collector.inc(labels, numericValue);
        break;
      }
      case 'gauge': {
        const m = method ?? 'set';
        if (m === 'set') entry.collector.set(labels, numericValue);
        else if (m === 'inc') entry.collector.inc(labels, numericValue);
        else if (m === 'dec') entry.collector.dec(labels, numericValue);
        else throw new Error(`gauge "${name}" supports methods "set", "inc", "dec", got "${m}"`);
        break;
      }
      case 'histogram': {
        const m = method ?? 'observe';
        if (m !== 'observe') throw new Error(`histogram "${name}" only supports method "observe", got "${m}"`);
        entry.collector.observe(labels, numericValue);
        break;
      }
    }

    return { name, type: entry.type, method: method ?? defaultMethod(entry.type), labels, value: numericValue };
  }

  /**
   * Serializes all pushed (non-default) collectors and their current values
   * into a plain JSON-serializable object, suitable for persisting to disk.
   */
  function exportState() {
    const metrics = [];
    for (const [name, entry] of collectors) {
      const { collector, type } = entry;
      const metric = {
        name,
        type,
        help: collector.help,
        labelNames: collector.labelNames,
      };
      if (type === 'histogram') metric.buckets = collector.upperBounds;
      metric.values = Object.values(collector.hashMap).map((v) =>
        type === 'histogram'
          ? { labels: v.labels, sum: v.sum, count: v.count, bucketValues: v.bucketValues }
          : { labels: v.labels, value: v.value },
      );
      metrics.push(metric);
    }
    return { version: 1, savedAt: new Date().toISOString(), metrics };
  }

  /**
   * Restores collectors and their values from a snapshot produced by
   * `exportState`. Intended to be called once, before any pushes, to seed
   * the registry after a restart. Metrics already registered are skipped.
   */
  function importState(state) {
    for (const metric of state?.metrics ?? []) {
      const { name, type, help, labelNames = [], buckets, values = [] } = metric;
      if (collectors.has(name) || !TYPES[type]) continue;

      const Ctor = TYPES[type];
      const options = {
        name,
        help: help || `${name} (pushed metric)`,
        labelNames,
        registers: [registry],
      };
      if (type === 'histogram' && Array.isArray(buckets) && buckets.length > 0) {
        options.buckets = buckets;
      }

      const collector = new Ctor(options);
      const entry = { type, collector, labelNames: [...labelNames].sort() };
      collectors.set(name, entry);

      for (const v of values) {
        const labels = v.labels ?? {};
        const hash = hashObject(labels, collector.sortedLabelNames);
        if (type === 'histogram') {
          collector.hashMap[hash] = {
            labels,
            bucketValues: { ...collector.bucketValues, ...v.bucketValues },
            sum: v.sum ?? 0,
            count: v.count ?? 0,
          };
        } else {
          collector.hashMap[hash] = { labels, value: v.value ?? 0 };
        }
      }
    }
  }

  return { registry, push, exportState, importState };
}

function defaultMethod(type) {
  if (type === 'counter') return 'inc';
  if (type === 'histogram') return 'observe';
  return 'set';
}
