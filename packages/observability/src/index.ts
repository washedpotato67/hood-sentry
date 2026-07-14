export { Logger, getLogger, createLogger, resetDefaultLogger } from './logger.js';

export {
  redactSecrets,
  hashIdentifier,
  truncateAddress,
  sanitizeProviderUrl,
  REDACTED,
  REDACTED_PII,
} from './redact.js';

export {
  getTracer,
  withSpan,
  trace,
  SpanStatusCode,
  configureSampling,
  getSamplingConfig,
  shouldSampleTrace,
  shouldSampleError,
  isSlowRequest,
  getActiveSpan,
  getTraceId,
  getSpanId,
  propagateContext,
  setSpanAttributes,
  addSpanEvent,
} from './tracing.js';

export {
  serializeError,
  normalizeErrorCode,
  normalizeErrorStatus,
  isRetryableError,
} from './errors.js';

export {
  getMetricsRegistry,
  resetMetricsRegistry,
  initializeMetrics,
  METRIC_DEFINITIONS,
  MetricsRegistry,
  MAX_LABEL_CARDINALITY,
} from './metrics.js';

export type {
  LogLevel,
  StandardLogFields,
  ChainEventProvenance,
  LoggerOptions,
  ChildLoggerOptions,
  SerializedError,
  MetricLabel,
  MetricDefinition,
  SamplingConfig,
} from './types.js';

export type { Tracer, Span } from './tracing.js';
export type { MetricValue, HistogramBucket } from './metrics.js';
