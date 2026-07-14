import { type Span, SpanStatusCode, type Tracer, context, trace } from '@opentelemetry/api';
import type { SamplingConfig } from './types.js';

export { trace, SpanStatusCode };
export type { Tracer, Span };

const DEFAULT_SAMPLING_CONFIG: SamplingConfig = {
  traceSampleRate: 1.0,
  errorSampleRate: 1.0,
  slowRequestThresholdMs: 1000,
};

let currentSamplingConfig: SamplingConfig = { ...DEFAULT_SAMPLING_CONFIG };

export function configureSampling(config: Partial<SamplingConfig>): void {
  currentSamplingConfig = {
    ...DEFAULT_SAMPLING_CONFIG,
    ...config,
  };
}

export function getSamplingConfig(): SamplingConfig {
  return { ...currentSamplingConfig };
}

export function getTracer(name: string): Tracer {
  return trace.getTracer(name);
}

export function shouldSampleTrace(): boolean {
  return Math.random() < currentSamplingConfig.traceSampleRate;
}

export function shouldSampleError(): boolean {
  return Math.random() < currentSamplingConfig.errorSampleRate;
}

export function isSlowRequest(durationMs: number): boolean {
  return durationMs >= currentSamplingConfig.slowRequestThresholdMs;
}

export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  });
}

export function getActiveSpan(): Span | undefined {
  return trace.getActiveSpan();
}

export function getTraceId(): string | undefined {
  const span = getActiveSpan();
  if (!span) return undefined;
  return span.spanContext().traceId;
}

export function getSpanId(): string | undefined {
  const span = getActiveSpan();
  if (!span) return undefined;
  return span.spanContext().spanId;
}

export function propagateContext<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = context.active();
  return context.with(ctx, fn);
}

export function setSpanAttributes(
  span: Span,
  attributes: Record<string, string | number | boolean>,
): void {
  span.setAttributes(attributes);
}

export function addSpanEvent(
  span: Span,
  name: string,
  attributes?: Record<string, string | number | boolean>,
): void {
  span.addEvent(name, attributes);
}
