import { describe, expect, it } from 'vitest';

import { getModelById, getModelByIdSafe, isValidModelId } from '@/lib/models';
import { AVAILABLE_MODELS, DEFAULT_MODEL, ModelId } from '@/types/models';

describe('model definitions', () => {
  it('uses Qwen Plus as the default model', () => {
    expect(DEFAULT_MODEL).toBe(ModelId.QWEN_PLUS);
    expect(getModelById(DEFAULT_MODEL)?.name).toBe('Qwen Plus');
  });

  it('only exposes Qwen model ids', () => {
    expect(AVAILABLE_MODELS.map((model) => model.id)).toEqual([
      ModelId.QWEN_PLUS,
      ModelId.QWEN_MAX,
      ModelId.QWEN_TURBO,
    ]);

    for (const model of AVAILABLE_MODELS) {
      expect(model.id).toMatch(/^qwen-/);
      expect(model.name).toContain('Qwen');
    }
  });

  it('rejects legacy Gemini model ids', () => {
    expect(isValidModelId('gemini-2.5-flash')).toBe(false);
    expect(getModelById('gemini-2.5-flash')).toBeUndefined();
  });

  it('throws for unknown model ids in the safe lookup', () => {
    expect(() => getModelByIdSafe('unknown-model')).toThrow(
      "找不到 id 為 'unknown-model' 的 Model"
    );
  });
});
