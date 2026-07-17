/**
 * Minimal leveled logger with no external dependency.
 *
 * Level is controlled by the `LOG_LEVEL` env var (one of debug|info|warn|error,
 * default `info`) or the `DEBUG` env var (set to `open-codemap` to force debug).
 * Output goes to stderr so it never pollutes piped stdout (JSON results).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function currentLevel(): LogLevel {
  if (process.env.DEBUG === 'open-codemap' || process.env.DEBUG === '*') return 'debug';
  const lvl = process.env.LOG_LEVEL?.toLowerCase();
  if (lvl && lvl in LEVEL_WEIGHT) return lvl as LogLevel;
  return 'info';
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(prefix: string): Logger;
}

function format(level: LogLevel, prefix: string, args: unknown[]): string {
  const ts = new Date().toISOString();
  const tag = prefix ? `[${prefix}]` : '';
  const head = `${ts} ${level.toUpperCase()} ${tag}`.trimEnd();
  return [head, ...args.map((a) => (typeof a === 'string' ? a : safeStringify(a)))].join(' ');
}

function safeStringify(a: unknown): string {
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

export function createLogger(prefix = ''): Logger {
  const log = (level: LogLevel, args: unknown[]) => {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[currentLevel()]) return;
    const line = format(level, prefix, args);
    if (level === 'error') process.stderr.write(line + '\n');
    else process.stderr.write(line + '\n');
  };

  return {
    debug: (...args) => log('debug', args),
    info: (...args) => log('info', args),
    warn: (...args) => log('warn', args),
    error: (...args) => log('error', args),
    child: (childPrefix: string) => createLogger(prefix ? `${prefix}:${childPrefix}` : childPrefix),
  };
}

/** The default shared logger instance. */
export const logger: Logger = createLogger('open-codemap');
