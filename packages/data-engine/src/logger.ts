export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

const format = (level: string, message: string, meta?: unknown): string =>
  `${new Date().toISOString()} ${level.padEnd(5)} ${message}${meta === undefined ? '' : ` ${safeJson(meta)}`}`;

const safeJson = (value: unknown): string => {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const consoleLogger: Logger = {
  debug: () => {},
  info: (message, meta) => console.log(format('info', message, meta)),
  warn: (message, meta) => console.warn(format('warn', message, meta)),
  error: (message, meta) => console.error(format('error', message, meta)),
};

export const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
