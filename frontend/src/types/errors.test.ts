import { describe, expect, it } from 'vitest';

import { parseRateLimitError } from './errors';

describe('parseRateLimitError', () => {
  it('parses the standard BFF rate limit response', () => {
    expect(
      parseRateLimitError({ error: 'Rate limit exceeded', retryAfter: 45 })
    ).toEqual({ error: 'Rate limit exceeded', retryAfter: 45 });
  });

  it('parses a rate limit response serialized in an Error message', () => {
    expect(
      parseRateLimitError(
        new Error(JSON.stringify({ error: 'Rate limit exceeded', retryAfter: 2 }))
      )
    ).toEqual({ error: 'Rate limit exceeded', retryAfter: 2 });
  });

  it.each([
    { error: 'Rate limit exceeded', retryAfter: 0 },
    { error: 'Rate limit exceeded', retryAfter: -1 },
    { error: 'Rate limit exceeded', retryAfter: '45' },
    { error: 429, retryAfter: 45 },
    { error: 'Rate limit exceeded' },
  ])('rejects an invalid rate limit response: %o', (value) => {
    expect(parseRateLimitError(value)).toBeUndefined();
  });
});
