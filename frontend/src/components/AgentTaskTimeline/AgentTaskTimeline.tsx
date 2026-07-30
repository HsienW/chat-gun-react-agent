import { AlertCircle, Info, Loader2 } from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { AgentTask } from '@/lib/task-types';

import { StepList } from './StepList';
import { TaskHeader } from './TaskHeader';
import { useTaskEvents } from './useTaskEvents';

interface AgentTaskTimelineProps {
  task?: AgentTask | null;
  taskId?: string;
  isLoading?: boolean;
  error?: string | null;
}

export function AgentTaskTimeline({
  task,
  taskId,
  isLoading,
  error,
}: AgentTaskTimelineProps) {
  const streamedState = useTaskEvents(taskId);
  const activeTask = task ?? streamedState.task;
  const isTimelineLoading = isLoading ?? streamedState.isLoading;
  const timelineError = error ?? streamedState.error;

  return (
    <Card className="w-full min-w-0 rounded-lg border border-border bg-card">
      <CardHeader className="px-4">
        {activeTask ? (
          <TaskHeader task={activeTask} />
        ) : (
          <div className="flex items-center gap-2 text-sm font-semibold text-[#F8F1E7]">
            <Info className="h-4 w-4 shrink-0" />
            No active task
          </div>
        )}
      </CardHeader>
      <CardContent className="px-4">
        {timelineError ? (
          <div className="flex min-w-0 items-center gap-2 rounded-md border border-destructive/50 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="break-words">{timelineError}</span>
          </div>
        ) : null}
        {activeTask && activeTask.steps.length > 0 ? (
          <ScrollArea className="max-h-80">
            <StepList steps={activeTask.steps} />
          </ScrollArea>
        ) : null}
        {activeTask && activeTask.steps.length === 0 ? (
          <div className="flex min-w-0 items-center gap-2 text-sm text-[#E7D9C1]/70">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            Loading steps
          </div>
        ) : null}
        {!activeTask && isTimelineLoading ? (
          <div className="flex min-w-0 items-center gap-2 text-sm text-[#E7D9C1]/70">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            Loading task
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
