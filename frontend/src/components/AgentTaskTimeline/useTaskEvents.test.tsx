import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useTaskEvents } from './useTaskEvents';

describe('useTaskEvents', () => {
  it('returns an empty stable state without a task id', () => {
    const { result } = renderHook(() => useTaskEvents());

    expect(result.current).toEqual({
      task: null,
      events: [],
      isLoading: false,
      error: null,
    });
  });

  it('streams a complete mock task lifecycle', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTaskEvents('mock-task'));

    expect(result.current.isLoading).toBe(true);

    act(() => {
      vi.runAllTimers();
    });

    expect(result.current.task).toEqual(
      expect.objectContaining({
        taskId: 'mock-task',
        status: 'completed',
      })
    );
    expect(result.current.task?.steps.map((step) => step.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    expect(result.current.events).toHaveLength(8);
    expect(result.current.isLoading).toBe(false);
    vi.useRealTimers();
  });
});
