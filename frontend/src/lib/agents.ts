import { AVAILABLE_AGENTS, Agent, AgentId, DEFAULT_AGENT } from '@/types/agents';

// Agent 操作工具。非 Deep Research 的程式碼保留，前端選項暫時由可見清單控制。
export const getAgentById = (id: string): Agent | undefined => {
  return AVAILABLE_AGENTS.find((agent) => agent.id === id);
};

export const isValidAgentId = (id: string): id is AgentId => {
  return Object.values(AgentId).includes(id as AgentId);
};

export const getAgentByIdSafe = (id: string): Agent => {
  const agent = getAgentById(id);
  if (!agent) {
    throw new Error(`找不到 id 為 '${id}' 的 Agent`);
  }
  return agent;
};

export const getVisibleAgents = (): Agent[] => {
  const configuredIds = String(import.meta.env.VITE_VISIBLE_AGENT_IDS ?? '')
    .split(',')
    .map((id: string) => id.trim())
    .filter(Boolean);
  const visibleIds = configuredIds.length
    ? new Set(configuredIds)
    : new Set([DEFAULT_AGENT]);

  return AVAILABLE_AGENTS.filter((agent) => visibleIds.has(agent.id));
};
