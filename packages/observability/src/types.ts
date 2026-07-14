export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface StandardLogFields {
  service?: string;
  environment?: string;
  version?: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  userId?: string;
  walletAddress?: string;
  chainId?: number;
  blockNumber?: number | bigint;
  transactionHash?: string;
  jobName?: string;
  jobId?: string;
  durationMs?: number;
  result?: string;
  errorCode?: string;
}

export interface ChainEventProvenance {
  chainId: number;
  blockNumber: number | bigint;
  blockHash?: string;
  transactionHash?: string;
  logIndex?: number;
  trustClass?: 'CHAIN_FACT' | 'EXPLORER_ENRICHMENT' | 'DERIVED';
}

export interface LoggerOptions {
  level?: LogLevel;
  service?: string;
  environment?: string;
  version?: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  bindings?: Record<string, unknown>;
}

export interface ChildLoggerOptions {
  requestId?: string;
  traceId?: string;
  spanId?: string;
  userId?: string;
  walletAddress?: string;
  chainId?: number;
  jobName?: string;
  jobId?: string;
  bindings?: Record<string, unknown>;
}

export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  statusCode?: number;
  stack?: string;
  cause?: SerializedError;
}

export interface MetricLabel {
  key: string;
  value: string;
}

export interface MetricDefinition {
  name: string;
  description: string;
  type: 'counter' | 'histogram' | 'gauge';
  unit?: string;
  labels?: string[];
}

export interface SamplingConfig {
  traceSampleRate: number;
  errorSampleRate: number;
  slowRequestThresholdMs: number;
}
