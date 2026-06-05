.PHONY: help dev-frontend dev-backend dev

help:
	@echo "Available commands:"
	@echo "  make dev-frontend    - 啟動 frontend development server (Vite)"
	@echo "  make dev-backend     - 啟動 TypeScript LangGraph Agent Server"
	@echo "  make dev             - 同時啟動 frontend 與 backend"

dev-frontend:
	@echo "啟動 frontend development server..."
	@cd frontend && npm run dev

dev-backend:
	@echo "啟動 TypeScript LangGraph Agent Server..."
	@cd backend && npm run dev

# 同時執行 frontend 與 backend
dev:
	@echo "同時啟動 frontend 與 backend..."
	@make dev-frontend & make dev-backend 
