import type { Message } from '@langchain/langgraph-sdk';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StreamOptions = {
  onError?: (error: unknown) => void;
  onFinish?: (event: unknown) => void;
  onUpdateEvent?: (event: Record<string, unknown>) => void;
};

const mocks = vi.hoisted(() => {
  return {
    options: undefined as StreamOptions | undefined,
    thread: {
      messages: [] as Message[],
      isLoading: false,
      submit: vi.fn(),
      stop: vi.fn(),
    },
  };
});

vi.mock('@langchain/langgraph-sdk/react', () => ({
  useStream: (options: StreamOptions) => {
    mocks.options = options;
    return mocks.thread;
  },
}));

vi.mock('@/components/WelcomeScreen', () => ({
  WelcomeScreen: (props: {
    handleSubmit: (
      input: string,
      effort: string,
      model: string,
      agentId: string,
      attachments: unknown[]
    ) => void;
    isLoading: boolean;
    onCancel: () => void;
  }) => (
    <div data-testid="welcome-screen">
      <div data-testid="welcome-loading">{props.isLoading ? 'loading' : 'idle'}</div>
      <button type="button" onClick={props.onCancel}>
        cancel
      </button>
      <button
        type="button"
        onClick={() =>
          props.handleSubmit('next question', 'standard', 'test-model', 'deep_researcher', [])
        }
      >
        submit
      </button>
    </div>
  ),
}));

vi.mock('@/components/ChatMessagesView', () => ({
  ChatMessagesView: (props: {
    messages: Message[];
    isLoading: boolean;
    onCancel: () => void;
    onClarificationResume?: (
      value:
        | { userReply: string; candidateIndex?: number }
        | { cancel: true }
    ) => void;
    onSubmit: (
      input: string,
      effort: string,
      model: string,
      agentId: string,
      attachments: unknown[]
    ) => void;
    liveActivityEvents: Array<{ title: string }>;
    historicalActivities: Record<string, Array<{ title: string }>>;
  }) => (
    <div data-testid="chat-view">
      <div data-testid="activity-bubble">{props.isLoading ? 'loading' : 'idle'}</div>
      <div data-testid="live-activity">
        {props.liveActivityEvents.map((event) => event.title).join('|')}
      </div>
      <div data-testid="historical-activity">
        {Object.entries(props.historicalActivities)
          .map(([messageId, events]) => `${messageId}:${events.map((event) => event.title).join('|')}`)
          .join(';')}
      </div>
      {props.messages.map((message, index) => (
        <div key={message.id ?? index} data-testid={`message-${index}`}>
          {typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content)}
        </div>
      ))}
      <button type="button" onClick={props.onCancel}>
        cancel
      </button>
      <button
        type="button"
        onClick={() =>
          props.onSubmit('next question', 'standard', 'test-model', 'deep_researcher', [])
        }
      >
        submit-next
      </button>
      <button
        type="button"
        onClick={() =>
          props.onClarificationResume?.({
            userReply: 'Springfield, Illinois, United States',
            candidateIndex: 1,
          })
        }
      >
        resume-candidate
      </button>
      <button
        type="button"
        onClick={() => props.onClarificationResume?.({ cancel: true })}
      >
        resume-cancel
      </button>
    </div>
  ),
}));

vi.mock('@/lib/agent-run-config', () => ({
  getAgentRunConfig: () => ({}),
}));

import App from './App';

const humanMessage = {
  type: 'human',
  content: 'Question',
  id: 'human-1',
} as Message;

const finalAiMessage = {
  type: 'ai',
  content: 'Answer',
  id: 'ai-final',
} as Message;

function emitPlanEvent(title = 'Plan') {
  act(() => {
    mocks.options?.onUpdateEvent?.({
      runtimeEvents: [{ type: 'agent.plan.start', title, ts: 1 }],
    });
  });
}

function startStream() {
  fireEvent.click(screen.getByText('submit-next'));
}

function emitWeatherClarificationInterrupt() {
  act(() => {
    mocks.options?.onUpdateEvent?.({
      __interrupt__: [
        {
          value: {
            type: 'weather_clarification',
            weatherCapability: 'current',
            weatherExecution: {
              status: 'needs_clarification',
              result: {
                schemaVersion: '1.0',
                tool: 'current_weather',
                status: 'needs_clarification',
                requestedLocation: {
                  raw: 'Springfield',
                  location: 'Springfield',
                },
                candidates: [
                  {
                    name: 'Springfield',
                    displayName: 'Springfield, Illinois, United States',
                    latitude: 39.78,
                    longitude: -89.65,
                  },
                ],
                message: 'Location is ambiguous.',
                summary: 'Choose a location.',
              },
            },
          },
        },
      ],
    });
  });
}

