import pino from 'pino';
import { redactSecrets } from './redact.js';
import type {
  ChainEventProvenance,
  ChildLoggerOptions,
  LoggerOptions,
  StandardLogFields,
} from './types.js';

function createPinoInstance(options: LoggerOptions): pino.Logger {
  return pino({
    level: options.level ?? 'info',
    formatters: {
      bindings() {
        return {};
      },
      level(label) {
        return { level: label };
      },
    },
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
    hooks: {
      logMethod(inputArgs, method) {
        const sanitized = inputArgs.map((arg) => {
          if (typeof arg === 'object' && arg !== null) {
            return redactSecrets(arg);
          }
          return arg;
        });
        return method.apply(this, sanitized as Parameters<typeof method>);
      },
    },
    base: {
      service: options.service ?? 'hood-sentry',
      environment: options.environment,
      version: options.version,
      requestId: options.requestId,
      traceId: options.traceId,
      spanId: options.spanId,
      ...options.bindings,
    },
  });
}

export class Logger {
  private readonly pino: pino.Logger;
  private readonly baseFields: StandardLogFields;

  private constructor(pinoInstance: pino.Logger, baseFields: StandardLogFields = {}) {
    this.pino = pinoInstance;
    this.baseFields = baseFields;
  }

  static create(options: LoggerOptions = {}): Logger {
    const baseFields: StandardLogFields = {
      service: options.service,
      environment: options.environment,
      version: options.version,
      requestId: options.requestId,
      traceId: options.traceId,
      spanId: options.spanId,
    };
    return new Logger(createPinoInstance(options), baseFields);
  }

  child(options: ChildLoggerOptions): Logger {
    const childFields: StandardLogFields = {
      ...this.baseFields,
      requestId: options.requestId ?? this.baseFields.requestId,
      traceId: options.traceId ?? this.baseFields.traceId,
      spanId: options.spanId ?? this.baseFields.spanId,
      userId: options.userId,
      walletAddress: options.walletAddress,
      chainId: options.chainId,
      jobName: options.jobName,
      jobId: options.jobId,
    };

    const childPino = this.pino.child(redactSecrets(childFields) as Record<string, unknown>);
    return new Logger(childPino, childFields);
  }

  forRequest(requestId: string, traceId?: string): Logger {
    return this.child({ requestId, traceId });
  }

  forJob(jobName: string, jobId: string): Logger {
    return this.child({ jobName, jobId });
  }

  forChainEvent(provenance: ChainEventProvenance): Logger {
    return this.child({
      chainId: provenance.chainId,
      bindings: {
        blockNumber: Number(provenance.blockNumber),
        blockHash: provenance.blockHash,
        transactionHash: provenance.transactionHash,
        logIndex: provenance.logIndex,
        trustClass: provenance.trustClass,
      },
    });
  }

  trace(msg: string, data?: Record<string, unknown>): void {
    data
      ? this.pino.trace(redactSecrets(data) as Record<string, unknown>, msg)
      : this.pino.trace(msg);
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    data
      ? this.pino.debug(redactSecrets(data) as Record<string, unknown>, msg)
      : this.pino.debug(msg);
  }

  info(msg: string, data?: Record<string, unknown>): void {
    data
      ? this.pino.info(redactSecrets(data) as Record<string, unknown>, msg)
      : this.pino.info(msg);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    data
      ? this.pino.warn(redactSecrets(data) as Record<string, unknown>, msg)
      : this.pino.warn(msg);
  }

  error(msg: string, data?: Record<string, unknown>): void {
    data
      ? this.pino.error(redactSecrets(data) as Record<string, unknown>, msg)
      : this.pino.error(msg);
  }

  fatal(msg: string, data?: Record<string, unknown>): void {
    data
      ? this.pino.fatal(redactSecrets(data) as Record<string, unknown>, msg)
      : this.pino.fatal(msg);
  }

  logOperation(
    operation: string,
    startTime: number,
    result: 'success' | 'failure',
    data?: Record<string, unknown>,
  ): void {
    const durationMs = Date.now() - startTime;
    const logData = {
      ...data,
      durationMs,
      result,
      operation,
    };

    if (result === 'success') {
      this.info(`Operation completed: ${operation}`, logData);
    } else {
      this.error(`Operation failed: ${operation}`, logData);
    }
  }
}

let defaultLogger: Logger | null = null;

export function getLogger(options?: LoggerOptions): Logger {
  if (!defaultLogger) {
    defaultLogger = Logger.create(options);
  }
  return defaultLogger;
}

export function createLogger(options: LoggerOptions): Logger {
  return Logger.create(options);
}

export function resetDefaultLogger(): void {
  defaultLogger = null;
}
