import { describe, it, expect } from 'vitest';
import {
  CodemapError,
  ParseError,
  EmbedError,
  StoreError,
  ConfigError,
  WorkspaceNotFound,
  NotFoundError,
  asCodemapError,
  HTTP_STATUS_FOR_CODE,
  type ErrorCode,
} from '../../src/errors.js';

describe('typed errors', () => {
  const cases: Array<
    [new (m: string, o?: { cause?: unknown }) => CodemapError, ErrorCode, number]
  > = [
    [ParseError, 'PARSE_ERROR', 422],
    [EmbedError, 'EMBED_ERROR', 502],
    [StoreError, 'STORE_ERROR', 500],
    [ConfigError, 'CONFIG_ERROR', 400],
    [WorkspaceNotFound, 'WORKSPACE_NOT_FOUND', 404],
    [NotFoundError, 'NOT_FOUND', 404],
  ];

  for (const [Ctor, code, status] of cases) {
    it(`${Ctor.name} exposes .code and is instanceof CodemapError`, () => {
      const err = new Ctor('boom');
      expect(err).toBeInstanceOf(CodemapError);
      expect(err).toBeInstanceOf(Ctor);
      expect(err.code).toBe(code);
      expect(err.statusCode).toBe(status);
      expect(HTTP_STATUS_FOR_CODE[code]).toBe(status);
      expect(err.message).toBe('boom');
    });

    it(`${Ctor.name} preserves cause`, () => {
      const cause = new Error('root');
      const err = new Ctor('boom', { cause });
      expect(err.cause).toBe(cause);
    });
  }

  it('asCodemapError passes through typed errors', () => {
    const e = new ConfigError('x');
    expect(asCodemapError(e)).toBe(e);
  });

  it('asCodemapError wraps unknown errors', () => {
    const e = asCodemapError(new Error('weird'));
    expect(e).toBeInstanceOf(CodemapError);
    expect(e.code).toBe('INTERNAL_ERROR');
    const s = asCodemapError('plain string');
    expect(s.code).toBe('INTERNAL_ERROR');
  });
});
