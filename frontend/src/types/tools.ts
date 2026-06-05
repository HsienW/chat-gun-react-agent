export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  type: 'tool_call';
}

export interface ToolMessage {
  id: string;
  type: 'tool';
  tool_call_id: string;
  name: string;
  content: string;
  is_error?: boolean;
}
