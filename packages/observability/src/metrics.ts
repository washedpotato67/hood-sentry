import type { MetricDefinition, MetricLabel } from './types.js';

const MAX_LABEL_CARDINALITY = 100;

interface MetricValue {
  value: number;
  labels: Map<string, string>;
  lastUpdated: number;
}

interface HistogramBucket {
  count: number;
  sum: number;
  buckets: Map<number, number>;
}

class MetricsRegistry {
  private counters = new Map<string, Map<string, MetricValue>>();
  private histograms = new Map<string, Map<string, HistogramBucket>>();
  private gauges = new Map<string, Map<string, MetricValue>>();
  private definitions = new Map<string, MetricDefinition>();
  private labelCardinality = new Map<string, Set<string>>();

  define(definition: MetricDefinition): void {
    this.definitions.set(definition.name, definition);
  }

  private buildLabelKey(labels: MetricLabel[]): string {
    return labels
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((l) => `${l.key}=${l.value}`)
      .join(',');
  }

  private checkCardinality(metricName: string, labelKey: string): boolean {
    let cardinality = this.labelCardinality.get(metricName);
    if (!cardinality) {
      cardinality = new Set();
      this.labelCardinality.set(metricName, cardinality);
    }

    if (cardinality.size >= MAX_LABEL_CARDINALITY && !cardinality.has(labelKey)) {
      return false;
    }

    cardinality.add(labelKey);
    return true;
  }

  incrementCounter(name: string, labels: MetricLabel[] = [], value = 1): void {
    const labelKey = this.buildLabelKey(labels);

    if (!this.checkCardinality(name, labelKey)) {
      return;
    }

    let metricMap = this.counters.get(name);
    if (!metricMap) {
      metricMap = new Map();
      this.counters.set(name, metricMap);
    }

    let metric = metricMap.get(labelKey);
    if (!metric) {
      metric = {
        value: 0,
        labels: new Map(labels.map((l) => [l.key, l.value])),
        lastUpdated: Date.now(),
      };
      metricMap.set(labelKey, metric);
    }

    metric.value += value;
    metric.lastUpdated = Date.now();
  }

  recordHistogram(name: string, value: number, labels: MetricLabel[] = []): void {
    const labelKey = this.buildLabelKey(labels);

    if (!this.checkCardinality(name, labelKey)) {
      return;
    }

    let metricMap = this.histograms.get(name);
    if (!metricMap) {
      metricMap = new Map();
      this.histograms.set(name, metricMap);
    }

    let histogram = metricMap.get(labelKey);
    if (!histogram) {
      histogram = {
        count: 0,
        sum: 0,
        buckets: new Map([
          [10, 0],
          [50, 0],
          [100, 0],
          [250, 0],
          [500, 0],
          [1000, 0],
          [2500, 0],
          [5000, 0],
          [10000, 0],
          [Number.POSITIVE_INFINITY, 0],
        ]),
      };
      metricMap.set(labelKey, histogram);
    }

    histogram.count += 1;
    histogram.sum += value;

    for (const [bucket, count] of histogram.buckets.entries()) {
      if (value <= bucket) {
        histogram.buckets.set(bucket, count + 1);
      }
    }
  }

  setGauge(name: string, value: number, labels: MetricLabel[] = []): void {
    const labelKey = this.buildLabelKey(labels);

    if (!this.checkCardinality(name, labelKey)) {
      return;
    }

    let metricMap = this.gauges.get(name);
    if (!metricMap) {
      metricMap = new Map();
      this.gauges.set(name, metricMap);
    }

    let metric = metricMap.get(labelKey);
    if (!metric) {
      metric = {
        value: 0,
        labels: new Map(labels.map((l) => [l.key, l.value])),
        lastUpdated: Date.now(),
      };
      metricMap.set(labelKey, metric);
    }

    metric.value = value;
    metric.lastUpdated = Date.now();
  }

  getCounter(name: string, labels: MetricLabel[] = []): number {
    const labelKey = this.buildLabelKey(labels);
    const metricMap = this.counters.get(name);
    if (!metricMap) return 0;
    const metric = metricMap.get(labelKey);
    return metric?.value ?? 0;
  }

  getHistogram(name: string, labels: MetricLabel[] = []): HistogramBucket | undefined {
    const labelKey = this.buildLabelKey(labels);
    const metricMap = this.histograms.get(name);
    if (!metricMap) return undefined;
    return metricMap.get(labelKey);
  }

