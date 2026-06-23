import { getEnv } from "./env.js";
import { ImAgentContextPack } from "./im-context-pack.js";

const SUPPORTED_LOCALES = ["zh-TW", "zh-CN", "en"] as const;

export type AgentLocale = (typeof SUPPORTED_LOCALES)[number];

export type AgentRuntimeConfig = {
  locale: AgentLocale;
  timeZone: string;
  contextTokensPerSource: number;
  fallbackRequiredSourceCount: number;
};

function readPositiveInt(name: string, fallback: number): number {
  const rawValue = getEnv(name);
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function readLocale(): AgentLocale {
  const rawLocale = getEnv("AGENT_LOCALE", "zh-TW");
  return SUPPORTED_LOCALES.includes(rawLocale as AgentLocale)
    ? (rawLocale as AgentLocale)
    : "zh-TW";
}

export function getAgentRuntimeConfig(): AgentRuntimeConfig {
  return {
    locale: readLocale(),
    timeZone: getEnv("AGENT_TIME_ZONE", "Asia/Taipei"),
    contextTokensPerSource: readPositiveInt("AGENT_CONTEXT_TOKENS_PER_SOURCE", 2_000),
    fallbackRequiredSourceCount: readPositiveInt("AGENT_FALLBACK_REQUIRED_SOURCE_COUNT", 3),
  };
}

export function getContextPackLocale(): ImAgentContextPack["constraints"]["locale"] {
  return getAgentRuntimeConfig().locale;
}
