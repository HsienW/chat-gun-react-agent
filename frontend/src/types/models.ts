export enum ModelId {
  QWEN_PLUS = 'qwen-plus',
  QWEN_MAX = 'qwen-max',
  QWEN_TURBO = 'qwen-turbo',
}

export interface Model {
  id: ModelId;
  name: string;
  description: string;
  icon: string;
  iconColor: string;
}

export const AVAILABLE_MODELS: Model[] = [
  {
    id: ModelId.QWEN_PLUS,
    name: 'Qwen Plus',
    description: '預設 Qwen 模型，適合一般工具調用與研究任務',
    icon: 'zap',
    iconColor: 'text-[#E7D9C1]',
  },
  {
    id: ModelId.QWEN_MAX,
    name: 'Qwen Max',
    description: '較強 Qwen 推理模型，適合複雜分析與長上下文任務',
    icon: 'cpu',
    iconColor: 'text-[#C2A678]',
  },
  {
    id: ModelId.QWEN_TURBO,
    name: 'Qwen Turbo',
    description: '穩定快速 Qwen 模型，可作為低延遲選項',
    icon: 'zap',
    iconColor: 'text-[#7A1E1E]',
  },
];

export const DEFAULT_MODEL = ModelId.QWEN_PLUS;
