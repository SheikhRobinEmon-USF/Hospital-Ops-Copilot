FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY pyproject.toml README.md LICENSE ./
COPY src ./src
RUN pip install .

COPY docs ./docs
COPY data/processed ./data/processed
COPY .streamlit ./.streamlit
COPY evals ./evals

ENV HOC_DATA_DIR=/app/data HOC_DOCS_DIR=/app/docs
EXPOSE 8501 8000
CMD ["streamlit", "run", "src/hospital_ops_copilot/ui/app.py", "--server.port=8501", "--server.address=0.0.0.0"]
