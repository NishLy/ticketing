.PHONY: dev dev-api dev-ui migrate seed-stelinacs prod dev-down prod-down dev-key prod-key test

dev:
	python -m pip install -r backend/requirements.txt
	cd backend && python -m alembic upgrade head
	cd frontend && npm install
	@echo Setup complete. Open two terminals and run make dev-api and make dev-ui.

dev-api: migrate
	cd backend && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --env-file ../.env

dev-ui:
	cd frontend && npm run dev -- --host 127.0.0.1

prod:
	docker compose -p ticketing-prod -f docker-compose.yml up --build -d

dev-down:
	@echo Stop the local development API and UI with Ctrl+C in their terminals.

migrate:
	cd backend && python -m alembic upgrade head

seed-stelinacs: migrate
	cd backend && python -m app.seed_stelinacs

prod-down:
	docker compose -p ticketing-prod -f docker-compose.yml down

dev-key: migrate
	cd backend && python -m app.cli generate-key

prod-key:
	docker compose -p ticketing-prod -f docker-compose.yml exec api python -m app.cli generate-key

test:
	cd backend && python -m pytest -q
	cd frontend && npm run build
