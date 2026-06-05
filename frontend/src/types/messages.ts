import type { Message as LangGraphMessage } from '@langchain/langgraph-sdk';
import { ToolCall, ToolMessage } from './tools';

export interface ExtendedMessage {
  id?: string;
  type: string;
  content: unknown;
  tool_calls?: ToolCall[];
  tool_call_chunks?: unknown[];
  tool_call_id?: string;
}

export function extractToolCallsFromMessage(
  message: ExtendedMessage | LangGraphMessage
): ToolCall[] {
  return (message as ExtendedMessage).tool_calls || [];
}

export function findToolMessageForCall(
  messages: (ExtendedMessage | LangGraphMessage)[],
  toolCallId: string
): ToolMessage | undefined {
  return messages.find(
    (msg) =>
      (msg as ExtendedMessage).type === 'tool' &&
      (msg as ExtendedMessage).tool_call_id === toolCallId
  ) as ToolMessage | undefined;
}
