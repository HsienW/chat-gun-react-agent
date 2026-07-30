import {
  CheckCircle2,
  Circle,
  CircleDashed,
  Hourglass,
  Loader2,
  RotateCcw,
  ShieldCheck,
  SkipForward,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { AgentStep, StepStatus } from '@/lib/task-types';

const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  waiting_confirmation: 'Waiting',
  succeeded: 'Succeeded',
  retryable_failed: 'Retryable',
  terminal_failed: 'Failed',
  compensating: 'Compensating',
  compensated: 'Compensated',
  skipped: 'Skipped',
};

const STEP_STATUS_BADGE_VARIANTS: Record<StepStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  running: 'secondary',
  waiting_confirmation: 'outline',
  succeeded: 'default',
  retryable_failed: 'outline',
  terminal_failed: 'destructive',
  compensating: 'secondary',
  compensated: 'default',
  skipped: 'outline',
};

const STEP_STATUS_ICONS = {
  pending: Circle,
  running: Loader2,
  waiting_confirmation: Hourglass,
  succeeded: CheckCircle2,
  retryable_failed: RotateCcw,
  terminal_failed: XCircle,
  compensating: CircleDashed,
  compensated: ShieldCheck,
  skipped: SkipForward,
} as const satisfies Record<StepStatus, typeof Circle>;

interface StepItemProps {
  step: AgentStep;
}

export function StepItem({ step }: StepItemProps) {
  const StatusIcon = STEP_STATUS_ICONS[step.status];
  const isRunning = step.status === 'running';

  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-3 rounded-md border border-[#5A4036]/70 bg-[#211915] p-3">
      <div className="flex h-6 w-6 items-center justify-center">
        <StatusIcon
          aria-hidden="true"
          className={`h-4 w-4 text-[#E7D9C1] ${isRunning ? 'animate-spin' : ''}`}
        />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-[#F8F1E7]">
          {step.stepName}
        </p>
        <p className="mt-1 text-xs text-[#E7D9C1]/70">
          Attempt {step.attempt}/{step.maxAttempts}
        </p>
        {step.error ? (
          <p className="mt-2 break-words text-xs text-[#F7B4A8]">
            {step.error.code}: {step.error.message}
          </p>
        ) : null}
      </div>
      <Badge variant={STEP_STATUS_BADGE_VARIANTS[step.status]} className="shrink-0">
        {STEP_STATUS_LABELS[step.status]}
      </Badge>
    </li>
  );
}
