import { describe, expect, it } from 'vitest';

import { classifyStreamError } from '@/lib/stream-error-classification';

function envelope(code: string, causeCode?: string): string {
  return JSON.stringify({
    error: {
      source: 'bff',
      stage: 'langgraph_stream_proxy',
      code,
      message: 'Stream ended',
      cause: causeCode ? { code: causeCode } : undefined,
    },
  });
}

describe('classifyStreamError', () => {
  it('maps BFF timeout codes to timeout', () => {
    expect(classifyStreamError(envelope('bff_timeout'))).toBe('timeout');
    expect(classifyStreamError(envelope('upstream_error', 'bff_timeout'))).toBe(
      'timeout'
    );
  });

  it('maps client cancellation and disconnect codes to abort', () => {
    expect(classifyStreamError(envelope('client_disconnected'))).toBe('abort');
    expect(classifyStreamError(envelope('client_cancelled'))).toBe('abort');
  });

  it('keeps upstream stream and network errors generic', () => {
    expect(classifyStreamError(envelope('upstream_stream_error'))).toBe('generic');
    expect(classifyStreamError(envelope('upstream_network_error'))).toBe('generic');
    expect(classifyStreamError(envelope('upstream_error'))).toBe('generic');
  });

  it('does not classify timeout-like message text as timeout', () => {
    expect(classifyStreamError(new Error('fetch failed connect network timeout'))).toBe(
      'generic'
    );
  });
});
