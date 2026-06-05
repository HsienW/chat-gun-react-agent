export enum ModelId {
  GEMINI_2_0_FLASH = 'gemini-2.5-flash',
  GEMINI_2_5_FLASH_PREVIEW = 'gemini-2.5-flash-preview-04-17',
  GEMINI_2_5_PRO_PREVIEW = 'gemini-2.5-pro-preview-05-06',
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
    id: ModelId.GEMINI_2_0_FLASH,
    name: '2.0 Flash',
    description: '多數任務下快速且有效率',
    icon: 'zap',
    iconColor: 'text-[#E7D9C1]',
  },
  {
    id: ModelId.GEMINI_2_5_FLASH_PREVIEW,
    name: '2.5 Flash',
    description: '強化 performance 並提供更快 response',
    icon: 'zap',
    iconColor: 'text-[#C2A678]',
  },
  {
    id: ModelId.GEMINI_2_5_PRO_PREVIEW,
    name: '2.5 Pro',
    description: '適合複雜任務的最高能力 model',
    icon: 'cpu',
    iconColor: 'text-[#7A1E1E]',
  },
];

export const DEFAULT_MODEL = ModelId.GEMINI_2_0_FLASH;
