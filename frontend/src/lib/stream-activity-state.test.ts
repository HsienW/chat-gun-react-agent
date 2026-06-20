import { describe, expect, it } from 'vitest';

import type { ProcessedEvent } from '@/components/ActivityTimeline';
import {
  createInitialStreamActivityState,
  streamActivityReducer,
} from '@/lib/stream-activity-state';

const firstEvent: ProcessedEvent = {
  title: 'First event',
  data: 'first',
  eventType: 'agent.plan.start',
};

const lateEvent: ProcessedEvent = {
  title: 'Late event',
  data: 'late',
  eventType: 'agent.answer.stream',
};

describe('streamActivityReducer', () => {
  it('moves from idle to running when a new stream starts and update events arrive', () => {
    const started = streamActivityReducer(createInitialStreamActivityState(), {
      type: 'streamStarted',
    });
    const updated = streamActivityReducer(started, {
      type: 'streamEventsReceived',
      events: [firstEvent],
    });

    expect(updated.lifecycle).toBe('running');
    expect(updated.liveActivityEvents).toEqual([firstEvent]);
  });

  it('ignores update events received before a stream starts', () => {
    const updated = streamActivityReducer(createInitialStreamActivityState(), {
      type: 'streamEventsReceived',
      events: [firstEvent],
    });

    expect(updated).toEqual(createInitialStreamActivityState());
  });

  it('converges successful finish and treats duplicate finish as idempotent', () => {
    const started = streamActivityReducer(createInitialStreamActivityState(), {
      type: 'streamStarted',
    });
    const running = streamActivityReducer(started, {
      type: 'streamEventsReceived',
      events: [firstEvent],
    });
    const finished = streamActivityReducer(running, {
      type: 'streamFinished',
      messagesLengthAtTerminal: 1,
    });
    const duplicateFinished = streamActivityReducer(finished, {
      type: 'streamFinished',
      messagesLengthAtTerminal: 1,
    });

    expect(finished.lifecycle).toBe('finished');
    expect(finished.pendingArchive).toEqual({
      lifecycle: 'finished',
      messagesLengthAtTerminal: 1,
    });
    expect(duplicateFinished).toEqual(finished);
  });

  it('converges non-cancel errors and ignores late progress events', () => {
    const started = streamActivityReducer(createInitialStreamActivityState(), {
      type: 'streamStarted',
    });
    const running = streamActivityReducer(started, {
      type: 'streamEventsReceived',
      events: [firstEvent],
    });
    const failed = streamActivityReducer(running, {
      type: 'streamFailed',
      errorKind: 'generic',
      message: 'boom',
      messagesLengthAtTerminal: 2,
    });
    const afterLateEvent = streamActivityReducer(failed, {
      type: 'streamEventsReceived',
      events: [lateEvent],
    });

    expect(failed.lifecycle).toBe('error');
    expect(failed.errorKind).toBe('generic');
    expect(afterLateEvent).toEqual(failed);
  });

  it('preserves timeout meaning as an error terminal state', () => {
    const failed = streamActivityReducer(createInitialStreamActivityState(), {
      type: 'streamFailed',
      errorKind: 'timeout',
      message: 'timed out',
      messagesLengthAtTerminal: 0,
    });

    expect(failed.lifecycle).toBe('error');
    expect(failed.errorKind).toBe('timeout');
  });

  it('converges user cancellation and ignores late progress events', () => {
    const started = streamActivityReducer(createInitialStreamActivityState(), {
      type: 'streamStarted',
    });
    const running = streamActivityReducer(started, {
      type: 'streamEventsReceived',
      events: [firstEvent],
    });
    const cancelled = streamActivityReducer(running, {
      type: 'streamCancelled',
      archiveMessageId: 'local-cancelled-1',
      messagesLengthAtTerminal: 1,
    });
    const afterLateEvent = streamActivityReducer(cancelled, {
      type: 'streamEventsReceived',
      events: [lateEvent],
    });

    expect(cancelled.lifecycle).toBe('cancelled');
    expect(cancelled.historicalActivities['local-cancelled-1']).toEqual([firstEvent]);
    expect(afterLateEvent).toEqual(cancelled);
  });

  it('archives live activity by assistant message id idempotently', () => {
    const started = streamActivityReducer(createInitialStreamActivityState(), {
      type: 'streamStarted',
    });
    const running = streamActivityReducer(started, {
      type: 'streamEventsReceived',
      events: [firstEvent],
    });
    const finished = streamActivityReducer(running, {
      type: 'streamFinished',
      messagesLengthAtTerminal: 1,
    });
    const archived = streamActivityReducer(finished, {
      type: 'archiveLiveActivity',
      messageId: 'ai-1',
    });
    const archivedAgain = streamActivityReducer(archived, {
      type: 'archiveLiveActivity',
      messageId: 'ai-1',
    });

    expect(archived.historicalActivities['ai-1']).toEqual([firstEvent]);
    expect(archivedAgain).toEqual(archived);
  });

  it('resets live state for a new submit while preserving historical activity', () => {
    const initial = createInitialStreamActivityState();
    const stateWithHistory = {
      ...initial,
      lifecycle: 'finished' as const,
      liveActivityEvents: [firstEvent],
      historicalActivities: { 'ai-1': [firstEvent] },
    };

    const reset = streamActivityReducer(stateWithHistory, {
      type: 'resetForAgentOrSubmit',
    });

    expect(reset.lifecycle).toBe('idle');
    expect(reset.liveActivityEvents).toEqual([]);
    expect(reset.pendingArchive).toBeNull();
    expect(reset.historicalActivities).toEqual({ 'ai-1': [firstEvent] });
  });
});
