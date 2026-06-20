import { useStream } from '@langchain/langgraph-sdk/react';
import type { Message } from '@langchain/langgraph-sdk';
import { useState, useEffect, useRef, useCallback, useMemo, useReducer } from 'react';

import { WelcomeScreen } from '@/components/WelcomeScreen';
import { ChatMessagesView } from '@/components/ChatMessagesView';
import {
  extractAgentRuntimeEvents,
  runtimeEventToProcessedEvent,
} from '@/lib/agent-runtime-events';
import { getAgentRunConfig } from '@/lib/agent-run-config';
import { FRONTEND_ERROR_MESSAGES } from '@/lib/error-messages';
import {
  createInitialStreamActivityState,
  streamActivityReducer,
} from '@/lib/stream-activity-state';
import type { StreamActivityState, StreamErrorKind } from '@/lib/stream-activity-state';
import type { ProcessedImageAttachment } from '@/lib/image-upload';
import { AgentId, DEFAULT_AGENT } from '@/types/agents';
import { formatErrorEnvelope, parseErrorEnvelope } from '@/types/errors';
import type { ErrorEnvelope } from '@/types/errors';
import { getAgentById, isValidAgentId } from '@/lib/agents';

const STREAM_ERROR_MESSAGE_ID = 'stream-error';

function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error) {
    return /abort|aborted/i.test(`${error.name} ${error.message}`);
  }
  return /abort|aborted/i.test(String(error));
}

