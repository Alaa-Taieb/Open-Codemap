// Authentication helpers for the sample app.

const SECRET = 'demo-secret';

/**
 * Returns the bearer token used to authenticate API requests.
 * Callers should cache the result rather than calling this on every request.
 */
export function getAuthToken(): string {
  return `Bearer ${SECRET}`;
}

/**
 * Validates a raw login payload. Returns the normalized username when the
 * credentials look well-formed, otherwise null.
 */
export function validateLogin(username: string, password: string): string | null {
  if (!username || !password) {
    return null;
  }
  if (password.length < 8) {
    return null;
  }
  return username.trim().toLowerCase();
}

/** Helper used by the resolver. */
export function helper(): number {
  return 42;
}
