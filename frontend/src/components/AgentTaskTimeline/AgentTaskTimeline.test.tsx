import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AgentTask } from '@/lib/task-types';

import { AgentTaskTimeline } from './AgentTaskTimeline';

const createdAt = '2026-07-27T00:00:00.000Z';
const updatedAt = '2026-07-27T00:00:09.000Z';

function createTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    taskId: 'task-1',
    taskType: 'recommendation',
    status: 'running',
    steps: [
      {
        stepId: 'step-1',
        stepName: 'extract_intent',
        status: 'succeeded',
        attempt: 1,
        maxAttempts: 2,
        createdAt,
        updatedAt,
      },
      {
        stepId: 'step-2',
        stepName: 'vector_search',
        status: 'running',
        attempt: 2,
        maxAttempts: 3,
        createdAt,
        updatedAt,
      },
    ],
    metadata: {},
    createdAt,
    updatedAt,
    ...overrides,
  };
}

describe('AgentTaskTimeline', () => {
  it('renders an empty state without errors', () => {
    render(<AgentTaskTimeline />);

    expect(screen.getByText('No active task')).toBeInTheDocument();
  });

  it('renders task header and ordered step statuses', () => {
    render(<AgentTaskTimeline task={createTask()} />);

    expect(screen.getByText('Agent Task: recommendation')).toBeInTheDocument();
    expect(screen.getByText('9s')).toBeInTheDocument();
    expect(screen.getByText('extract_intent')).toBeInTheDocument();
    expect(screen.getByText('vector_search')).toBeInTheDocument();
    expect(screen.getByText('Attempt 2/3')).toBeInTheDocument();
    expect(screen.getAllByText('Running')).toHaveLength(2);
  });

  it('renders step error code and message', () => {
    render(
      <AgentTaskTimeline
        task={createTask({
          status: 'failed',
          steps: [
            {
              stepId: 'step-failed',
              stepName: 'business_policy_gate',
              status: 'terminal_failed',
              attempt: 3,
              maxAttempts: 3,
              error: { code: 'permission_denied', message: 'Denied' },
              createdAt,
              updatedAt,
            },
          ],
        })}
      />
    );

    expect(screen.getByText('permission_denied: Denied')).toBeInTheDocument();
    expect(screen.getByText('Attempt 3/3')).toBeInTheDocument();
  });

  it('renders loading state when a task has no completed steps yet', () => {
    render(
      <AgentTaskTimeline
        task={createTask({
          steps: [],
        })}
      />
    );

    expect(screen.getByText('Loading steps')).toBeInTheDocument();
  });

  it('renders timeline error without hiding task content', () => {
    render(<AgentTaskTimeline task={createTask()} error="Stream unavailable" />);

    expect(screen.getByText('Stream unavailable')).toBeInTheDocument();
    expect(screen.getByText('extract_intent')).toBeInTheDocument();
  });

  it('renders structured interaction status without exposing raw input', () => {
    render(
      <AgentTaskTimeline
        task={createTask({
          status: 'rollback_requested',
          metadata: {
            interactionState: 'compensation_waiting',
            inputDigest: 'sha256-only',
          },
        })}
      />
    );

    expect(screen.getByText('Rollback requested')).toBeInTheDocument();
    expect(screen.getByText('Compensation waiting')).toBeInTheDocument();
    expect(screen.queryByText('sha256-only')).not.toBeInTheDocument();
  });
});
