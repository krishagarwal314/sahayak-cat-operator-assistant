.PHONY: help setup setup-backend setup-frontend models dataset train dev backend frontend build eval clean

help:
	@echo "setup      install backend and frontend dependencies"
	@echo "models     download the speech, translation and embedding models"
	@echo "dataset    build the intent training dataset from the taxonomy"
	@echo "train      fine-tune the intent classifier"
	@echo "dev        run backend and frontend together"
	@echo "eval       measure intent routing accuracy"
	@echo "build      production build of the frontend"

setup: setup-backend setup-frontend

setup-backend:
	cd backend && python3 -m venv .venv && .venv/bin/pip install -U pip && .venv/bin/pip install -r requirements.txt

setup-frontend:
	cd frontend && npm install

models:
	cd backend && .venv/bin/python scripts/download_models.py

dataset:
	cd backend && .venv/bin/python -m app.ai.intent.build_dataset

train: dataset
	cd backend && .venv/bin/python -m app.ai.intent.train

backend:
	cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

dev:
	./run.sh

eval:
	cd backend && .venv/bin/python -m app.ai.intent.evaluate

build:
	cd frontend && npm run build

clean:
	rm -rf backend/__pycache__ backend/app/**/__pycache__ frontend/dist
