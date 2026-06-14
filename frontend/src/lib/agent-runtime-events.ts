import {
  RUNTIME_EVENT_LABELS,
  RUNTIME_EVENT_NODE_KEYS,
} from '@/lib/runtime-event-config';
import type {
  AgentRuntimeEvent,
  ContextSource,
} from '@/types/agent-runtime-events';

type ProcessedRuntimeEvent = {
  title: string;
  data: string | string[] | Record<string, unknown>;
  eventType: AgentRuntimeEvent['type'];
};

type RuntimeEventRule = {
  nodeKey: string;
  toEvents: (nodeValue: unknown) => AgentRuntimeEvent[];
};

const NODE_EVENT_RULES: RuntimeEventRule[] = [
  {
    nodeKey: RUNTIME_EVENT_NODE_KEYS.buildContextPack,
    toEvents: (nodeValue) => [getContextPackEvent(nodeValue)],
  },
  {
    nodeKey: RUNTIME_EVENT_NODE_KEYS.planResearch,
    toEvents: (nodeValue) => [
      {
        type: 'agent.plan.start',
        title: getPlanTitle(nodeValue),
        ts: Date.now(),
      },
    ],
  },
  {
    nodeKey: RUNTIME_EVENT_NODE_KEYS.targetedTools,
    toEvents: (nodeValue) => getToolEvents(nodeValue),
  },
  {
    nodeKey: RUNTIME_EVENT_NODE_KEYS.searchWeb,
    toEvents: (nodeValue) => getToolEvents(nodeValue),
  },
  {
    nodeKey: RUNTIME_EVENT_NODE_KEYS.fetchSources,
    toEvents: (nodeValue) => getToolEvents(nodeValue),
  },
  {
    nodeKey: RUNTIME_EVENT_NODE_KEYS.rankSources,
    toEvents: (nodeValue) => [getContextEvent(nodeValue)],
  },
  {
    nodeKey: RUNTIME_EVENT_NODE_KEYS.extractEvidence,
    toEvents: (nodeValue) => [getContextEvent(nodeValue)],
  },
  {
    nodeKey: RUNTIME_EVENT_NODE_KEYS.verifyCitations,
    toEvents: (nodeValue) => [getContextEvent(nodeValue)],
  },
  {
    nodeKey: RUNTIME_EVENT_NODE_KEYS.synthesizeAnswer,
    toEvents: (nodeValue) => getAnswerEvents(nodeValue),
  },
];

