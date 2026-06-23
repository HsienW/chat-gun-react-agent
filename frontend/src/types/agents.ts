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
    description: '可進行深度研究、工具調用與圖片理解的 Agent',
    icon: 'search',
    capabilities: ['Web Research', 'Deep Analysis', 'Image Understanding'],
    showActivityTimeline: true,
  },
  {
    id: AgentId.CHATBOT,
    name: 'Chat Assistant',
    description: '一般對話助理',
    icon: 'message-circle',
    capabilities: ['Chat', 'General Responses'],
    showActivityTimeline: false,
  },
  {
    id: AgentId.MATH_AGENT,
    name: 'Math Solver',
    description: '數學與運算任務助理',
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
    description: '可調用 Model Context Protocol 工具的 Agent',
    icon: 'wrench',
    capabilities: ['Model Context Protocol (MCP)'],
    showActivityTimeline: false,
  },
];

export const DEFAULT_AGENT = AgentId.DEEP_RESEARCHER;
