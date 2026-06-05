# Stage 1: Build React frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json ./
COPY frontend/package-lock.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# Stage 2: TypeScript LangGraph backend
FROM docker.io/langchain/langgraphjs-api:20

USER root

# 安裝常用 MCP servers。Production 可改由獨立 Tool Service 管理。
RUN npm install -g @modelcontextprotocol/server-filesystem @modelcontextprotocol/server-brave-search

# 保留 frontend build，實際 production 建議交給 CDN/Nginx/BFF serve。
COPY --from=frontend-builder /app/frontend/dist /deps/frontend/dist

ADD backend/ /deps/backend
WORKDIR /deps/backend

RUN npm install --omit=dev

ENV LANGSERVE_GRAPHS='{"deep_researcher": "/deps/backend/src/agents/deep-researcher.ts:deepResearcherGraph", "chatbot": "/deps/backend/src/agents/chatbot.ts:chatbotGraph", "mcp_agent": "/deps/backend/src/agents/mcp-agent.ts:mcpAgentGraph", "math_agent": "/deps/backend/src/agents/math-agent.ts:mathAgentGraph"}'

# MCP 預設設定。Production 應交由 BFF/API Gateway 與 Tool Service 做權限、審計、限流、灰度與熔斷。
ENV MCP_FILESYSTEM_ENABLED=true
ENV MCP_FILESYSTEM_PATH=/app/workspace
ENV MCP_BRAVE_SEARCH_ENABLED=true

RUN mkdir -p /app/workspace && chmod 755 /app/workspace

WORKDIR /deps/backend