function stringifyEventData(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(stringifyEventData).join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function getNodeMessages(nodeValue: unknown): unknown[] {
  const messages = asRecord(nodeValue)?.messages;
  return Array.isArray(messages) ? messages : [];
}

function getRuntimeEvents(value: unknown): AgentRuntimeEvent[] {
  const runtimeEvents = asRecord(value)?.runtimeEvents;
  return Array.isArray(runtimeEvents)
    ? runtimeEvents.filter(isAgentRuntimeEvent)
    : [];
}

function isAgentRuntimeEvent(value: unknown): value is AgentRuntimeEvent {
  const type = asRecord(value)?.type;
  return typeof type === 'string' && type.startsWith('agent.');
}

function getPlanTitle(nodeValue: unknown): string {
  const plan = asRecord(asRecord(nodeValue)?.plan);
  const mode = typeof plan?.answerMode === 'string' ? plan.answerMode : undefined;
  return mode ? `${RUNTIME_EVENT_LABELS.plan}: ${mode}` : RUNTIME_EVENT_LABELS.plan;
}

function getToolName(message: unknown, fallback: string): string {
  const record = asRecord(message);
  return typeof record?.name === 'string' && record.name.trim()
    ? record.name
    : fallback;
}

function isErrorOutput(value: unknown): boolean {
  const text = stringifyEventData(value);
  return text.startsWith('Error:') || text.includes('"error"');
}

function getToolEvents(nodeValue: unknown): AgentRuntimeEvent[] {
  const messages = getNodeMessages(nodeValue);
  const fallbackToolName =
    typeof asRecord(nodeValue)?.toolName === 'string'
      ? String(asRecord(nodeValue)?.toolName)
      : 'tool';

  return messages.map((message) => {
    const record = asRecord(message);
    const toolName = getToolName(message, fallbackToolName);
    const content = record?.content;

    if (isErrorOutput(content)) {
      return {
        type: 'agent.tool.error',
        toolName,
        error: stringifyEventData(content),
        ts: Date.now(),
      };
    }

    return {
      type: 'agent.tool.success',
      toolName,
      output: content,
      costMs: 0,
      ts: Date.now(),
    };
  });
}

function getContextPackEvent(nodeValue: unknown): AgentRuntimeEvent {
  const contextPack = asRecord(asRecord(nodeValue)?.contextPack);
  return {
    type: 'agent.context.build',
    sources: getContextPackSources(contextPack),
    tokenEstimate: estimateTokens(JSON.stringify(contextPack ?? {})),
    ts: Date.now(),
  };
}

function getContextPackSources(
  contextPack: Record<string, unknown> | undefined
): ContextSource[] {
  const recentMessages = Array.isArray(contextPack?.recentMessages)
    ? contextPack.recentMessages
    : [];
  const assets = Array.isArray(contextPack?.assets) ? contextPack.assets : [];

  return [
    ...recentMessages.slice(0, 6).map((value, index) => {
      const message = asRecord(value);
      const role = typeof message?.role === 'string' ? message.role : 'message';
      return {
        sourceId: `recent-message-${index + 1}`,
        sourceType: 'message' as const,
        title: RUNTIME_EVENT_LABELS.contextSources.message(index + 1, role),
        summary: typeof message?.content === 'string' ? message.content : undefined,
      };
    }),
    ...assets.slice(0, 6).map((value, index) => {
      const asset = asRecord(value);
      return {
        sourceId:
          (typeof asset?.assetId === 'string' && asset.assetId) ||
          `asset-${index + 1}`,
        sourceType: 'asset' as const,
        title:
          (typeof asset?.caption === 'string' && asset.caption) ||
          RUNTIME_EVENT_LABELS.contextSources.asset(index + 1),
        summary: typeof asset?.status === 'string' ? asset.status : undefined,
      };
    }),
  ];
}

function getContextEvent(nodeValue: unknown): AgentRuntimeEvent {
  return {
    type: 'agent.context.build',
    sources: getContextSources(nodeValue),
    tokenEstimate: estimateTokens(JSON.stringify(nodeValue ?? {})),
    ts: Date.now(),
  };
}

function getContextSources(nodeValue: unknown): ContextSource[] {
  const record = asRecord(nodeValue);
  const values = Object.values(record ?? {}).flatMap((value) =>
    Array.isArray(value) ? value : []
  );

  if (values.length === 0) {
    return [
      {
        sourceId: 'context-source',
        sourceType: 'tool',
        title: RUNTIME_EVENT_LABELS.contextSources.fallback,
      },
    ];
  }

  return values.slice(0, 6).map((value, index) => {
    const item = asRecord(value);
    return {
      sourceId:
        (typeof item?.url === 'string' && item.url) ||
        (typeof item?.id === 'string' && item.id) ||
        `context-source-${index + 1}`,
      sourceType: 'tool',
      title:
        (typeof item?.title === 'string' && item.title) ||
        (typeof item?.name === 'string' && item.name) ||
        RUNTIME_EVENT_LABELS.contextSources.tool(index + 1),
      summary:
        (typeof item?.summary === 'string' && item.summary) ||
        (typeof item?.snippet === 'string' && item.snippet) ||
        undefined,
    };
  });
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function getAnswerEvents(nodeValue: unknown): AgentRuntimeEvent[] {
  const messages = getNodeMessages(nodeValue);
  return messages.map((message) => ({
    type: 'agent.answer.stream',
    delta: stringifyEventData(asRecord(message)?.content ?? message),
    ts: Date.now(),
  }));
}

export function extractAgentRuntimeEvents(
  event: Record<string, unknown>
): AgentRuntimeEvent[] {
  const directEvents = getRuntimeEvents(event);
  const nodeEvents = Object.values(event).flatMap(getRuntimeEvents);
  const adaptedEvents = NODE_EVENT_RULES.flatMap((rule) => {
    if (!(rule.nodeKey in event)) return [];
    if (getRuntimeEvents(event[rule.nodeKey]).length > 0) return [];
    return rule.toEvents(event[rule.nodeKey]);
  });

  return [...directEvents, ...nodeEvents, ...adaptedEvents];
}

export function runtimeEventToProcessedEvent(
  event: AgentRuntimeEvent
): ProcessedRuntimeEvent {
  switch (event.type) {
    case 'agent.plan.start':
      return {
        title: event.title,
        data: RUNTIME_EVENT_LABELS.planCreated,
        eventType: event.type,
      };
    case 'agent.tool.start':
      return {
        title: RUNTIME_EVENT_LABELS.toolStarted(event.toolName),
        data: stringifyEventData(event.input),
        eventType: event.type,
      };
    case 'agent.tool.success':
      return {
        title: RUNTIME_EVENT_LABELS.toolSuccess(event.toolName),
        data: stringifyEventData(event.output),
        eventType: event.type,
      };
    case 'agent.tool.error':
      return {
        title: RUNTIME_EVENT_LABELS.toolError(event.toolName),
        data: event.error,
        eventType: event.type,
      };
    case 'agent.context.build':
      return {
        title: RUNTIME_EVENT_LABELS.contextBuilt,
        data: {
          tokenEstimate: event.tokenEstimate,
          sources: event.sources.map((source) => source.title),
        },
        eventType: event.type,
      };
    case 'agent.answer.stream':
      return {
        title: RUNTIME_EVENT_LABELS.finalAnswer,
        data: event.delta,
        eventType: event.type,
      };
    case 'agent.card.emit':
      return {
        title: RUNTIME_EVENT_LABELS.card(event.cardType),
        data: stringifyEventData(event.payload),
        eventType: event.type,
      };
  }
}
