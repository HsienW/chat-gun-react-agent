import { useEffect, useMemo, useReducer, useState } from 'react';

import { taskEventReducer } from '@/lib/task-event-reducer';
import type { AgentStep, AgentTask, TaskEvent } from '@/lib/task-types';

export interface TaskEventsState {
  task: AgentTask | null;
  events: TaskEvent[];
  isLoading: boolean;
  error: string | null;
}

const baseTime = '2026-07-27T00:00:00.000Z';

function createMockStep(overrides: Partial<AgentStep> = {}): AgentStep {
  return {
    stepId: 'mock-step-extract',
    stepName: 'extract_intent',
    status: 'pending',
    attempt: 1,
    maxAttempts: 2,
    createdAt: baseTime,
    updatedAt: baseTime,
    ...overrides,
  };
}

function createMockTask(taskId: string): AgentTask {
  return {
    taskId,
    taskType: 'recommendation',
    status: 'created',
    steps: [
      createMockStep(),
      createMockStep({
        stepId: 'mock-step-search',
        stepName: 'vector_search',
      }),
      createMockStep({
        stepId: 'mock-step-rerank',
        stepName: 'rerank',
      }),
    ],
    metadata: { source: 'mock' },
    createdAt: baseTime,
    updatedAt: baseTime,
  };
}

function createMockEvents(taskId: string): TaskEvent[] {
  const task = createMockTask(taskId);
  const [extractStep, searchStep, rerankStep] = task.steps;

  return [
    {
      eventId: 'mock-event-created',
      taskId,
      eventType: 'task_created',
      payload: { task },
      createdAt: baseTime,
    },
    {
      eventId: 'mock-event-extract-started',
      taskId,
      stepId: extractStep.stepId,
      eventType: 'step_started',
      payload: { step: { ...extractStep, status: 'running' } },
      createdAt: '2026-07-27T00:00:01.000Z',
    },
    {
      eventId: 'mock-event-extract-completed',
      taskId,
      stepId: extractStep.stepId,
      eventType: 'step_completed',
      payload: { step: { ...extractStep, status: 'succeeded' } },
      createdAt: '2026-07-27T00:00:02.000Z',
    },
    {
      eventId: 'mock-event-search-started',
      taskId,
      stepId: searchStep.stepId,
      eventType: 'step_started',
      payload: { step: { ...searchStep, status: 'running' } },
      createdAt: '2026-07-27T00:00:03.000Z',
    },
    {
      eventId: 'mock-event-search-completed',
      taskId,
      stepId: searchStep.stepId,
      eventType: 'step_completed',
      payload: { step: { ...searchStep, status: 'succeeded' } },
      createdAt: '2026-07-27T00:00:04.000Z',
    },
    {
      eventId: 'mock-event-rerank-started',
      taskId,
      stepId: rerankStep.stepId,
      eventType: 'step_started',
      payload: { step: { ...rerankStep, status: 'running' } },
      createdAt: '2026-07-27T00:00:05.000Z',
    },
    {
      eventId: 'mock-event-rerank-completed',
      taskId,
      stepId: rerankStep.stepId,
      eventType: 'step_completed',
      payload: { step: { ...rerankStep, status: 'succeeded' } },
      createdAt: '2026-07-27T00:00:06.000Z',
    },
    {
      eventId: 'mock-event-task-completed',
      taskId,
      eventType: 'task_completed',
      payload: { task: { ...task, status: 'completed' } },
      createdAt: '2026-07-27T00:00:07.000Z',
    },
  ];
}

export function useTaskEvents(taskId?: string): TaskEventsState {
  const mockEvents = useMemo(() => (taskId ? createMockEvents(taskId) : []), [taskId]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(taskId));
  const [error] = useState<string | null>(null);
  const [task, dispatchTaskEvent] = useReducer(taskEventReducer, null);

  useEffect(() => {
    if (!taskId) {
      setEvents([]);
      setIsLoading(false);
      return undefined;
    }

    setEvents([]);
    setIsLoading(true);

    const timers = mockEvents.map((event, index) =>
      window.setTimeout(() => {
        setEvents((currentEvents) => [...currentEvents, event]);
        dispatchTaskEvent(event);
        if (index === mockEvents.length - 1) {
          setIsLoading(false);
        }
      }, index * 25)
    );

    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [mockEvents, taskId]);

  return {
    task,
    events,
    isLoading,
    error,
  };
}
