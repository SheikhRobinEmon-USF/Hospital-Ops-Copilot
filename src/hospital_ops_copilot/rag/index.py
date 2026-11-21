"""Hybrid retrieval: BM25 keyword search plus Ollama embeddings, fused with reciprocal rank fusion.

BM25 always works (no model needed). When Ollama is reachable, dense vectors are added and cached
on disk per embedding model and corpus hash. Query and document prefixes follow each model card,
because Ollama's /api/embed does not add them.
"""

from __future__ import annotations

import json
import logging
import math
import re
from collections import Counter
from dataclasses import dataclass

import numpy as np

from ..config import Settings, get_settings
from ..llm.ollama_client import OllamaClient, OllamaError
from .corpus import Chunk, build_corpus, corpus_hash

log = logging.getLogger(__name__)

# (query prefix, document prefix) per embedding model family, from each model card.
PREFIXES: dict[str, tuple[str, str]] = {
    "nomic-embed-text": ("search_query: ", "search_document: "),
    "embeddinggemma": ("task: search result | query: ", "title: none | text: "),
    "qwen3-embedding": ("Instruct: Given a question about hospital finance metrics, retrieve passages that answer it\nQuery: ", ""),
    "mxbai-embed-large": ("Represent this sentence for searching relevant passages: ", ""),
}

_WORD = re.compile(r"[a-z0-9]+")
_STOP = set(["a", "an", "the", "of", "and", "or", "to", "in", "on", "for", "is", "are", "was", "what", "how", "does", "do", "which", "with", "by", "from", "as", "at", "it", "this", "that", "be"])


def tokenize(text: str) -> list[str]:
    return [t for t in _WORD.findall(text.lower()) if t not in _STOP]


class BM25:
    def __init__(self, docs: list[str], k1: float = 1.5, b: float = 0.75):
        self.k1, self.b = k1, b
        self.toks = [tokenize(d) for d in docs]
        self.lens = np.array([len(t) for t in self.toks], dtype=float)
        self.avg = float(self.lens.mean()) if len(docs) else 0.0
        self.tf = [Counter(t) for t in self.toks]
        df = Counter(w for t in self.toks for w in set(t))
        n = len(docs)
        self.idf = {w: math.log(1 + (n - c + 0.5) / (c + 0.5)) for w, c in df.items()}

    def scores(self, query: str) -> np.ndarray:
        q = tokenize(query)
        out = np.zeros(len(self.toks))
        for i, tf in enumerate(self.tf):
            s = 0.0
            norm = self.k1 * (1 - self.b + self.b * self.lens[i] / (self.avg or 1))
            for w in q:
                f = tf.get(w)
                if f:
                    s += self.idf[w] * f * (self.k1 + 1) / (f + norm)
            out[i] = s
        return out


@dataclass
class Hit:
    chunk: Chunk
    score: float
    rank: int

    def to_dict(self) -> dict:
        return {"id": self.chunk.id, "title": self.chunk.title, "source": self.chunk.source,
                "url": self.chunk.url, "text": self.chunk.text, "score": round(self.score, 4)}


def _prefixes(model: str) -> tuple[str, str]:
    return PREFIXES.get(model.split(":")[0], ("", ""))


class Retriever:
    def __init__(self, chunks: list[Chunk] | None = None, settings: Settings | None = None,
                 embed_model: str | None = None, client: OllamaClient | None = None, mode: str = "hybrid"):
        self.settings = settings or get_settings()
        self.chunks = chunks if chunks is not None else build_corpus(self.settings)
        self.embed_model = embed_model or self.settings.embed_model
        self.client = client
        self.mode = mode  # hybrid | bm25 | dense
        self.bm25 = BM25([f"{c.title}\n{c.text}" for c in self.chunks])
        self._vectors: np.ndarray | None = None
        self._dense_failed = False

    def _ollama(self) -> OllamaClient:
        """One client for the retriever's lifetime (creating one per query leaked connection pools)."""
        if self.client is None:
            self.client = OllamaClient(self.settings)
        return self.client

    def _doc_texts(self) -> list[str]:
        _, dp = _prefixes(self.embed_model)
        return [f"{dp}{c.title}\n{c.text}" for c in self.chunks]

    def _load_vectors(self) -> np.ndarray | None:
        if self._vectors is not None or self._dense_failed or self.mode == "bm25":
            return self._vectors
        h = corpus_hash(self.chunks)
        safe = re.sub(r"[^a-zA-Z0-9]+", "_", self.embed_model)
        path = self.settings.index_dir / f"{safe}_{h}.npy"
        if path.exists():
            self._vectors = np.load(path)
            return self._vectors
        client = self._ollama()
        try:
            vecs = np.array(client.embed(self._doc_texts(), model=self.embed_model), dtype=np.float32)
        except OllamaError as e:
            log.warning("dense retrieval unavailable, using BM25 only: %s", e)
            self._dense_failed = True
            return None
        vecs /= np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-9
        path.parent.mkdir(parents=True, exist_ok=True)
        np.save(path, vecs)
        (path.with_suffix(".json")).write_text(json.dumps({"model": self.embed_model, "corpus_hash": h,
                                                           "chunks": len(self.chunks)}))
        self._vectors = vecs
        return vecs

    def dense_scores(self, query: str) -> np.ndarray | None:
        vecs = self._load_vectors()
        if vecs is None:
            return None
        qp, _ = _prefixes(self.embed_model)
        client = self._ollama()
        try:
            q = np.array(client.embed([qp + query], model=self.embed_model)[0], dtype=np.float32)
        except OllamaError as e:
            log.warning("query embedding failed: %s", e)
            return None
        q /= np.linalg.norm(q) + 1e-9
        return vecs @ q

    def search(self, query: str, k: int = 4, rrf_k: int = 60) -> list[Hit]:
        bm = self.bm25.scores(query)
        dense = None if self.mode == "bm25" else self.dense_scores(query)
        if self.mode == "dense" and dense is not None:
            fused = dense
        elif dense is None:
            fused = bm
        else:
            fused = np.zeros(len(self.chunks))
            for scores in (bm, dense):
                order = np.argsort(-scores, kind="stable")
                for r, idx in enumerate(order):
                    fused[idx] += 1.0 / (rrf_k + r + 1)
        order = np.argsort(-fused, kind="stable")[:k]
        return [Hit(self.chunks[i], float(fused[i]), r + 1) for r, i in enumerate(order) if fused[i] > 0]

    @property
    def active_mode(self) -> str:
        if self.mode == "bm25" or self._dense_failed:
            return "bm25"
        return self.mode


_retriever: Retriever | None = None


def get_retriever() -> Retriever:
    global _retriever
    if _retriever is None:
        settings = get_settings()
        # Offline deployments have no embedding model; use keyword search without probing for one.
        _retriever = Retriever(mode="bm25" if settings.llm_backend == "offline" else "hybrid")
    return _retriever
