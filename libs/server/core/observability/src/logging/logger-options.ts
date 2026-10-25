import { Config } from '@front-burner/server-core-config';
import pino from 'pino';

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
    ...(config.logFormat === 'pretty' ? { transport: { target: 'pino-pretty' } } : {})
  };
}

/** A logger for startup, before Nest and the configuration exist. */
export function createBootstrapLogger(config?: Pick<Config, 'logLevel' | 'logFormat'>): pino.Logger {
  return pino(createLoggerOptions(config ?? { logLevel: 'info', logFormat: 'json' }));
}
