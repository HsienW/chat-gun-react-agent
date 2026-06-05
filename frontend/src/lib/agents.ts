import { AVAILABLE_AGENTS, Agent, AgentId } from '@/types/agents';

// Agent operations 的 utility functions
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
