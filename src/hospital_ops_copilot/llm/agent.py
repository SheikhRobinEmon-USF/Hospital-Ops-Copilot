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
from collections.abc import Iterator

from ..analytics.store import DataStore, get_store
from ..config import Settings, get_settings
from ..rag.index import Retriever, get_retriever
from . import grounding
from .answer import AgentAnswer
from .narrator import OfflineRouter
from .ollama_client import ChatResult, OllamaClient, OllamaError
from .prompts import system_prompt
from .tools import TOOL_NAMES, TOOL_SCHEMAS, ToolExecutor, ToolResult

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


Event = dict
FOLLOWUPS: dict[str, list[str]] = {
    "benchmark_hospital": ["What are our biggest savings opportunities?", "How has our operating margin changed over time?"],
    "find_opportunities": ["What if we cut operating expenses 3%?", "How does our staffing compare with peers?"],
    "get_trend": ["How do we compare to peers this year?", "What are our biggest savings opportunities?"],
    "run_scenario": ["What if volume also grows 5%?", "Where are our biggest savings opportunities?"],
    "rank_hospitals": ["How do we compare to these hospitals?", "How is operating margin calculated?"],
    "search_documentation": ["How do we compare to peers on this metric?", "How are peer groups defined?"],
    "get_hospital_profile": ["How do we compare to our peers?", "What are our biggest savings opportunities?"],
}


def suggest_followups(tools_called: list[str]) -> list[str]:
    out: list[str] = []
    for name in reversed(tools_called):
        for q in FOLLOWUPS.get(name, []):
            if q not in out:
                out.append(q)
    return out[:3] or ["How do we compare to our peers?", "What are our biggest savings opportunities?"]


