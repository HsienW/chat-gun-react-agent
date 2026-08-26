import { Badge } from '@/components/ui/badge';
import type { AgentTask, TaskStatus } from '@/lib/task-types';

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  created: 'Created',
  running: 'Running',
  waiting_confirmation: 'Waiting',
  completed: 'Completed',
  partially_failed: 'Partial',
  compensating: 'Compensating',
  failed: 'Failed',
  cancelled: 'Cancelled',
  cancelling: 'Cancelling',
  superseded: 'Superseded',
  rollback_requested: 'Rollback requested',
  cancelled_after_commit: 'Cancelled after commit',
  manual_intervention_required: 'Manual intervention required',
};

const TASK_STATUS_BADGE_VARIANTS: Record<TaskStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  created: 'outline',
  running: 'secondary',
  waiting_confirmation: 'outline',
  completed: 'default',
  partially_failed: 'outline',
  compensating: 'secondary',
  failed: 'destructive',
  cancelled: 'destructive',
  cancelling: 'secondary',
  superseded: 'outline',
  rollback_requested: 'secondary',
  cancelled_after_commit: 'destructive',
  manual_intervention_required: 'destructive',
};

const INTERACTION_STATE_LABELS: Record<string, string> = {
  queued: 'Queued',
  cancelling: 'Cancelling',
  superseded: 'Superseded',
  compensation_waiting: 'Compensation waiting',
  clarification_requested: 'Clarification requested',
  clarification_resumed: 'Clarification resumed',
  corrective_manual: 'Corrective action required',
};

function formatDuration(task: AgentTask): string {
  const start = Date.parse(task.createdAt);
  const end = Date.parse(task.updatedAt);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return '0s';
  }

  return `${Math.round((end - start) / 1000)}s`;
}

interface TaskHeaderProps {
  task: AgentTask;
}

export function TaskHeader({ task }: TaskHeaderProps) {
  const interactionState = task.metadata.interactionState;
  const interactionLabel =
    typeof interactionState === 'string'
      ? INTERACTION_STATE_LABELS[interactionState]
      : undefined;

  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[#F8F1E7]">
          Agent Task: {task.taskType}
        </p>
        <p className="mt-1 text-xs text-[#E7D9C1]/70">{formatDuration(task)}</p>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        {interactionLabel ? <Badge variant="outline">{interactionLabel}</Badge> : null}
        <Badge variant={TASK_STATUS_BADGE_VARIANTS[task.status]}>
          {TASK_STATUS_LABELS[task.status]}
        </Badge>
      </div>
    </div>
  );
}
