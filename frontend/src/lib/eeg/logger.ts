// @ts-nocheck — link-band-sdk 이식본 (verbatim/noUnusedLocals 완화)
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const MIN_LEVEL: LogLevel = (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ? 'debug' : 'info';

export class Logger {
  private module: string;
  constructor(module: string) { this.module = module; }

  private log(level: LogLevel, args: unknown[]) {
    if (LEVELS[level] < LEVELS[MIN_LEVEL]) return;
    const prefix = `[${this.module}]`;
    const method = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    method(prefix, ...args);
  }

  debug(...args: unknown[]) { this.log('debug', args); }
  info(...args: unknown[]) { this.log('info', args); }
  warn(...args: unknown[]) { this.log('warn', args); }
  error(...args: unknown[]) { this.log('error', args); }
}

export function createLogger(module: string): Logger {
  return new Logger(module);
}