  getGauge(name: string, labels: MetricLabel[] = []): number {
    const labelKey = this.buildLabelKey(labels);
    const metricMap = this.gauges.get(name);
    if (!metricMap) return 0;
    const metric = metricMap.get(labelKey);
    return metric?.value ?? 0;
  }

  getLabelCardinality(name: string): number {
    const cardinality = this.labelCardinality.get(name);
    return cardinality?.size ?? 0;
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
    this.labelCardinality.clear();
  }

  export(): Record<string, unknown> {
    return {
      counters: Object.fromEntries(this.counters),
      histograms: Object.fromEntries(this.histograms),
      gauges: Object.fromEntries(this.gauges),
      definitions: Object.fromEntries(this.definitions),
    };
  }
}

let globalRegistry: MetricsRegistry | null = null;

export function getMetricsRegistry(): MetricsRegistry {
  if (!globalRegistry) {
    globalRegistry = new MetricsRegistry();
  }
  return globalRegistry;
}

export function resetMetricsRegistry(): void {
  globalRegistry = null;
}

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    name: 'http_requests_total',
    description: 'Total HTTP requests',
    type: 'counter',
    labels: ['method', 'route', 'status_code'],
  },
  {
    name: 'http_request_duration_ms',
    description: 'HTTP request duration in milliseconds',
    type: 'histogram',
    unit: 'ms',
    labels: ['method', 'route'],
  },
  {
    name: 'api_errors_total',
    description: 'Total API errors',
    type: 'counter',
    labels: ['error_code', 'status_code'],
  },
  {
    name: 'database_query_duration_ms',
    description: 'Database query duration in milliseconds',
    type: 'histogram',
    unit: 'ms',
    labels: ['operation'],
  },
  {
    name: 'redis_operation_duration_ms',
    description: 'Redis operation duration in milliseconds',
    type: 'histogram',
    unit: 'ms',
    labels: ['operation'],
  },
  {
    name: 'queue_depth',
    description: 'Current queue depth',
    type: 'gauge',
    labels: ['queue_name'],
  },
  {
    name: 'job_oldest_age_ms',
    description: 'Age of oldest job in milliseconds',
    type: 'gauge',
    unit: 'ms',
    labels: ['queue_name'],
  },
  {
    name: 'job_retries_total',
    description: 'Total job retries',
    type: 'counter',
    labels: ['job_name'],
  },
  {
    name: 'dead_letter_count',
    description: 'Dead letter queue count',
    type: 'gauge',
    labels: ['queue_name'],
  },
  {
    name: 'indexer_block_lag',
    description: 'Indexer block lag behind chain head',
    type: 'gauge',
    labels: ['chain_id'],
  },
  {
    name: 'reorg_count_total',
    description: 'Total reorg events',
    type: 'counter',
    labels: ['chain_id'],
  },
  {
    name: 'rpc_request_duration_ms',
    description: 'RPC request duration in milliseconds',
    type: 'histogram',
    unit: 'ms',
    labels: ['method', 'provider'],
  },
  {
    name: 'rpc_errors_total',
    description: 'Total RPC errors',
    type: 'counter',
    labels: ['error_type', 'provider'],
  },
  {
    name: 'provider_failovers_total',
    description: 'Total provider failovers',
    type: 'counter',
    labels: ['from_provider', 'to_provider'],
  },
  {
    name: 'risk_scan_duration_ms',
    description: 'Risk scan duration in milliseconds',
    type: 'histogram',
    unit: 'ms',
    labels: ['scan_type'],
  },
  {
    name: 'alert_evaluation_duration_ms',
    description: 'Alert evaluation duration in milliseconds',
    type: 'histogram',
    unit: 'ms',
    labels: ['alert_type'],
  },
  {
    name: 'notification_delivery_total',
    description: 'Total notification deliveries',
    type: 'counter',
    labels: ['channel', 'status'],
  },
  {
    name: 'webhook_retries_total',
    description: 'Total webhook retries',
    type: 'counter',
    labels: ['endpoint'],
  },
  {
    name: 'contract_balance',
    description: 'Contract balance monitoring',
    type: 'gauge',
    labels: ['contract_address', 'chain_id'],
  },
  {
    name: 'feature_flag_changes_total',
    description: 'Total feature flag changes',
    type: 'counter',
    labels: ['flag_name', 'new_value'],
  },
];

export function initializeMetrics(): void {
  const registry = getMetricsRegistry();
  for (const definition of METRIC_DEFINITIONS) {
    registry.define(definition);
  }
}

export { MetricsRegistry, MAX_LABEL_CARDINALITY };
export type { MetricValue, HistogramBucket };
