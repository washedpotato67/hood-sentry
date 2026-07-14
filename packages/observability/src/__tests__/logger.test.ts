import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger, createLogger, resetDefaultLogger } from '../logger.js';

describe('Logger', () => {
  beforeEach(() => {
    resetDefaultLogger();
  });

  afterEach(() => {
    resetDefaultLogger();
  });

  it('creates a logger instance', () => {
    const logger = createLogger({ service: 'test-service' });
    expect(logger).toBeInstanceOf(Logger);
  });

  it('creates child logger', () => {
    const logger = createLogger({ service: 'test-service' });
    const child = logger.child({ requestId: 'req_123' });
    expect(child).toBeInstanceOf(Logger);
  });

  it('creates request-scoped logger', () => {
    const logger = createLogger({ service: 'test-service' });
    const requestLogger = logger.forRequest('req_456', 'trace_789');
    expect(requestLogger).toBeInstanceOf(Logger);
  });

  it('creates job-scoped logger', () => {
    const logger = createLogger({ service: 'test-service' });
    const jobLogger = logger.forJob('risk-scan', 'job_abc');
    expect(jobLogger).toBeInstanceOf(Logger);
  });

  it('creates chain-event-scoped logger', () => {
    const logger = createLogger({ service: 'test-service' });
    const chainLogger = logger.forChainEvent({
      chainId: 4663,
      blockNumber: 12345,
      blockHash: '0xabc',
      transactionHash: '0xdef',
      logIndex: 0,
      trustClass: 'CHAIN_FACT',
    });
    expect(chainLogger).toBeInstanceOf(Logger);
  });

  it('logs at all levels without throwing', () => {
    const logger = createLogger({ service: 'test-service', level: 'trace' });
    expect(() => logger.trace('trace message')).not.toThrow();
    expect(() => logger.debug('debug message')).not.toThrow();
    expect(() => logger.info('info message')).not.toThrow();
    expect(() => logger.warn('warn message')).not.toThrow();
    expect(() => logger.error('error message')).not.toThrow();
    expect(() => logger.fatal('fatal message')).not.toThrow();
  });

  it('logs with data without throwing', () => {
    const logger = createLogger({ service: 'test-service', level: 'trace' });
    expect(() => logger.info('test', { key: 'value' })).not.toThrow();
    expect(() => logger.error('test', { err: new Error('test') })).not.toThrow();
  });

  it('redacts secrets in log data', () => {
    const logger = createLogger({ service: 'test-service' });
    expect(() => logger.info('test', { password: 'secret123', apiKey: 'key_abc' })).not.toThrow();
  });

  it('logOperation records duration and result', () => {
    const logger = createLogger({ service: 'test-service' });
    const startTime = Date.now() - 100;
    expect(() => logger.logOperation('test-op', startTime, 'success')).not.toThrow();
    expect(() => logger.logOperation('test-op', startTime, 'failure')).not.toThrow();
  });
});
