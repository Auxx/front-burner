import { Config } from '@front-burner/server-core-config';
import pino from 'pino';
// Only a type: pino loads `pino-pretty` by name in a worker thread. The import
// lets Nx see the dependency, so that the build's generated package.json lists it.
import type { PrettyOptions } from 'pino-pretty';

/**
 * Options of every logger in the backend (NF-10.4, NF-10.5): ISO 8601 UTC
 * time, the level as its label, the text under `message`, and credentials
 * redacted.
 */
export function createLoggerOptions(config: Pick<Config, 'logLevel' | 'logFormat'>): pino.LoggerOptions {
  return {
    level: config.logLevel,
    messageKey: 'message',
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: label => ({ level: label }) },
    redact: [ 'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]' ],
    ...(config.logFormat === 'pretty'
      ? { transport: { target: 'pino-pretty', options: {} satisfies PrettyOptions } }
      : {})
  };
}

/** A logger for startup, before Nest and the configuration exist. */
export function createBootstrapLogger(
  config?: Pick<Config, 'logLevel' | 'logFormat'>,
  destination?: pino.DestinationStream
): pino.Logger {
  const options = createLoggerOptions(config ?? { logLevel: 'info', logFormat: 'json' });
  return destination ? pino(options, destination) : pino(options);
}
