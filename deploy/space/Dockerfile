# Hugging Face Space: Hospital Ops Copilot public demo API (offline analyst, no AI model).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    HOC_DATA_DIR=/app/data HOC_DOCS_DIR=/app/docs \
    HOC_LLM_BACKEND=offline \
    HOC_CORS_ORIGINS=https://sheikhrobinemon-usf.github.io,http://localhost:3000
WORKDIR /app

COPY pyproject.toml README.md LICENSE ./
COPY src ./src
RUN pip install .

COPY data ./data
COPY docs ./docs
# Warm the documentation index at build time (extracts PDF text while the filesystem is writable).
RUN python -c "from hospital_ops_copilot.rag.corpus import build_corpus; print(len(build_corpus()), 'chunks')"

# Spaces run the container as UID 1000.
RUN useradd -m -u 1000 user && chown -R user /app
USER user
EXPOSE 7860
CMD ["uvicorn", "hospital_ops_copilot.api.main:app", "--host", "0.0.0.0", "--port", "7860"]
