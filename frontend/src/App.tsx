import { useStream } from '@langchain/langgraph-sdk/react';
import type { Message } from '@langchain/langgraph-sdk';
import { useState, useEffect, useRef, useCallback } from 'react';

import { ProcessedEvent } from '@/components/ActivityTimeline';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { ChatMessagesView } from '@/components/ChatMessagesView';
import { AgentId, DEFAULT_AGENT } from '@/types/agents';
import { getAgentById, isValidAgentId } from '@/lib/agents';

function stringifyEventData(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(stringifyEventData).join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '');
}

function getNodeMessages(nodeValue: unknown): unknown[] {
  if (!nodeValue || typeof nodeValue !== 'object') return [];
  const messages = (nodeValue as { messages?: unknown }).messages;
  return Array.isArray(messages) ? messages : [];
}

function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error) {
    return /abort|aborted/i.test(`${error.name} ${error.message}`);
  }
  return /abort|aborted/i.test(String(error));
}

function getLangGraphApiUrl(): string {
  const configuredUrl = import.meta.env.VITE_LANGGRAPH_API_URL;
  if (configuredUrl) return configuredUrl;

  return new URL('/api/langgraph', window.location.origin).toString();
}

function processDeepResearchEvent(
  event: Record<string, unknown>
): ProcessedEvent | null {
  if ('plan_research' in event) {
    return {
      title: 'Research Plan',
      data: 'Planned route and selected tools.',
    };
  }

  if ('targeted_tools' in event) {
    const messages = getNodeMessages(event.targeted_tools);
    const toolNames = messages
      .map((message) => {
        if (!message || typeof message !== 'object') return undefined;
        return (message as { name?: string }).name;
      })
      .filter(Boolean);
    return {
      title: 'Targeted Tool Results',
      data: toolNames.length ? toolNames.join(', ') : stringifyEventData(event.targeted_tools),
    };
  }

  if ('search_web' in event) {
    const messages = getNodeMessages(event.search_web);
    const toolNames = messages
      .map((message) => {
        if (!message || typeof message !== 'object') return undefined;
        return (message as { name?: string }).name;
      })
      .filter(Boolean);

    return {
      title: 'Web Search Results',
      data: toolNames.length ? toolNames.join(', ') : stringifyEventData(event.search_web),
    };
  }

  if ('rank_sources' in event) {
    return {
      title: 'Source Ranking',
      data: 'Deduplicated and ranked candidate sources.',
    };
  }

  if ('fetch_sources' in event) {
    return {
      title: 'Source Fetching',
      data: 'Fetched selected source pages.',
    };
  }

  if ('extract_evidence' in event) {
    return {
      title: 'Evidence Extraction',
      data: 'Extracted source summaries and key claims.',
    };
  }

  if ('verify_citations' in event) {
    return {
      title: 'Citation Verification',
      data: 'Checked usable sources and warnings.',
    };
  }

  if ('synthesize_answer' in event) {
    return {
      title: 'Final Answer',
      data: 'Generated final answer from accumulated conversation and tool results.',
    };
  }

  return null;
}

export default function App() {
  const [processedEventsTimeline, setProcessedEventsTimeline] = useState<
    ProcessedEvent[]
  >([]);
  const [historicalActivities, setHistoricalActivities] = useState<
    Record<string, ProcessedEvent[]>
  >({});
  const [selectedAgentId, setSelectedAgentId] = useState(DEFAULT_AGENT);
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
      console.error('LangGraph stream error:', error);
    },
    onFinish: (event: unknown) => {
      console.log(event);
    },
    onUpdateEvent: (event: Record<string, unknown>) => {
      const currentAgent = getAgentById(selectedAgentId);
      if (!currentAgent?.showActivityTimeline) return;

      let processedEvent: ProcessedEvent | null = null;

      if (selectedAgentId === AgentId.DEEP_RESEARCHER) {
        processedEvent = processDeepResearchEvent(event);
      }

      if ('tool_call_chunks' in event && Array.isArray(event.tool_call_chunks)) {
        const toolChunks = event.tool_call_chunks as Array<{ name?: string }>;
        processedEvent = {
          title: 'Tool Call Streaming',
          data: toolChunks.map((chunk) => chunk.name || 'tool').join(', '),
        };
      }

      if (processedEvent) {
        setProcessedEventsTimeline((prevEvents) => [
          ...prevEvents,
          processedEvent!,
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
      agentId: string
    ) => {
      const validAgentId = validateAgentId(agentId);
      if (!submittedInputValue.trim()) return;

      handleAgentSwitch(validAgentId);
      setProcessedEventsTimeline([]);

      const newMessages: Message[] = [
        {
          type: 'human',
          content: submittedInputValue,
          id: crypto.randomUUID(),
        },
      ];

      if (validAgentId === AgentId.DEEP_RESEARCHER) {
        let max_research_loops = 3;
        let initial_search_query_count = 3;

        switch (effort) {
          case 'low':
            max_research_loops = 2;
            initial_search_query_count = 1;
            break;
          case 'medium':
            max_research_loops = 6;
            initial_search_query_count = 3;
            break;
          case 'high':
            max_research_loops = 12;
            initial_search_query_count = 5;
            break;
        }

        thread.submit({
          messages: newMessages,
          initial_search_query_count,
          max_research_loops,
          reasoning_model: model,
        }, {
          onDisconnect: 'continue',
        });
      } else {
        thread.submit({
          messages: newMessages,
        }, {
          onDisconnect: 'continue',
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
              messages={thread.messages}
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
