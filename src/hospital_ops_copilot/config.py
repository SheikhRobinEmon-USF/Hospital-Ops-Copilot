"""Runtime configuration, read from environment variables (prefix ``HOC_``)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _env(name: str, default: str) -> str:
    return os.environ.get(f"HOC_{name}", default)


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR", str(PROJECT_ROOT / "data"))))
    docs_dir: Path = field(default_factory=lambda: Path(_env("DOCS_DIR", str(PROJECT_ROOT / "docs"))))
    ollama_host: str = field(default_factory=lambda: _env("OLLAMA_HOST", os.environ.get("OLLAMA_HOST", "http://localhost:11434")))
    chat_model: str = field(default_factory=lambda: _env("CHAT_MODEL", "qwen3.5:4b"))
    embed_model: str = field(default_factory=lambda: _env("EMBED_MODEL", "embeddinggemma"))
    # Set HOC_LLM_BACKEND=offline to force the deterministic, LLM-free narrator.
    llm_backend: str = field(default_factory=lambda: _env("LLM_BACKEND", "ollama"))
    request_timeout: float = field(default_factory=lambda: float(_env("REQUEST_TIMEOUT", "300")))
    years: tuple[int, ...] = field(
        default_factory=lambda: tuple(int(y) for y in _env("YEARS", "2021,2022,2023,2024").split(","))
    )

    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"

    @property
    def processed_dir(self) -> Path:
        return self.data_dir / "processed"

    @property
    def index_dir(self) -> Path:
        return self.data_dir / "index"

    @property
    def kpi_path(self) -> Path:
        return self.processed_dir / "hospital_kpis.parquet"

    @property
    def duckdb_path(self) -> Path:
        return self.processed_dir / "hospital_ops.duckdb"


def get_settings() -> Settings:
    return Settings()
