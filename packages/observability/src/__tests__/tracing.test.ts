import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configureSampling,
  getSamplingConfig,
  isSlowRequest,
  shouldSampleError,
  shouldSampleTrace,
} from '../tracing.js';

describe('Sampling Configuration', () => {
  beforeEach(() => {
    configureSampling({});
  });

  afterEach(() => {
    configureSampling({});
  });

  it('returns default config', () => {
    const config = getSamplingConfig();
    expect(config.traceSampleRate).toBe(1.0);
    expect(config.errorSampleRate).toBe(1.0);
    expect(config.slowRequestThresholdMs).toBe(1000);
  });

  it('overrides specific values', () => {
    configureSampling({ traceSampleRate: 0.5 });
    const config = getSamplingConfig();
    expect(config.traceSampleRate).toBe(0.5);
    expect(config.errorSampleRate).toBe(1.0);
  });

  it('returns a copy of config', () => {
    const config1 = getSamplingConfig();
    const config2 = getSamplingConfig();
    expect(config1).not.toBe(config2);
    expect(config1).toEqual(config2);
  });
});

describe('shouldSampleTrace', () => {
  it('always samples when rate is 1.0', () => {
    configureSampling({ traceSampleRate: 1.0 });
    const results = Array.from({ length: 100 }, () => shouldSampleTrace());
    expect(results.every((r) => r === true)).toBe(true);
  });

  it('never samples when rate is 0', () => {
    configureSampling({ traceSampleRate: 0 });
    const results = Array.from({ length: 100 }, () => shouldSampleTrace());
    expect(results.every((r) => r === false)).toBe(true);
  });
});

describe('shouldSampleError', () => {
  it('always samples when rate is 1.0', () => {
    configureSampling({ errorSampleRate: 1.0 });
    const results = Array.from({ length: 100 }, () => shouldSampleError());
    expect(results.every((r) => r === true)).toBe(true);
  });

  it('never samples when rate is 0', () => {
    configureSampling({ errorSampleRate: 0 });
    const results = Array.from({ length: 100 }, () => shouldSampleError());
    expect(results.every((r) => r === false)).toBe(true);
  });
});

describe('isSlowRequest', () => {
  it('returns false for fast requests', () => {
    configureSampling({ slowRequestThresholdMs: 1000 });
    expect(isSlowRequest(500)).toBe(false);
  });

  it('returns true for slow requests', () => {
    configureSampling({ slowRequestThresholdMs: 1000 });
    expect(isSlowRequest(1500)).toBe(true);
  });

  it('returns true at threshold', () => {
    configureSampling({ slowRequestThresholdMs: 1000 });
    expect(isSlowRequest(1000)).toBe(true);
  });

  it('uses configured threshold', () => {
    configureSampling({ slowRequestThresholdMs: 500 });
    expect(isSlowRequest(600)).toBe(true);
    expect(isSlowRequest(400)).toBe(false);
  });
});
