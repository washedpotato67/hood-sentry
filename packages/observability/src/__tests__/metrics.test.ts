import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_LABEL_CARDINALITY,
  getMetricsRegistry,
  initializeMetrics,
  resetMetricsRegistry,
} from '../metrics.js';

describe('MetricsRegistry', () => {
  beforeEach(() => {
    resetMetricsRegistry();
  });

  afterEach(() => {
    resetMetricsRegistry();
  });

  describe('counters', () => {
    it('increments counter', () => {
      const registry = getMetricsRegistry();
      registry.incrementCounter('test_counter');
      expect(registry.getCounter('test_counter')).toBe(1);
    });

    it('increments counter by custom value', () => {
      const registry = getMetricsRegistry();
      registry.incrementCounter('test_counter', [], 5);
      expect(registry.getCounter('test_counter')).toBe(5);
    });

    it('increments counter with labels', () => {
      const registry = getMetricsRegistry();
      registry.incrementCounter('http_requests', [
        { key: 'method', value: 'GET' },
        { key: 'status', value: '200' },
      ]);
      expect(
        registry.getCounter('http_requests', [
          { key: 'method', value: 'GET' },
          { key: 'status', value: '200' },
        ]),
      ).toBe(1);
    });

    it('returns 0 for non-existent counter', () => {
      const registry = getMetricsRegistry();
      expect(registry.getCounter('nonexistent')).toBe(0);
    });

    it('accumulates multiple increments', () => {
      const registry = getMetricsRegistry();
      registry.incrementCounter('test_counter');
      registry.incrementCounter('test_counter');
      registry.incrementCounter('test_counter');
      expect(registry.getCounter('test_counter')).toBe(3);
    });
  });

  describe('histograms', () => {
    it('records histogram values', () => {
      const registry = getMetricsRegistry();
      registry.recordHistogram('test_histogram', 100);
      const histogram = registry.getHistogram('test_histogram');
      expect(histogram).toBeDefined();
      expect(histogram?.count).toBe(1);
      expect(histogram?.sum).toBe(100);
    });

    it('records multiple histogram values', () => {
      const registry = getMetricsRegistry();
      registry.recordHistogram('test_histogram', 100);
      registry.recordHistogram('test_histogram', 200);
      registry.recordHistogram('test_histogram', 300);
      const histogram = registry.getHistogram('test_histogram');
      expect(histogram?.count).toBe(3);
      expect(histogram?.sum).toBe(600);
    });

    it('populates buckets correctly', () => {
      const registry = getMetricsRegistry();
      registry.recordHistogram('test_histogram', 5);
      registry.recordHistogram('test_histogram', 50);
      registry.recordHistogram('test_histogram', 500);
      const histogram = registry.getHistogram('test_histogram');
      expect(histogram?.buckets.get(10)).toBe(1);
      expect(histogram?.buckets.get(50)).toBe(2);
      expect(histogram?.buckets.get(500)).toBe(3);
    });

    it('returns undefined for non-existent histogram', () => {
      const registry = getMetricsRegistry();
      expect(registry.getHistogram('nonexistent')).toBeUndefined();
    });
  });

  describe('gauges', () => {
    it('sets gauge value', () => {
      const registry = getMetricsRegistry();
      registry.setGauge('test_gauge', 42);
      expect(registry.getGauge('test_gauge')).toBe(42);
    });

    it('overwrites gauge value', () => {
      const registry = getMetricsRegistry();
      registry.setGauge('test_gauge', 42);
      registry.setGauge('test_gauge', 100);
      expect(registry.getGauge('test_gauge')).toBe(100);
    });

    it('sets gauge with labels', () => {
      const registry = getMetricsRegistry();
      registry.setGauge('queue_depth', 10, [{ key: 'queue', value: 'risk-scans' }]);
      expect(registry.getGauge('queue_depth', [{ key: 'queue', value: 'risk-scans' }])).toBe(10);
    });

    it('returns 0 for non-existent gauge', () => {
      const registry = getMetricsRegistry();
      expect(registry.getGauge('nonexistent')).toBe(0);
    });
  });

  describe('label cardinality controls', () => {
    it('tracks label cardinality', () => {
      const registry = getMetricsRegistry();
      registry.incrementCounter('test', [{ key: 'label', value: 'a' }]);
      registry.incrementCounter('test', [{ key: 'label', value: 'b' }]);
      registry.incrementCounter('test', [{ key: 'label', value: 'c' }]);
      expect(registry.getLabelCardinality('test')).toBe(3);
    });

    it('rejects labels beyond cardinality limit', () => {
      const registry = getMetricsRegistry();

      for (let i = 0; i < MAX_LABEL_CARDINALITY; i++) {
        registry.incrementCounter('test', [{ key: 'label', value: `value_${i}` }]);
      }

      expect(registry.getLabelCardinality('test')).toBe(MAX_LABEL_CARDINALITY);

      registry.incrementCounter('test', [{ key: 'label', value: 'overflow_value' }]);

      expect(registry.getLabelCardinality('test')).toBe(MAX_LABEL_CARDINALITY);
      expect(registry.getCounter('test', [{ key: 'label', value: 'overflow_value' }])).toBe(0);
    });

    it('allows existing labels even at cardinality limit', () => {
      const registry = getMetricsRegistry();

      for (let i = 0; i < MAX_LABEL_CARDINALITY; i++) {
        registry.incrementCounter('test', [{ key: 'label', value: `value_${i}` }]);
      }

      registry.incrementCounter('test', [{ key: 'label', value: 'value_0' }]);
      expect(registry.getCounter('test', [{ key: 'label', value: 'value_0' }])).toBe(2);
    });
  });

  describe('reset', () => {
    it('clears all metrics', () => {
      const registry = getMetricsRegistry();
      registry.incrementCounter('test_counter');
      registry.recordHistogram('test_histogram', 100);
      registry.setGauge('test_gauge', 42);

      registry.reset();

      expect(registry.getCounter('test_counter')).toBe(0);
      expect(registry.getHistogram('test_histogram')).toBeUndefined();
      expect(registry.getGauge('test_gauge')).toBe(0);
    });
  });

  describe('initializeMetrics', () => {
    it('registers all metric definitions', () => {
      initializeMetrics();
      const registry = getMetricsRegistry();
      const exported = registry.export();
      expect(exported.definitions).toBeDefined();
    });
  });
});
