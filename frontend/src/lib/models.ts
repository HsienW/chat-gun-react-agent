import { AVAILABLE_MODELS, Model, ModelId } from '@/types/models';

// Model operations 的 utility functions
export const getModelById = (id: string): Model | undefined => {
  return AVAILABLE_MODELS.find((model) => model.id === id);
};

export const isValidModelId = (id: string): id is ModelId => {
  return Object.values(ModelId).includes(id as ModelId);
};

export const getModelByIdSafe = (id: string): Model => {
  const model = getModelById(id);
  if (!model) {
    throw new Error(`找不到 id 為 '${id}' 的 Model`);
  }
  return model;
};
