import type { StreamErrorKind } from '@/lib/stream-activity-state';
import { parseErrorEnvelope } from '@/types/errors';
import type { ErrorEnvelope } from '@/types/errors';

function getStreamErrorEnvelope(error: unknown): ErrorEnvelope | undefined {
  return (
    parseErrorEnvelope(error) ||
    parseErrorEnvelope(error instanceof Error ? error.message : String(error))
  );
}

export function isStreamAbortError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error) {
    return /abort|aborted/i.test(`${error.name} ${error.message}`);
  }
  return /abort|aborted/i.test(String(error));
}

export function classifyStreamError(error: unknown): StreamErrorKind {
  const envelope = getStreamErrorEnvelope(error);
  const code = envelope?.error.code.toLowerCase();
  const causeCode = envelope?.error.cause?.code?.toLowerCase();

  if (
    code === 'timeout' ||
    code === 'upstream_timeout' ||
    code === 'bff_timeout' ||
    causeCode === 'timeout' ||
    causeCode === 'bff_timeout'
  ) {
    return 'timeout';
  }

  if (code === 'client_disconnected' || code === 'client_cancelled') {
    return 'abort';
  }

  if (isStreamAbortError(error)) {
    return 'abort';
  }

  return 'generic';
}