def _tool_summary(tr: ToolResult) -> str:
    if not tr.ok:
        return tr.error or "failed"
    d = tr.data
    if tr.name == "search_hospitals":
        return f"{len(d)} match(es)" + (f": {d[0]['name'].title()}" if d else "")
    if tr.name == "benchmark_hospital":
        return f"{len(d['kpis'])} KPIs vs {d['peer_group']['n_hospitals']} peers"
    if tr.name == "find_opportunities":
        return f"{len(d['opportunities'])} opportunities, {d['total_recurring_cost_savings_fmt']} recurring"
    if tr.name == "get_trend":
        return f"{len(d['series'])} years"
    if tr.name == "run_scenario":
        return f"margin {d['baseline']['operating_margin_fmt']} to {d['scenario']['operating_margin_fmt']}"
    if tr.name == "rank_hospitals":
        return f"top {len(d['results'])} of {d['hospitals_considered']}"
    if tr.name == "search_documentation":
        return f"{len(d)} passage(s)"
    if tr.name == "get_hospital_profile":
        return f"{d['name'].title()}, {d['year']}"
    return "ok"


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

    # ---- public API ------------------------------------------------------------------------
    def ask(self, question: str, context_ccn: str | None = None, context_year: int | None = None,
            history: list[dict] | None = None, force_offline: bool = False) -> AgentAnswer:
        """Blocking answer (CLI, API /ask, evals)."""
        result: AgentAnswer | None = None
        for ev in self._events(question, context_ccn, context_year, history or [], force_offline, stream=False):
            if ev["type"] == "_answer":
                result = ev["answer"]
        assert result is not None
        return result

    def stream(self, question: str, context_ccn: str | None = None, context_year: int | None = None,
               history: list[dict] | None = None, force_offline: bool = False) -> Iterator[Event]:
        """Event stream for the web UI: start, tool_start, tool_end, token, reset, final."""
        for ev in self._events(question, context_ccn, context_year, history or [], force_offline, stream=True):
            if ev["type"] == "_answer":
                ans: AgentAnswer = ev["answer"]
                yield {"type": "final", **ans.to_dict(), "followups": suggest_followups(ans.tools_called)}
            else:
                yield ev

    # ---- internals -------------------------------------------------------------------------
    def _events(self, question: str, context_ccn: str | None, context_year: int | None, history: list[dict],
                force_offline: bool, stream: bool) -> Iterator[Event]:
        offline = force_offline or not self.backend_available()
        note = None
        if not offline:
            try:
                yield {"type": "start", "backend": "ollama", "model": self.model}
                yield from self._llm_events(question, context_ccn, context_year, history, stream)
                return
            except OllamaError as e:
                note = f"Ollama error, fell back to the offline analyst: {e}"
                yield {"type": "reset"}
        elif self.settings.llm_backend != "offline" and not force_offline:
            note = f"Ollama not reachable at {self.settings.ollama_host}; used the offline analyst."
        yield {"type": "start", "backend": "offline", "model": None}
        ans = self.offline.answer(question, context_ccn, context_year)
        if note:
            ans.notes.append(note)
        for tr in ans.tool_results:
            yield {"type": "tool_start", "name": tr.name, "args": tr.args}
            yield {"type": "tool_end", "name": tr.name, "ok": tr.ok, "summary": _tool_summary(tr)}
        if stream:
            for chunk in re.findall(r"\S+\s*", ans.answer):
                yield {"type": "token", "text": chunk}
        yield {"type": "_answer", "answer": ans}

    def _complete(self, messages: list[dict], tools: list[dict] | None, stream: bool) -> Iterator[Event | ChatResult]:
        """One model call. Streams token events when possible; always ends by yielding a ChatResult."""
        if not stream or not hasattr(self.client, "chat_stream"):
            yield self.client.chat(messages, model=self.model, tools=tools)
            return
        content, calls, emitted, last = [], [], False, {}
        t0 = time.perf_counter()
        for chunk in self.client.chat_stream(messages, model=self.model, tools=tools):
            msg = chunk.get("message", {})
            if msg.get("tool_calls"):
                calls.extend(msg["tool_calls"])
            text = msg.get("content") or ""
            if text:
                content.append(text)
                if not calls:
                    emitted = True
                    yield {"type": "token", "text": text}
            last = chunk
        full = "".join(content)
        if emitted and (calls or _text_tool_calls(full)):
            yield {"type": "reset"}
        yield ChatResult(full, calls, time.perf_counter() - t0, last.get("prompt_eval_count", 0),
                         last.get("eval_count", 0), last)

    def _llm_events(self, question: str, context_ccn: str | None, context_year: int | None,
                    history: list[dict], stream: bool) -> Iterator[Event]:
        t0 = time.perf_counter()
        ctx_name = None
        if context_ccn:
            row = self.store.get(context_ccn, context_year)
            ctx_name = row["name"] if row is not None else None
        messages = [{"role": "system", "content": system_prompt(self.store.years, context_ccn, ctx_name, context_year)}]
        messages += [{"role": m["role"], "content": m["content"]} for m in history[-6:] if m.get("role") in ("user", "assistant")]
        messages.append({"role": "user", "content": question})
        ans = AgentAnswer(question, "", "ollama", self.model)
        nudged = False
        final = ""
        for step in range(1, self.max_steps + 1):
            ans.steps = step
            res: ChatResult | None = None
            for item in self._complete(messages, TOOL_SCHEMAS, stream):
                if isinstance(item, ChatResult):
                    res = item
                else:
                    yield item
            assert res is not None
            ans.prompt_tokens += res.prompt_tokens
            ans.completion_tokens += res.completion_tokens
            calls = res.tool_calls or _text_tool_calls(res.content)
            if not calls:
                if not ans.tool_results and not nudged and _DIGIT_CLAIM.search(res.content or ""):
                    nudged = True
                    ans.notes.append("Model answered with figures before calling a tool; asked it to use tools.")
                    if stream:
                        yield {"type": "reset"}
                    messages.append({"role": "assistant", "content": res.content})
                    messages.append({"role": "user", "content": "Use the tools to get the figures, then answer."})
                    continue
                final = res.content.strip()
                break
            messages.append({"role": "assistant", "content": res.content or "", "tool_calls": res.tool_calls or calls})
            for call in calls[:4]:
                fn = call.get("function", {})
                name, args = fn.get("name", ""), fn.get("arguments") or {}
                yield {"type": "tool_start", "name": name, "args": args if isinstance(args, dict) else {}}
                tr = self.tools.run(name, args)
                ans.tool_results.append(tr)
                yield {"type": "tool_end", "name": tr.name, "ok": tr.ok, "summary": _tool_summary(tr)}
                messages.append({"role": "tool", "tool_name": tr.name, "content": tr.llm_view[:6000]})
        else:
            res = None
            for item in self._complete(messages + [{"role": "user", "content": "Answer now with the data you have."}],
                                       None, stream):
                if isinstance(item, ChatResult):
                    res = item
                else:
                    yield item
            final = res.content.strip() if res else ""
            ans.notes.append("Reached the tool step limit.")
        cleaned = re.sub(r"<think>.*?</think>", "", final, flags=re.S).strip()
        if stream and cleaned != final:
            yield {"type": "reset"}
            yield {"type": "token", "text": cleaned}
        final = cleaned or "I could not produce an answer from the available data."
        ans.answer = final
        ans.grounding = grounding.check(final, [t.data for t in ans.tool_results if t.ok])
        ans.latency_s = time.perf_counter() - t0
        yield {"type": "_answer", "answer": ans}
