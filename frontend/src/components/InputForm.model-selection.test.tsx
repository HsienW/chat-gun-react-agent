import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InputForm } from '@/components/InputForm';
import { AgentId } from '@/types/agents';
import { DEFAULT_MODEL } from '@/types/models';

describe('InputForm model selection', () => {
  it('submits the Qwen default model for a new Deep Research prompt', () => {
    const onSubmit = vi.fn();

    render(
      <InputForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        isLoading={false}
        hasHistory={false}
        selectedAgent={AgentId.DEEP_RESEARCHER}
        onAgentChange={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText('輸入你的問題...');
    fireEvent.change(input, { target: { value: '幫我查台北今天的天氣' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSubmit).toHaveBeenCalledWith(
      '幫我查台北今天的天氣',
      'medium',
      DEFAULT_MODEL,
      AgentId.DEEP_RESEARCHER,
      []
    );
    expect(DEFAULT_MODEL).toMatch(/^qwen-/);
  });
});