function formatStreamError(error: unknown): string {
  const envelope =
    parseErrorEnvelope(error) ||
    parseErrorEnvelope(error instanceof Error ? error.message : String(error));

  if (envelope) {
    return formatErrorEnvelope(envelope);
  }

  return [
    `${FRONTEND_ERROR_MESSAGES.errorEnvelope.source}: ${FRONTEND_ERROR_MESSAGES.stream.source}`,
    `${FRONTEND_ERROR_MESSAGES.errorEnvelope.stage}: ${FRONTEND_ERROR_MESSAGES.stream.stage}`,
    `${FRONTEND_ERROR_MESSAGES.errorEnvelope.code}: ${FRONTEND_ERROR_MESSAGES.stream.unknownCode}`,
    `${FRONTEND_ERROR_MESSAGES.errorEnvelope.message}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  ].join('\n');
}

function getStreamErrorEnvelope(error: unknown): ErrorEnvelope | undefined {
  return (
    parseErrorEnvelope(error) ||
    parseErrorEnvelope(error instanceof Error ? error.message : String(error))
  );
}

function classifyStreamError(error: unknown): StreamErrorKind {
  const envelope = getStreamErrorEnvelope(error);
  const code = envelope?.error.code.toLowerCase();
  const causeCode = envelope?.error.cause?.code?.toLowerCase();

  if (code === 'timeout' || code === 'upstream_timeout' || causeCode === 'timeout') {
    return 'timeout';
  }

  if (isAbortError(error)) {
    return 'abort';
  }

  return 'generic';
}

function getLangGraphApiUrl(): string {
  const configuredUrl = import.meta.env.VITE_LANGGRAPH_API_URL;
  if (configuredUrl) return configuredUrl;

  return new URL('/api/langgraph', window.location.origin).toString();
}

function createCancelledAssistantMessage(): Message {
  return {
    type: 'ai',
    content: '已取消本次回覆。',
    id: `local-cancelled-${crypto.randomUUID()}`,
  } as Message;
}

function isTerminalStreamLifecycle(
  lifecycle: StreamActivityState['lifecycle']
): boolean {
  return lifecycle === 'finished' || lifecycle === 'error' || lifecycle === 'cancelled';
}

function findArchiveMessageId(
  messages: Message[],
  startIndex: number,
  excludeMessageId?: string
): string | undefined {
  return messages.slice(startIndex).find((message) => {
    return message.type === 'ai' && message.id && message.id !== excludeMessageId;
  })?.id;
}

function getCurrentFinalAssistantMessageId(messages: Message[]): string | undefined {
  const lastMessage = messages[messages.length - 1];
  return lastMessage?.type === 'ai' ? lastMessage.id : undefined;
}

export default function App() {
  const [streamActivityState, dispatchStreamActivity] = useReducer(
    streamActivityReducer,
    undefined,
    createInitialStreamActivityState
  );
  const [selectedAgentId, setSelectedAgentId] = useState(DEFAULT_AGENT);
  const [streamErrorMessage, setStreamErrorMessage] = useState<string | null>(null);
  const [cancelledMessage, setCancelledMessage] = useState<Message | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const selectedAgentIdRef = useRef(selectedAgentId);
  const messagesRef = useRef<Message[]>([]);
  const streamActivityStateRef = useRef(streamActivityState);

  useEffect(() => {
    selectedAgentIdRef.current = selectedAgentId;
  }, [selectedAgentId]);

  useEffect(() => {
    streamActivityStateRef.current = streamActivityState;
  }, [streamActivityState]);

  const validateAgentId = useCallback((agentId: string): string => {
    if (isValidAgentId(agentId)) {
      return agentId;
    }
    console.warn(`Invalid agent ID: ${agentId}, falling back to default`);
    return DEFAULT_AGENT;
  }, []);

  const handleAgentSwitch = useCallback(
    (newAgentId: string) => {
      const validAgentId = validateAgentId(newAgentId);
      if (validAgentId !== selectedAgentId) {
        setSelectedAgentId(validAgentId as AgentId);
        dispatchStreamActivity({
          type: 'resetForAgentOrSubmit',
          clearHistorical: true,
        });
        setCancelledMessage(null);
      }
    },
    [selectedAgentId, validateAgentId]
  );

  const handleAgentChange = useCallback(
    (agentId: string) => {
      const validAgentId = validateAgentId(agentId);
      setSelectedAgentId(validAgentId as AgentId);
    },
    [validateAgentId]
  );

  const handleStreamError = useCallback((error: unknown) => {
    // Best-effort fast path; reducer terminal idempotency is the primary guard.
    if (
      isAbortError(error) &&
      streamActivityStateRef.current.lifecycle === 'cancelled'
    ) {
      console.debug('Stream aborted by client action.');
      return;
    }
    const message = formatStreamError(error);
    setStreamErrorMessage(message);
    dispatchStreamActivity({
      type: 'streamFailed',
      errorKind: classifyStreamError(error),
      message,
      messagesLengthAtTerminal: messagesRef.current.length,
      archiveMessageId: STREAM_ERROR_MESSAGE_ID,
    });
    console.error('LangGraph stream error:', error);
  }, []);

  const handleStreamFinish = useCallback((event: unknown) => {
    void event;
    dispatchStreamActivity({
      type: 'streamFinished',
      messagesLengthAtTerminal: messagesRef.current.length,
      archiveMessageId: getCurrentFinalAssistantMessageId(messagesRef.current),
    });
  }, []);

  const handleStreamUpdate = useCallback((event: Record<string, unknown>) => {
    const currentAgent = getAgentById(selectedAgentIdRef.current);
    if (!currentAgent?.showActivityTimeline) return;

    const processedEvents = extractAgentRuntimeEvents(event).map(
      runtimeEventToProcessedEvent
    );

    if (processedEvents.length > 0) {
      dispatchStreamActivity({
        type: 'streamEventsReceived',
        events: processedEvents,
      });
    }
  }, []);

  const thread = useStream<{
    messages: Message[];
    initial_search_query_count: number;
    max_research_loops: number;
    reasoning_model: string;
  }>({
    apiUrl: getLangGraphApiUrl(),
    assistantId: selectedAgentId,
    messagesKey: 'messages',
    onError: handleStreamError,
    onFinish: handleStreamFinish,
    onUpdateEvent: handleStreamUpdate,
  });

  useEffect(() => {
    messagesRef.current = thread.messages;
  }, [thread.messages]);

  useEffect(() => {
    const pendingArchive = streamActivityState.pendingArchive;
    if (!pendingArchive) return;

    const archiveMessageId = findArchiveMessageId(
      thread.messages,
      pendingArchive.messagesLengthAtTerminal,
      pendingArchive.excludeMessageId
    );

    if (!archiveMessageId) return;

    dispatchStreamActivity({
      type: 'archiveLiveActivity',
      messageId: archiveMessageId,
    });
  }, [streamActivityState.pendingArchive, thread.messages]);

  const handleSubmit = useCallback(
    (
      submittedInputValue: string,
      effort: string,
      model: string,
      agentId: string,
      attachments: ProcessedImageAttachment[]
    ) => {
      const validAgentId = validateAgentId(agentId);
      if (!submittedInputValue.trim() && attachments.length === 0) return;

      handleAgentSwitch(validAgentId);
      dispatchStreamActivity({ type: 'resetForAgentOrSubmit' });
      dispatchStreamActivity({ type: 'streamStarted' });
      setStreamErrorMessage(null);
      setCancelledMessage(null);

      const messageContent: Message['content'] =
        attachments.length > 0
          ? [
              ...(submittedInputValue.trim()
                ? [{ type: 'text' as const, text: submittedInputValue.trim() }]
                : [{ type: 'text' as const, text: 'Analyze the uploaded image attachments.' }]),
              ...attachments.map((attachment) => ({
                type: 'image_url' as const,
                image_url: {
                  url: attachment.dataUrl,
                  detail: 'auto' as const,
                },
                fileName: attachment.fileName,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.processedBytes,
                width: attachment.width,
                height: attachment.height,
              })),
            ]
          : submittedInputValue;

      const newMessages: Message[] = [
        {
          type: 'human',
          content: messageContent,
          id: crypto.randomUUID(),
        },
      ];

      if (validAgentId === AgentId.DEEP_RESEARCHER) {
        const runConfig = getAgentRunConfig(validAgentId, effort);

        thread.submit({
          messages: newMessages,
          ...runConfig,
          reasoning_model: model,
        });
      } else {
        thread.submit({
          messages: newMessages,
        });
      }
    },
    [validateAgentId, handleAgentSwitch, thread]
  );

  const handleCancel = useCallback(() => {
    const localCancelledMessage = createCancelledAssistantMessage();
    dispatchStreamActivity({
      type: 'streamCancelled',
      messagesLengthAtTerminal: messagesRef.current.length,
      archiveMessageId: localCancelledMessage.id,
    });
    thread.stop();
    setCancelledMessage(localCancelledMessage);
  }, [thread]);

  const messagesWithStreamError = useMemo(
    () =>
      streamErrorMessage
        ? [
            ...thread.messages,
            {
              type: 'ai',
              content: streamErrorMessage,
              id: STREAM_ERROR_MESSAGE_ID,
            } as Message,
          ]
        : thread.messages,
    [thread.messages, streamErrorMessage]
  );
  const displayMessages = useMemo(
    () =>
      cancelledMessage
        ? [...messagesWithStreamError, cancelledMessage]
        : messagesWithStreamError,
    [messagesWithStreamError, cancelledMessage]
  );

  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollViewport = scrollAreaRef.current.querySelector(
        '[data-radix-scroll-area-viewport]'
      );
      if (scrollViewport) {
        scrollViewport.scrollTop = scrollViewport.scrollHeight;
      }
    }
  }, [displayMessages.length]);

  return (
    <div className="flex h-screen bg-background text-foreground font-sans antialiased">
      <main className="flex-1 flex flex-col max-w-4xl mx-auto w-full min-h-0">
        <div
          className={`flex-1 min-h-0 ${
            displayMessages.length === 0 ? 'flex' : ''
          }`}
        >
          {displayMessages.length === 0 ? (
            <WelcomeScreen
              handleSubmit={handleSubmit}
              isLoading={thread.isLoading}
              onCancel={handleCancel}
              selectedAgent={selectedAgentId}
              onAgentChange={handleAgentChange}
            />
          ) : (
            <ChatMessagesView
              messages={displayMessages}
              isLoading={thread.isLoading}
              scrollAreaRef={scrollAreaRef}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
              liveActivityEvents={
                isTerminalStreamLifecycle(streamActivityState.lifecycle)
                  ? []
                  : streamActivityState.liveActivityEvents
              }
              historicalActivities={streamActivityState.historicalActivities}
              selectedAgentId={selectedAgentId}
              onAgentChange={handleAgentChange}
            />
          )}
        </div>
      </main>
    </div>
  );
}
