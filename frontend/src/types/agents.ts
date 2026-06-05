export enum AgentId {
  DEEP_RESEARCHER = 'deep_researcher',
  CHATBOT = 'chatbot',
  MATH_AGENT = 'math_agent',
  MCP_AGENT = 'mcp_agent',
}

export interface Agent {
  id: AgentId;
  name: string;
  description: string;
  icon: string;
  capabilities: string[];
  showActivityTimeline: boolean;
}

export const AVAILABLE_AGENTS: Agent[] = [
  {
    id: AgentId.DEEP_RESEARCHER,
    name: 'Deep Researcher',
    description: '進階 deep research 與強化分析',
    icon: 'search',
    capabilities: ['進階 Web Research', 'Deep Analysis'],
    showActivityTimeline: true,
  },
  {
    id: AgentId.CHATBOT,
    name: 'Chat Assistant',
    description: '簡單的 conversational assistant',
    icon: 'message-circle',
    capabilities: ['一般 Chat', '快速 Responses'],
    showActivityTimeline: false,
  },
  {
    id: AgentId.MATH_AGENT,
    name: 'Math Solver',
    description: '進階數學解題與 calculations',
    icon: 'calculator',
    capabilities: [
      'Mathematical Calculations',
      'Problem Solving',
      'Formula Analysis',
    ],
    showActivityTimeline: false,
  },
  {
    id: AgentId.MCP_AGENT,
    name: 'MCP Agent',
    description: '整合外部 tools 的 Model Context Protocol agent',
    icon: 'wrench',
    capabilities: ['Model Context Protocol (MCP)'],
    showActivityTimeline: false,
  },
];

export const DEFAULT_AGENT = AgentId.CHATBOT;
