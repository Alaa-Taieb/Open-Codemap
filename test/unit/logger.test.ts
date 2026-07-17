import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createLogger } from '../../src/logger.js';

describe('logger', () => {
  let stderr: NodeJS.WriteStream;
  let chunks: string[];
  let origWrite: (chunk: string) => boolean;

  beforeEach(() => {
    chunks = [];
    stderr = process.stderr;
    origWrite = stderr.write.bind(stderr);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (stderr as any).write = (chunk: string) => {
      chunks.push(chunk);
      return true;
    };
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (stderr as any).write = origWrite;
    delete process.env.LOG_LEVEL;
    delete process.env.DEBUG;
  });

  it('respects LOG_LEVEL filtering', () => {
    process.env.LOG_LEVEL = 'error';
    const log = createLogger('t');
    log.info('hidden');
    log.error('shown');
    const out = chunks.join('');
    expect(out).toContain('shown');
    expect(out).not.toContain('hidden');
  });

  it('DEBUG=open-codemap forces debug level', () => {
    process.env.DEBUG = 'open-codemap';
    const log = createLogger('t');
    log.debug('visible');
    expect(chunks.join('')).toContain('visible');
  });

  it('child prefixes the tag', () => {
    process.env.LOG_LEVEL = 'debug';
    const child = createLogger('parent').child('child');
    child.info('hi');
    expect(chunks.join('')).toContain('[parent:child]');
  });
});
