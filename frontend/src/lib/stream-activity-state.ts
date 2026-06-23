import type { ProcessedEvent } from '@/components/ActivityTimeline';

export type StreamLifecycle = 'idle' | 'running' | 'finished' | 'error' | 'cancelled';

export type StreamErrorKind = 'generic' | 'timeout' | 'abort';

export type PendingArchive = {
  lifecycle: Exclude<StreamLifecycle, 'idle' | 'running'>;
  messagesLengthAtTerminal: number;
  excludeMessageId?: string;
};

export type StreamActivityState = {
  lifecycle: StreamLifecycle;
  liveActivityEvents: ProcessedEvent[];
  historicalActivities: Record<string, ProcessedEvent[]>;
  pendingArchive: PendingArchive | null;
  errorKind?: StreamErrorKind;
  errorMessage?: string;
};

export type StreamActivityAction =
  | { type: 'streamStarted' }
  | { type: 'streamEventsReceived'; events: ProcessedEvent[] }
  | {
      type: 'streamFinished';
      messagesLengthAtTerminal: number;
      archiveMessageId?: string;
    }
  | {
      type: 'streamFailed';
      errorKind: StreamErrorKind;
      message: string;
      messagesLengthAtTerminal: number;
      archiveMessageId?: string;
    }
  | {
      type: 'streamCancelled';
      messagesLengthAtTerminal: number;
      archiveMessageId?: string;
      excludeMessageId?: string;
    }
  | { type: 'archiveLiveActivity'; messageId: string }
  | { type: 'resetForAgentOrSubmit'; clearHistorical?: boolean };

export function createInitialStreamActivityState(): StreamActivityState {
  return {
    lifecycle: 'idle',
    liveActivityEvents: [],
    historicalActivities: {},
    pendingArchive: null,
  };
}

function isTerminal(lifecycle: StreamLifecycle): boolean {
  return lifecycle === 'finished' || lifecycle === 'error' || lifecycle === 'cancelled';
}

function archiveActivity(
  state: StreamActivityState,
  messageId: string
): StreamActivityState {
  if (state.historicalActivities[messageId]) {
    return {
      ...state,
      pendingArchive: null,
    };
  }

  return {
    ...state,
    historicalActivities: {
      ...state.historicalActivities,
      [messageId]: [...state.liveActivityEvents],
    },
    pendingArchive: null,
  };
}

function createPendingArchive(
  lifecycle: PendingArchive['lifecycle'],
  action: {
    messagesLengthAtTerminal: number;
    excludeMessageId?: string;
  }
): PendingArchive {
  return {
    lifecycle,
    messagesLengthAtTerminal: action.messagesLengthAtTerminal,
    excludeMessageId: action.excludeMessageId,
  };
}

export function streamActivityReducer(
  state: StreamActivityState,
  action: StreamActivityAction
): StreamActivityState {
  switch (action.type) {
    case 'streamStarted':
      if (state.lifecycle === 'running') return state;
      return {
        ...state,
        lifecycle: 'running',
        liveActivityEvents: [],
        pendingArchive: null,
        errorKind: undefined,
        errorMessage: undefined,
      };
    case 'streamEventsReceived':
      if (
        action.events.length === 0 ||
        state.lifecycle === 'idle' ||
        isTerminal(state.lifecycle)
      ) {
        return state;
      }
      return {
        ...state,
        lifecycle: 'running',
        liveActivityEvents: [...state.liveActivityEvents, ...action.events],
      };
    case 'streamFinished': {
      if (isTerminal(state.lifecycle)) return state;
      const finishedState: StreamActivityState = {
        ...state,
        lifecycle: 'finished',
        pendingArchive: createPendingArchive('finished', action),
      };
      return action.archiveMessageId
        ? archiveActivity(finishedState, action.archiveMessageId)
        : finishedState;
    }
    case 'streamFailed': {
      if (isTerminal(state.lifecycle)) return state;
      const failedState: StreamActivityState = {
        ...state,
        lifecycle: 'error',
        errorKind: action.errorKind,
        errorMessage: action.message,
        pendingArchive: createPendingArchive('error', {
          messagesLengthAtTerminal: action.messagesLengthAtTerminal,
        }),
      };
      return action.archiveMessageId
        ? archiveActivity(failedState, action.archiveMessageId)
        : failedState;
    }
    case 'streamCancelled': {
      if (isTerminal(state.lifecycle)) return state;
      const cancelledState: StreamActivityState = {
        ...state,
        lifecycle: 'cancelled',
        pendingArchive: createPendingArchive('cancelled', {
          messagesLengthAtTerminal: action.messagesLengthAtTerminal,
          excludeMessageId: action.excludeMessageId,
        }),
      };
      return action.archiveMessageId
        ? archiveActivity(cancelledState, action.archiveMessageId)
        : cancelledState;
    }
    case 'archiveLiveActivity':
      return archiveActivity(state, action.messageId);
    case 'resetForAgentOrSubmit':
      return {
        ...createInitialStreamActivityState(),
        historicalActivities: action.clearHistorical ? {} : state.historicalActivities,
      };
  }
}
