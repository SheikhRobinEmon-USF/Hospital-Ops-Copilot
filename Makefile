.PHONY: install data index test lint ui api eval-retrieval eval-agent models

install:
	pip install -e ".[dev]"

data:            ## download CMS files and build the KPI table
	hoc download
	hoc build

models:          ## pull the default local models
	ollama pull qwen3.5:4b
	ollama pull embeddinggemma

index:
	hoc index

test:
	pytest

lint:
	ruff check src tests evals

ui:
	hoc ui

api:
	hoc api

eval-retrieval:
	hoc eval retrieval --embed-models nomic-embed-text embeddinggemma qwen3-embedding:0.6b

eval-agent:
	hoc eval agent --offline --models qwen3.5:4b llama3.2:3b granite4:3b qwen3.5:2b gemma4:e4b
