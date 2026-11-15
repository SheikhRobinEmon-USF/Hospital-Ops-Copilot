"""The copilot agent: an Ollama tool-calling loop with a deterministic fallback.

Flow for each question:
1. The local model chooses tools (native Ollama tool calling). The loop runs until the model
   answers or ``max_steps`` is reached.
2. If the model replies with a JSON tool call in plain text (common with small models), it is
   parsed and executed.
3. If the model answers with figures but never called a tool, it is asked once to use tools.
4. The final answer is checked by ``grounding.check``; sources come from the tools that ran, not
   from the model, so citations cannot be invented.
If Ollama is unavailable, or ``HOC_LLM_BACKEND=offline`` is set, the deterministic router answers
with templated narratives over the same tools.
"""

from __future__ import annotations

import json
import re
import time

from ..analytics.store import DataStore, get_store
from ..config import Settings, get_settings
from ..rag.index import Retriever, get_retriever
from . import grounding
from .answer import AgentAnswer
from .narrator import OfflineRouter
from .ollama_client import OllamaClient, OllamaError
from .prompts import system_prompt
from .tools import TOOL_NAMES, TOOL_SCHEMAS, ToolExecutor

_JSON_CALL = re.compile(r"\{[^{}]*\"name\"\s*:\s*\"(?P<name>[a-z_]+)\"[^{}]*\"(?:arguments|parameters)\"\s*:\s*(?P<args>\{[^{}]*\})[^{}]*\}", re.S)
_DIGIT_CLAIM = re.compile(r"\d[\d,]*(?:\.\d+)?\s?(?:%|[KMB]\b)|\$\d")


def _text_tool_calls(content: str) -> list[dict]:
    calls = []
    for m in _JSON_CALL.finditer(content or ""):
        if m.group("name") in TOOL_NAMES:
            try:
                calls.append({"function": {"name": m.group("name"), "arguments": json.loads(m.group("args"))}})
            except json.JSONDecodeError:
                continue
    return calls


class Copilot:
    def __init__(self, store: DataStore | None = None, retriever: Retriever | None = None,
                 settings: Settings | None = None, client: OllamaClient | None = None,
                 model: str | None = None, max_steps: int = 5):
        self.settings = settings or get_settings()
        self.store = store or get_store()
        self.retriever = retriever if retriever is not None else get_retriever()
        self.client = client or OllamaClient(self.settings)
        self.model = model or self.settings.chat_model
        self.max_steps = max_steps
        self.tools = ToolExecutor(self.store, self.retriever)
        self.offline = OfflineRouter(self.tools, self.store)

    def backend_available(self) -> bool:
        return self.settings.llm_backend != "offline" and self.client.available()

    def ask(self, question: str, context_ccn: str | None = None, context_year: int | None = None,
            history: list[dict] | None = None, force_offline: bool = False) -> AgentAnswer:
        if force_offline or not self.backend_available():
            ans = self.offline.answer(question, context_ccn, context_year)
            if self.settings.llm_backend != "offline" and not force_offline:
                ans.notes.append(f"Ollama not reachable at {self.settings.ollama_host}; used the offline analyst.")
            return ans
        try:
            return self._ask_llm(question, context_ccn, context_year, history or [])
        except OllamaError as e:
            ans = self.offline.answer(question, context_ccn, context_year)
            ans.notes.append(f"Ollama error, fell back to the offline analyst: {e}")
            return ans

    def _ask_llm(self, question: str, context_ccn: str | None, context_year: int | None,
                 history: list[dict]) -> AgentAnswer:
        t0 = time.perf_counter()
        ctx_name = None
        if context_ccn:
            row = self.store.get(context_ccn, context_year)
            ctx_name = row["name"] if row is not None else None
        messages = [{"role": "system", "content": system_prompt(self.store.years, context_ccn, ctx_name, context_year)}]
        messages += [m for m in history[-6:] if m.get("role") in ("user", "assistant")]
        messages.append({"role": "user", "content": question})
        ans = AgentAnswer(question, "", "ollama", self.model)
        nudged = False
        final = ""
        for step in range(1, self.max_steps + 1):
            ans.steps = step
            res = self.client.chat(messages, model=self.model, tools=TOOL_SCHEMAS)
            ans.prompt_tokens += res.prompt_tokens
            ans.completion_tokens += res.completion_tokens
            calls = res.tool_calls or _text_tool_calls(res.content)
            if not calls:
                if not ans.tool_results and not nudged and _DIGIT_CLAIM.search(res.content or ""):
                    nudged = True
                    ans.notes.append("Model answered with figures before calling a tool; asked it to use tools.")
                    messages.append({"role": "assistant", "content": res.content})
                    messages.append({"role": "user", "content": "Use the tools to get the figures, then answer."})
                    continue
                final = res.content.strip()
                break
            messages.append({"role": "assistant", "content": res.content or "", "tool_calls": res.tool_calls or calls})
            for call in calls[:4]:
                fn = call.get("function", {})
                tr = self.tools.run(fn.get("name", ""), fn.get("arguments") or {})
                ans.tool_results.append(tr)
                messages.append({"role": "tool", "tool_name": tr.name, "content": tr.llm_view[:6000]})
        else:
            # Out of steps: ask for an answer without tools.
            res = self.client.chat(messages + [{"role": "user", "content": "Answer now with the data you have."}],
                                   model=self.model)
            final = res.content.strip()
            ans.notes.append("Reached the tool step limit.")
        final = re.sub(r"<think>.*?</think>", "", final, flags=re.S).strip()
        if not final:
            final = "I could not produce an answer from the available data."
        ans.answer = final
        ans.grounding = grounding.check(final, [t.data for t in ans.tool_results if t.ok])
        ans.latency_s = time.perf_counter() - t0
        return ans
