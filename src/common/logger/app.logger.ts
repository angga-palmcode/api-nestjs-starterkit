import type { LoggerService } from '@nestjs/common';
import { requestContext } from '../request-context/request-context';

export type LogLevel = 'verbose' | 'debug' | 'log' | 'warn' | 'error' | 'fatal';
export type LogFormat = 'json' | 'pretty';

const RANK: Record<LogLevel, number> = {
  verbose: 0,
  debug: 1,
  log: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context?: string;
  request_id?: string;
  message?: unknown;
  stack?: string;
  [field: string]: unknown;
}

export interface AppLoggerOptions {
  level: LogLevel;
  format: LogFormat;
  /** Output sink; defaults to stdout (stderr for error/fatal). */
  write?: (line: string, level: LogLevel) => void;
}

const defaultWrite = (line: string, level: LogLevel): void => {
  (RANK[level] >= RANK.error ? process.stderr : process.stdout).write(
    `${line}\n`,
  );
};

/**
 * Minimal structured logger behind Nest's `LoggerService`. Emits one JSON line
 * per entry (or a readable line in dev) and stamps the current `request_id`.
 * Object messages are merged into the entry, so `logger.log({ message, ...fields })` works.
 */
export class AppLogger implements LoggerService {
  private readonly write: (line: string, level: LogLevel) => void;

  constructor(private readonly options: AppLoggerOptions) {
    this.write = options.write ?? defaultWrite;
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    this.emit('verbose', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]): void {
    this.emit('debug', message, rest);
  }
  log(message: unknown, ...rest: unknown[]): void {
    this.emit('log', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]): void {
    this.emit('warn', message, rest);
  }
  error(message: unknown, ...rest: unknown[]): void {
    this.emit('error', message, rest);
  }
  fatal(message: unknown, ...rest: unknown[]): void {
    this.emit('fatal', message, rest);
  }

  private emit(level: LogLevel, message: unknown, rest: unknown[]): void {
    if (RANK[level] < RANK[this.options.level]) return;

    // Nest convention: trailing string is the context; for errors a preceding string is the stack.
    const args = [...rest];
    const context =
      typeof args[args.length - 1] === 'string'
        ? (args.pop() as string)
        : undefined;
    const stack =
      level === 'error' || level === 'fatal'
        ? typeof args[0] === 'string'
          ? args[0]
          : undefined
        : undefined;

    const fields =
      message !== null &&
      typeof message === 'object' &&
      !(message instanceof Error)
        ? (message as Record<string, unknown>)
        : {
            message:
              message instanceof Error ? message.message : String(message),
          };

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      context,
      request_id: requestContext.getRequestId(),
      ...fields,
      stack: stack ?? (message instanceof Error ? message.stack : undefined),
    };

    this.write(this.format(entry), level);
  }

  private format(entry: LogEntry): string {
    if (this.options.format === 'json') return JSON.stringify(entry);

    const { timestamp, level, context, request_id, message, stack, ...extra } =
      entry;
    const head = [
      timestamp,
      level.toUpperCase().padEnd(7),
      context ? `[${context}]` : '',
      request_id ? `(${request_id})` : '',
      typeof message === 'string' ? message : '',
    ]
      .filter(Boolean)
      .join(' ');
    const tail = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
    return `${head}${tail}${typeof stack === 'string' ? `\n${stack}` : ''}`;
  }
}
