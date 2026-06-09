import type { Message as LangGraphMessage } from '@langchain/langgraph-sdk';
import { formatErrorEnvelope, parseErrorEnvelope } from './errors';
import { ToolCall, ToolMessage } from './tools';

export interface ExtendedMessage {
  id?: string;
  type: string;
  content: unknown;
  tool_calls?: ToolCall[];
  tool_call_chunks?: unknown[];
  tool_call_id?: string;
  name?: string;
  additional_kwargs?: {
    tool_calls?: unknown[];
    name?: string;
  };
  role?: string;
  tool_name?: string;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  return typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function normalizeToolCall(
  rawToolCall: unknown,
  index: number,
  messageId: string | undefined
): ToolCall | undefined {
  if (!rawToolCall || typeof rawToolCall !== 'object') {
    return undefined;
  }

  const record = rawToolCall as Record<string, unknown>;
  const functionCall = record.functionCall as
    | { name?: string; args?: Record<string, unknown> }
    | undefined;
  const openAiFunction = record.function as
    | { name?: string; arguments?: unknown }
    | undefined;

  const name =
    (typeof record.name === 'string' && record.name) ||
    functionCall?.name ||
    openAiFunction?.name;

  if (!name) {
    return undefined;
  }

  const rawArgs =
    record.args ??
    record.input ??
    functionCall?.args ??
    openAiFunction?.arguments;
  const args = parseJsonObject(rawArgs);

  return {
    id:
      (typeof record.id === 'string' && record.id) ||
      `${messageId ?? 'tool-call'}-${name}-${index}`,
    name,
    args,
    type: 'tool_call',
  };
}

export function extractToolCallsFromMessage(
  message: ExtendedMessage | LangGraphMessage
): ToolCall[] {
  const extendedMessage = message as ExtendedMessage;
  const candidates: unknown[] = [];

  if (Array.isArray(extendedMessage.tool_calls)) {
    candidates.push(...extendedMessage.tool_calls);
  }

  if (Array.isArray(extendedMessage.additional_kwargs?.tool_calls)) {
    candidates.push(...extendedMessage.additional_kwargs.tool_calls);
  }

  if (Array.isArray(extendedMessage.content)) {
    candidates.push(
      ...extendedMessage.content.filter((contentBlock) => {
        return (
          contentBlock &&
          typeof contentBlock === 'object' &&
          ('functionCall' in contentBlock || (contentBlock as { type?: string }).type === 'tool_use')
        );
      })
    );
  }

  return candidates
    .map((candidate, index) =>
      normalizeToolCall(candidate, index, extendedMessage.id)
    )
    .filter((toolCall): toolCall is ToolCall => Boolean(toolCall));
}

export function findToolMessageForCall(
  messages: (ExtendedMessage | LangGraphMessage)[],
  toolCallId: string,
  toolName?: string,
  allowSingleToolFallback = false
): ToolMessage | undefined {
  const toolMessages = messages.filter((msg) => {
    const message = msg as ExtendedMessage;
    return message.type === 'tool' || message.role === 'tool';
  }) as ToolMessage[];

  const exactMatch = toolMessages.find((msg) => {
    const message = msg as ExtendedMessage;
    return message.tool_call_id === toolCallId;
  });

  if (exactMatch) {
    return exactMatch;
  }

  const nameMatch = toolName
    ? toolMessages.find((msg) => {
        const message = msg as ExtendedMessage;
        return (
          message.name === toolName ||
          message.tool_name === toolName ||
          message.additional_kwargs?.name === toolName ||
          message.tool_call_id === toolName
        );
      })
    : undefined;

  if (nameMatch) {
    return nameMatch;
  }

  if (allowSingleToolFallback && toolMessages.length === 1) {
    return toolMessages[0];
  }

  return undefined;
}

export function messageContentToDisplayText(content: unknown): string {
  const envelope = parseErrorEnvelope(content);
  if (envelope) {
    return formatErrorEnvelope(envelope);
  }

  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((contentBlock) => {
      if (typeof contentBlock === 'string') {
        return contentBlock;
      }

      if (!contentBlock || typeof contentBlock !== 'object') {
        return '';
      }

      const block = contentBlock as {
        text?: string;
        type?: string;
        functionCall?: unknown;
      };

      if (block.functionCall || block.type === 'tool_use') {
        return '';
      }

      return block.text ?? '';
    })
    .filter((text) => text.trim().length > 0)
    .join('\n\n');
}
