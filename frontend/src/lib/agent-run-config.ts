import { AgentId } from '@/types/agents';

export type ResearchEffort = 'low' | 'medium' | 'high';

type DeepResearchRunConfig = {
  max_research_loops: number;
  initial_search_query_count: number;
};

const DEEP_RESEARCH_EFFORT_CONFIG: Record<ResearchEffort, DeepResearchRunConfig> = {
  low: {
    max_research_loops: 2,
    initial_search_query_count: 1,
  },
  medium: {
    max_research_loops: 6,
    initial_search_query_count: 3,
  },
  high: {
    max_research_loops: 12,
    initial_search_query_count: 5,
  },
};

export function getAgentRunConfig(agentId: string, effort: string) {
  if (agentId !== AgentId.DEEP_RESEARCHER) return {};

  const normalizedEffort = isResearchEffort(effort) ? effort : 'medium';
  return DEEP_RESEARCH_EFFORT_CONFIG[normalizedEffort];
}

function isResearchEffort(value: string): value is ResearchEffort {
  return value in DEEP_RESEARCH_EFFORT_CONFIG;
}
