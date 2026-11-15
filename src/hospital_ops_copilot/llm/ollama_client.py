"""Minimal Ollama REST client (chat with tools, embeddings). Uses httpx, no SDK lock-in."""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import httpx

from ..config import Settings, get_settings

# Models with a "thinking" mode. Thinking is turned off for tool routing: it multiplies latency on
# CPU and does not improve accuracy on these short, structured tasks (see docs/model_selection.md).
THINKING_FAMILIES = ("qwen3", "qwen3.5", "qwen3.6", "deepseek-r1", "gpt-oss", "magistral")


class OllamaError(RuntimeError):
    pass


@dataclass
class ChatResult:
    content: str
    tool_calls: list[dict] = field(default_factory=list)
    latency_s: float = 0.0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    raw: dict = field(default_factory=dict)


class OllamaClient:
    def __init__(self, settings: Settings | None = None, host: str | None = None):
        self.settings = settings or get_settings()
        self.host = (host or self.settings.ollama_host).rstrip("/")
        self._http = httpx.Client(base_url=self.host, timeout=self.settings.request_timeout)

    def available(self) -> bool:
        try:
            return self._http.get("/api/version", timeout=3).status_code == 200
        except httpx.HTTPError:
            return False

    def list_models(self) -> list[str]:
        r = self._http.get("/api/tags", timeout=10)
        r.raise_for_status()
        return [m["name"] for m in r.json().get("models", [])]

    def chat(self, messages: list[dict], model: str | None = None, tools: list[dict] | None = None,
             temperature: float = 0.0, num_ctx: int = 8192, think: bool | None = None) -> ChatResult:
        model = model or self.settings.chat_model
        payload: dict = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": temperature, "num_ctx": num_ctx},
            "keep_alive": "15m",
        }
        if tools:
            payload["tools"] = tools
        if think is None and model.split(":")[0] in THINKING_FAMILIES:
            think = False
        if think is not None:
            payload["think"] = think
        t0 = time.perf_counter()
        try:
            r = self._http.post("/api/chat", json=payload)
        except httpx.HTTPError as e:
            raise OllamaError(f"Cannot reach Ollama at {self.host}: {e}") from e
        if r.status_code != 200:
            raise OllamaError(f"Ollama error {r.status_code}: {r.text[:300]}")
        data = r.json()
        msg = data.get("message", {})
        return ChatResult(
            content=msg.get("content") or "",
            tool_calls=msg.get("tool_calls") or [],
            latency_s=time.perf_counter() - t0,
            prompt_tokens=data.get("prompt_eval_count", 0),
            completion_tokens=data.get("eval_count", 0),
            raw=data,
        )

    def chat_stream(self, messages: list[dict], model: str | None = None, tools: list[dict] | None = None,
                    temperature: float = 0.0, num_ctx: int = 8192, think: bool | None = None):
        """Yield Ollama's NDJSON chunks: message deltas, tool calls, and a final chunk with token counts."""
        import json

        model = model or self.settings.chat_model
        payload: dict = {"model": model, "messages": messages, "stream": True,
                         "options": {"temperature": temperature, "num_ctx": num_ctx}, "keep_alive": "15m"}
        if tools:
            payload["tools"] = tools
        if think is None and model.split(":")[0] in THINKING_FAMILIES:
            think = False
        if think is not None:
            payload["think"] = think
        try:
            with self._http.stream("POST", "/api/chat", json=payload) as r:
                if r.status_code != 200:
                    r.read()
                    raise OllamaError(f"Ollama error {r.status_code}: {r.text[:300]}")
                for line in r.iter_lines():
                    if line.strip():
                        chunk = json.loads(line)
                        if chunk.get("error"):
                            raise OllamaError(chunk["error"])
                        yield chunk
        except httpx.HTTPError as e:
            raise OllamaError(f"Cannot reach Ollama at {self.host}: {e}") from e

    def embed(self, texts: list[str], model: str | None = None, batch: int = 32) -> list[list[float]]:
        model = model or self.settings.embed_model
        out: list[list[float]] = []
        for i in range(0, len(texts), batch):
            try:
                r = self._http.post("/api/embed", json={"model": model, "input": texts[i:i + batch],
                                                        "keep_alive": "15m"})
            except httpx.HTTPError as e:
                raise OllamaError(f"Cannot reach Ollama at {self.host}: {e}") from e
            if r.status_code != 200:
                raise OllamaError(f"Ollama embed error {r.status_code}: {r.text[:300]}")
            out.extend(r.json()["embeddings"])
        return out
