import type { AgentStep } from '@/lib/task-types';

import { StepItem } from './StepItem';

interface StepListProps {
  steps: AgentStep[];
}

export function StepList({ steps }: StepListProps) {
  return (
    <ol className="grid gap-2">
      {steps.map((step) => (
        <StepItem key={step.stepId} step={step} />
      ))}
    </ol>
  );
}
