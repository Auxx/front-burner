import { Writable } from 'node:stream';
import pino from 'pino';
import { createLoggerOptions } from './logger-options';

function capture(logLevel: 'error' | 'warn' | 'info' | 'debug' = 'info') {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    }
  });
  const logger = pino(createLoggerOptions({ logLevel, logFormat: 'json' }), stream);
  return { logger, lines };
}

describe('createLoggerOptions', () => {
  it('writes ISO time, level label, message and module', () => {
    const { logger, lines } = capture();
    logger.child({ module: 'Health' }).info('hello');

    const entry = JSON.parse(lines[0]);
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('hello');
    expect(entry.module).toBe('Health');
    expect(entry.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('redacts authorization and cookie headers', () => {
    const { logger, lines } = capture();
    logger.info({ req: { headers: { authorization: 'Bearer x', cookie: 'a=b' } } }, 'request');
    logger.info({ res: { headers: { 'set-cookie': 'sid=secret' } } }, 'response');

    const text = lines.join('');
    expect(text).not.toContain('Bearer x');
    expect(text).not.toContain('a=b');
    expect(text).not.toContain('sid=secret');
  });

  it('honours the level', () => {
    const { logger, lines } = capture('warn');
    logger.info('dropped');
    logger.warn('kept');

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).message).toBe('kept');
  });

  it('uses the pino-pretty transport for the pretty format', () => {
    const options = createLoggerOptions({ logLevel: 'info', logFormat: 'pretty' });
    expect(options.transport).toMatchObject({ target: 'pino-pretty' });
  });
});