describe('App stream activity state', () => {
  beforeEach(() => {
    mocks.options = undefined;
    mocks.thread.messages = [humanMessage];
    mocks.thread.isLoading = true;
    mocks.thread.submit.mockClear();
    mocks.thread.stop.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('archives finished activity to the final assistant message when the id is already available', () => {
    const { rerender } = render(<App />);

    startStream();
    emitPlanEvent('Plan');
    mocks.thread.messages = [humanMessage, finalAiMessage];
    rerender(<App />);

    act(() => {
      mocks.options?.onFinish?.({});
    });
    mocks.thread.isLoading = false;
    rerender(<App />);

    expect(screen.getByTestId('historical-activity')).toHaveTextContent(
      'ai-final:Plan'
    );
  });

  it('resolves pending archive when the final assistant message id appears after finish', () => {
    const { rerender } = render(<App />);

    startStream();
    emitPlanEvent('Plan');
    act(() => {
      mocks.options?.onFinish?.({});
    });
    mocks.thread.isLoading = false;
    rerender(<App />);

    expect(screen.getByTestId('historical-activity')).toHaveTextContent('');

    mocks.thread.messages = [humanMessage, finalAiMessage];
    rerender(<App />);

    expect(screen.getByTestId('historical-activity')).toHaveTextContent(
      'ai-final:Plan'
    );
  });

  it('resumes weather clarification with Command(resume) and blocks regular submit', () => {
    render(<App />);

    emitWeatherClarificationInterrupt();
    expect(screen.getByText(/Springfield, Illinois, United States/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('submit-next'));
    expect(mocks.thread.submit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('resume-candidate'));

    expect(mocks.thread.submit).toHaveBeenCalledTimes(1);
    expect(mocks.thread.submit).toHaveBeenCalledWith(null, {
      command: {
        resume: {
          userReply: 'Springfield, Illinois, United States',
          candidateIndex: 1,
        },
      },
    });
  });

  it('resumes cancellation with a structured cancel signal', () => {
    render(<App />);

    emitWeatherClarificationInterrupt();
    fireEvent.click(screen.getByText('resume-cancel'));

    expect(mocks.thread.submit).toHaveBeenCalledWith(null, {
      command: { resume: { cancel: true } },
    });
  });

  it('clears stale clarification once on the first non-interrupt resume event', () => {
    render(<App />);

    emitWeatherClarificationInterrupt();
    fireEvent.click(screen.getByText('resume-candidate'));
    expect(screen.getByText(/Springfield, Illinois, United States/)).toBeInTheDocument();

    act(() => {
      mocks.options?.onUpdateEvent?.({ runtimeEvents: [] });
    });
    expect(screen.queryByText(/Springfield, Illinois, United States/)).not.toBeInTheDocument();

    emitWeatherClarificationInterrupt();
    expect(screen.getByText(/Springfield, Illinois, United States/)).toBeInTheDocument();
  });

  it('clears stale clarification when a resume finishes without an update event', () => {
    render(<App />);

    emitWeatherClarificationInterrupt();
    fireEvent.click(screen.getByText('resume-candidate'));

    act(() => {
      mocks.options?.onFinish?.({});
    });

    expect(screen.queryByText(/Springfield, Illinois, United States/)).not.toBeInTheDocument();
  });

  it('keeps error terminal activity archived once and ignores late events', () => {
    const { rerender } = render(<App />);

    startStream();
    emitPlanEvent('Plan');
    act(() => {
      mocks.options?.onError?.({
        error: {
          source: 'bff',
          stage: 'langgraph_upstream_proxy',
          code: 'upstream_timeout',
          message: 'timeout',
        },
      });
    });
    mocks.thread.isLoading = false;
    rerender(<App />);

    emitPlanEvent('Late');
    rerender(<App />);

    expect(screen.getByTestId('historical-activity')).toHaveTextContent(
      'stream-error:Plan'
    );
    expect(screen.getByTestId('historical-activity')).not.toHaveTextContent('Late');
  });

  it('keeps cancelled activity archived once and ignores late events', () => {
    const { rerender } = render(<App />);

    startStream();
    emitPlanEvent('Plan');
    fireEvent.click(screen.getByText('cancel'));
    mocks.thread.isLoading = false;
    rerender(<App />);

    emitPlanEvent('Late');
    rerender(<App />);

    expect(screen.getByTestId('historical-activity')).toHaveTextContent(
      'local-cancelled-'
    );
    expect(screen.getByTestId('historical-activity')).toHaveTextContent('Plan');
    expect(screen.getByTestId('historical-activity')).not.toHaveTextContent('Late');
  });
});
