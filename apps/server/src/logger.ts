import type { Logger } from '@devias/data-engine';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const meta = (value: unknown): string => {
  if (value === undefined) {
    return '';
  }

  if (value instanceof Error) {
    return ` ${value.name}: ${value.message}`;
  }

  try {
    return ` ${JSON.stringify(value)}`;
  } catch {
    return ` ${String(value)}`;
  }
};

export const createLogger = (level: LogLevel = 'info'): Logger => {
  const min = ORDER[level];
  const emit = (l: LogLevel, message: string, extra?: unknown) => {
    if (ORDER[l] < min) {
      return;
    }

    const line = `${new Date().toISOString()} ${l.padEnd(5)} ${message}${meta(extra)}`;

    if (l === 'error') {
      console.error(line);
    } else if (l === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  };

  return {
    debug: (m, x) => emit('debug', m, x),
    info: (m, x) => emit('info', m, x),
    warn: (m, x) => emit('warn', m, x),
    error: (m, x) => emit('error', m, x),
  };
};
