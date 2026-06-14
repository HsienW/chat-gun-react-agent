import { useStream } from '@langchain/langgraph-sdk/react';
import type { Message } from '@langchain/langgraph-sdk';
import { useState, useEffect, useRef, useCallback } from 'react';

import { ProcessedEvent } from '@/components/ActivityTimeline';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { ChatMessagesView } from '@/components/ChatMessagesView';
import {
  extractAgentRuntimeEvents,
  runtimeEventToProcessedEvent,
} from '@/lib/agent-runtime-events';
import { getAgentRunConfig } from '@/lib/agent-run-config';
import { FRONTEND_ERROR_MESSAGES } from '@/lib/error-messages';
import type { ProcessedImageAttachment } from '@/lib/image-upload';
import { AgentId, DEFAULT_AGENT } from '@/types/agents';
import { formatErrorEnvelope, parseErrorEnvelope } from '@/types/errors';
import { getAgentById, isValidAgentId } from '@/lib/agents';

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

function getLangGraphApiUrl(): string {
  const configuredUrl = import.meta.env.VITE_LANGGRAPH_API_URL;
  if (configuredUrl) return configuredUrl;

  return new URL('/api/langgraph', window.location.origin).toString();
}

export default function App() {
  const [processedEventsTimeline, setProcessedEventsTimeline] = useState<
    ProcessedEvent[]
  >([]);
  const [historicalActivities, setHistoricalActivities] = useState<
    Record<string, ProcessedEvent[]>
  >({});
  const [selectedAgentId, setSelectedAgentId] = useState(DEFAULT_AGENT);
  const [streamErrorMessage, setStreamErrorMessage] = useState<string | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

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
        setProcessedEventsTimeline([]);
        setHistoricalActivities({});
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

  const thread = useStream<{
    messages: Message[];
    initial_search_query_count: number;
    max_research_loops: number;
    reasoning_model: string;
  }>({
    apiUrl: getLangGraphApiUrl(),
    assistantId: selectedAgentId,
    messagesKey: 'messages',
    onError: (error: unknown) => {
      if (isAbortError(error)) {
        console.debug('Stream aborted by client action.');
        return;
      }
      setStreamErrorMessage(formatStreamError(error));
      console.error('LangGraph stream error:', error);
    },
    onFinish: (event: unknown) => {
      console.log(event);
    },
    onUpdateEvent: (event: Record<string, unknown>) => {
      const currentAgent = getAgentById(selectedAgentId);
      if (!currentAgent?.showActivityTimeline) return;

      const processedEvents = extractAgentRuntimeEvents(event).map(
        runtimeEventToProcessedEvent
      );

      if (processedEvents.length > 0) {
        setProcessedEventsTimeline((prevEvents) => [
          ...prevEvents,
          ...processedEvents,
        ]);
      }
    },
  });

  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollViewport = scrollAreaRef.current.querySelector(
        '[data-radix-scroll-area-viewport]'
      );
      if (scrollViewport) {
        scrollViewport.scrollTop = scrollViewport.scrollHeight;
      }
    }
  }, [thread.messages]);

  useEffect(() => {
    if (thread.isLoading || processedEventsTimeline.length === 0) return;

    const lastMessage = thread.messages[thread.messages.length - 1];
    if (lastMessage?.type === 'ai' && lastMessage.id) {
      setHistoricalActivities((prev) => {
        if (prev[lastMessage.id!]) return prev;
        return {
          ...prev,
          [lastMessage.id!]: [...processedEventsTimeline],
        };
      });
    }
  }, [thread.messages, thread.isLoading, processedEventsTimeline]);

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
      setProcessedEventsTimeline([]);
      setStreamErrorMessage(null);

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
    thread.stop();
  }, [thread]);

  return (
    <div className="flex h-screen bg-background text-foreground font-sans antialiased">
      <main className="flex-1 flex flex-col max-w-4xl mx-auto w-full min-h-0">
        <div
          className={`flex-1 min-h-0 ${
            thread.messages.length === 0 ? 'flex' : ''
          }`}
        >
          {thread.messages.length === 0 ? (
            <WelcomeScreen
              handleSubmit={handleSubmit}
              isLoading={thread.isLoading}
              onCancel={handleCancel}
              selectedAgent={selectedAgentId}
              onAgentChange={handleAgentChange}
            />
          ) : (
            <ChatMessagesView
              messages={
                streamErrorMessage
                  ? [
                      ...thread.messages,
                      {
                        type: 'ai',
                        content: streamErrorMessage,
                        id: 'stream-error',
                      } as Message,
                    ]
                  : thread.messages
              }
              isLoading={thread.isLoading}
              scrollAreaRef={scrollAreaRef}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
              liveActivityEvents={processedEventsTimeline}
              historicalActivities={historicalActivities}
              selectedAgentId={selectedAgentId}
              onAgentChange={handleAgentChange}
            />
          )}
        </div>
      </main>
    </div>
  );
}
