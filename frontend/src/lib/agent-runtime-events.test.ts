import { describe, expect, it, vi } from 'vitest';

import {
  extractAgentRuntimeEvents,
  extractDirectAgentRuntimeEvents,
  extractNestedAgentRuntimeEvents,
  extractNodeAdapterRuntimeEvents,
  runtimeEventToProcessedEvent,
} from '@/lib/agent-runtime-events';

describe('agent runtime event extraction', () => {
  it('extracts direct runtime events from raw stream updates', () => {
    const events = extractDirectAgentRuntimeEvents({
      runtimeEvents: [{ type: 'agent.plan.start', title: 'Plan', ts: 100 }],
    });

    expect(events).toEqual([{ type: 'agent.plan.start', title: 'Plan', ts: 100 }]);
  });

  it('extracts nested runtime events from node values', () => {
    const events = extractNestedAgentRuntimeEvents({
      plan_research: {
        runtimeEvents: [{ type: 'agent.answer.stream', delta: 'partial', ts: 200 }],
      },
    });

    expect(events).toEqual([
      { type: 'agent.answer.stream', delta: 'partial', ts: 200 },
    ]);
  });

  it('adapts known node payloads when direct runtime events are absent', () => {
    vi.spyOn(Date, 'now').mockReturnValue(300);

    const events = extractNodeAdapterRuntimeEvents({
      plan_research: { plan: { answerMode: 'fast' } },
    });

    expect(events).toEqual([
      {
        type: 'agent.plan.start',
        title: '研究規劃: fast',
        ts: 300,
      },
    ]);
  });

  it('skips node adapter fallback when a known node already contains runtime events', () => {
    vi.spyOn(Date, 'now').mockReturnValue(400);

    const events = extractAgentRuntimeEvents({
      plan_research: {
        plan: { answerMode: 'fast' },
        runtimeEvents: [{ type: 'agent.plan.start', title: 'Existing plan', ts: 401 }],
      },
    });

    expect(events).toEqual([
      { type: 'agent.plan.start', title: 'Existing plan', ts: 401 },
    ]);
  });

  it('skips malformed values while continuing valid events in the same update', () => {
    const events = extractAgentRuntimeEvents({
      runtimeEvents: [
        null,
        { type: 'not.agent.event', ts: 1 },
        { type: 'agent.tool.success', output: 'missing required fields', ts: 2 },
        {
          type: 'agent.tool.success',
          toolName: 'search',
          output: 'ok',
          costMs: 12,
          ts: 3,
        },
      ],
    });

    expect(events).toEqual([
      {
        type: 'agent.tool.success',
        toolName: 'search',
        output: 'ok',
        costMs: 12,
        ts: 3,
      },
    ]);
  });

  it('normalizes unknown agent events to generic processed activity items', () => {
    vi.spyOn(Date, 'now').mockReturnValue(500);

    const [event] = extractAgentRuntimeEvents({
      runtimeEvents: [
        {
          type: 'agent.future.event',
          payload: { status: 'future' },
          unsafe: () => 'ignored',
        },
      ],
    });

    expect(event).toEqual({
      type: 'agent.unknown',
      originalType: 'agent.future.event',
      rawPayload: { payload: { status: 'future' } },
      ts: 500,
    });

    expect(runtimeEventToProcessedEvent(event)).toEqual({
      title: '未知流程事件：agent.future.event',
      data: {
        originalType: 'agent.future.event',
        payload: { status: 'future' },
      },
      eventType: 'agent.unknown',
    });
  });
});
