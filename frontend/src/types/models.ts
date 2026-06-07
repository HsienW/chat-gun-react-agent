export enum ModelId {
  GEMINI_2_5_FLASH = 'gemini-2.5-flash',
  GEMINI_2_5_PRO = 'gemini-2.5-pro',
  GEMINI_2_0_FLASH = 'gemini-2.0-flash',
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
    id: ModelId.GEMINI_2_5_FLASH,
    name: '2.5 Flash',
    description: '預設模型，速度快，適合一般工具調用與研究任務',
    icon: 'zap',
    iconColor: 'text-[#E7D9C1]',
  },
  {
    id: ModelId.GEMINI_2_5_PRO,
    name: '2.5 Pro',
    description: '較強推理模型，適合複雜分析與長上下文任務',
    icon: 'cpu',
    iconColor: 'text-[#C2A678]',
  },
  {
    id: ModelId.GEMINI_2_0_FLASH,
    name: '2.0 Flash',
    description: '穩定快速模型，可作為備援選項',
    icon: 'zap',
    iconColor: 'text-[#7A1E1E]',
  },
];

export const DEFAULT_MODEL = ModelId.GEMINI_2_5_FLASH;
