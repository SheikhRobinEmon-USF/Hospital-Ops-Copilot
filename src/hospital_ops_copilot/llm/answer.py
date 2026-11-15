"""Answer object returned by the copilot (LLM or offline)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from . import grounding
from .tools import ToolResult


@dataclass
class AgentAnswer:
    question: str
    answer: str
    backend: str
    model: str | None
    tool_results: list[ToolResult] = field(default_factory=list)
    grounding: grounding.GroundingReport | None = None
    latency_s: float = 0.0
    steps: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    notes: list[str] = field(default_factory=list)

    @property
    def tools_called(self) -> list[str]:
        return [t.name for t in self.tool_results]

    @property
    def sources(self) -> list[dict]:
        seen, out = set(), []
        for t in self.tool_results:
            for c in t.citations:
                key = json.dumps(c, sort_keys=True, default=str)
                if key not in seen:
                    seen.add(key)
                    out.append(c)
        return out

    def to_dict(self) -> dict:
        return {"question": self.question, "answer": self.answer, "backend": self.backend, "model": self.model,
                "tools_called": self.tools_called, "tool_calls": [{"name": t.name, "args": t.args, "ok": t.ok,
                                                                    "error": t.error} for t in self.tool_results],
                "sources": self.sources, "grounding": self.grounding.to_dict() if self.grounding else None,
                "latency_s": round(self.latency_s, 2), "steps": self.steps, "prompt_tokens": self.prompt_tokens,
                "completion_tokens": self.completion_tokens, "notes": self.notes}
