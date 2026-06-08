.PHONY: help dev-frontend dev-backend dev-bff dev

help:
	@echo "Available commands:"
	@echo "  make dev-frontend    - start frontend development server"
	@echo "  make dev-backend     - start LangGraph agent server"
	@echo "  make dev-bff         - start BFF/API gateway"
	@echo "  make dev             - start frontend, backend, and BFF"

dev-frontend:
	@echo "Starting frontend development server..."
	@cd frontend && npm run dev

dev-backend:
	@echo "Starting LangGraph agent server..."
	@cd backend && npm run dev

dev-bff:
	@echo "Starting BFF/API gateway..."
	@cd bff && npm run dev

dev:
	@echo "Starting frontend, backend, and BFF..."
	@make dev-frontend & make dev-backend & make dev-bff
