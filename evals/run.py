"""Evaluation runner.

    hoc eval retrieval --embed-models nomic-embed-text embeddinggemma qwen3-embedding:0.6b
    hoc eval agent --models qwen3.5:4b llama3.2:3b --offline

Retrieval: hit@1, hit@3, and MRR for BM25, dense, and hybrid retrieval per embedding model.
Agent: for each chat model, tool selection accuracy, answer accuracy (expected figures and keywords
present), numeric grounding, and latency. Per-case results go to evals/results/*.jsonl and a summary
to evals/results/summary_<suite>.json.
"""

from __future__ import annotations

import json
import re
import statistics
import time
from pathlib import Path

from hospital_ops_copilot.analytics.store import get_store
from hospital_ops_copilot.config import get_settings
from hospital_ops_copilot.llm.agent import Copilot
from hospital_ops_copilot.rag.corpus import build_corpus
from hospital_ops_copilot.rag.index import Retriever

from .cases import RETRIEVAL_CASES, AgentCase, agent_cases

RESULTS = Path(__file__).parent / "results"
_NUM = re.compile(r"\$?(\d[\d,]*(?:\.\d+)?)\s?(%|[KMB]\b|thousand|million|billion)?", re.I)
_SCALE = {"k": 1e3, "thousand": 1e3, "m": 1e6, "million": 1e6, "b": 1e9, "billion": 1e9, "%": 0.01}


def _numbers_in(text: str) -> list[float]:
    """All numbers in the answer as raw values: 8.5% -> 0.085, $3.44B -> 3.44e9."""
    out = []
    for m in _NUM.finditer(text):
        v = float(m.group(1).replace(",", "")) * _SCALE.get((m.group(2) or "").lower(), 1)
        out += [v, -v]  # sign-insensitive: "-10.0% margin" may be written "a 10.0% loss"
    return out


def _match(expected: float, tol: float, nums: list[float]) -> bool:
    return any(abs(n - expected) <= tol for n in nums)


def _safe(model: str) -> str:
    return re.sub(r"[^a-zA-Z0-9.]+", "_", model)


def score_case(case: AgentCase, ans) -> dict:
    called = set(ans.tools_called)
    tool_ok = all(called & group for group in case.expected_tools)
    nums = _numbers_in(ans.answer)
    num_hits = [_match(exp, tol, nums) for exp, tol in case.numbers]
    kw_hits = [k.lower() in ans.answer.lower() for k in case.keywords]
    answer_ok = all(num_hits) and all(kw_hits)
    g = ans.grounding.to_dict() if ans.grounding else {"score": 1.0, "numbers_checked": 0, "ungrounded": []}
    return {"id": case.id, "model": getattr(ans, "model", None), "question": case.question, "tool_ok": tool_ok, "answer_ok": answer_ok,
            "expected_numbers": case.numbers, "number_hits": num_hits, "keywords": case.keywords,
            "keyword_hits": kw_hits, "tools_called": ans.tools_called, "grounding": g,
            "latency_s": round(ans.latency_s, 2), "steps": ans.steps, "completion_tokens": ans.completion_tokens,
            "backend": ans.backend, "notes": ans.notes, "answer": ans.answer}


def summarize(rows: list[dict]) -> dict:
    lat = [r["latency_s"] for r in rows]
    checked = [r for r in rows if r["grounding"]["numbers_checked"]]
    return {
        "cases": len(rows),
        "tool_accuracy": round(sum(r["tool_ok"] for r in rows) / len(rows), 3),
        "answer_accuracy": round(sum(r["answer_ok"] for r in rows) / len(rows), 3),
        "grounding_mean": round(statistics.mean(r["grounding"]["score"] for r in checked), 3) if checked else None,
        "fully_grounded_rate": round(sum(r["grounding"]["score"] == 1.0 for r in rows) / len(rows), 3),
        "latency_p50_s": round(statistics.median(lat), 1),
        "latency_max_s": round(max(lat), 1),
        "fell_back_offline": sum(r["backend"] == "offline" for r in rows),
    }


def run_agent(models: list[str], include_offline: bool, limit: int | None) -> dict:
    store = get_store()
    retriever = Retriever(chunks=build_corpus())
    cases = agent_cases(store)[:limit] if limit else agent_cases(store)
    RESULTS.mkdir(exist_ok=True)
    summary: dict[str, dict] = {}
    configs = (["offline"] if include_offline else []) + models
    for model in configs:
        copilot = Copilot(store=store, retriever=retriever, model=None if model == "offline" else model)
        rows = []
        if model != "offline":  # warm-up so model load time is not counted
            copilot.client.chat([{"role": "user", "content": "hi"}], model=model)
        for case in cases:
            ans = copilot.ask(case.question, context_ccn=case.context_ccn, context_year=case.context_year,
                              force_offline=model == "offline")
            row = score_case(case, ans)
            rows.append(row)
            print(f"[{model}] {case.id:16s} tool={'Y' if row['tool_ok'] else 'n'} answer={'Y' if row['answer_ok'] else 'n'} "
                  f"grounded={row['grounding']['score']:.2f} {row['latency_s']:.1f}s", flush=True)
        with open(RESULTS / f"agent_{_safe(model)}.jsonl", "w") as f:
            for r in rows:
                f.write(json.dumps(r, default=str) + "\n")
        summary[model] = summarize(rows)
        print(model, summary[model], flush=True)
        _write_summary("agent", summary)
    return summary


def run_retrieval(embed_models: list[str]) -> dict:
    chunks = build_corpus()
    summary: dict[str, dict] = {}

    def evaluate(r: Retriever) -> dict:
        ranks, lat = [], []
        for q, target in RETRIEVAL_CASES:
            t0 = time.perf_counter()
            hits = r.search(q, k=10)
            lat.append(time.perf_counter() - t0)
            rank = next((h.rank for h in hits if target.lower() in h.chunk.title.lower()), None)
            ranks.append(rank)
        n = len(ranks)
        return {"hit@1": round(sum(r == 1 for r in ranks) / n, 3),
                "hit@3": round(sum(r is not None and r <= 3 for r in ranks) / n, 3),
                "mrr": round(sum(1 / r for r in ranks if r) / n, 3),
                "query_latency_ms_p50": round(statistics.median(lat) * 1000, 1),
                "misses@3": [q for (q, _), rk in zip(RETRIEVAL_CASES, ranks, strict=True) if not rk or rk > 3]}

    summary["bm25"] = evaluate(Retriever(chunks=chunks, mode="bm25"))
    print("bm25", summary["bm25"], flush=True)
    for m in embed_models:
        for mode in ("dense", "hybrid"):
            r = Retriever(chunks=chunks, embed_model=m, mode=mode)
            t0 = time.perf_counter()
            r._load_vectors()
            build = time.perf_counter() - t0
            res = evaluate(r)
            res["index_build_s"] = round(build, 1)
            summary[f"{mode}:{m}"] = res
            print(f"{mode}:{m}", res, flush=True)
    _write_summary("retrieval", summary)
    return summary


def rescore() -> dict:
    """Re-score saved agent answers with the current cases and scorer, without re-running models."""
    from types import SimpleNamespace

    cases = {c.id: c for c in agent_cases(get_store())}
    summary_path = RESULTS / "summary_agent.json"
    known = json.loads(summary_path.read_text()) if summary_path.exists() else {}
    names = {_safe(k): k for k in known}
    summary = {}
    for path in sorted(RESULTS.glob("agent_*.jsonl")):
        rows = []
        for line in path.read_text().splitlines():
            old = json.loads(line)
            ans = SimpleNamespace(tools_called=old["tools_called"], answer=old["answer"], latency_s=old["latency_s"],
                                  steps=old["steps"], completion_tokens=old["completion_tokens"], backend=old["backend"],
                                  notes=old["notes"], grounding=SimpleNamespace(to_dict=lambda g=old["grounding"]: g))
            rows.append(score_case(cases[old["id"]], ans))
        path.write_text("".join(json.dumps(r, default=str) + "\n" for r in rows))
        stem = path.stem.removeprefix("agent_")
        model = names.get(stem, stem)
        summary[model] = summarize(rows)
    _write_summary("agent", summary)
    return summary


def _write_summary(suite: str, summary: dict) -> None:
    RESULTS.mkdir(exist_ok=True)
    path = RESULTS / f"summary_{suite}.json"
    existing = json.loads(path.read_text()) if path.exists() else {}
    existing.update(summary)
    path.write_text(json.dumps(existing, indent=2))


def main(args) -> int:
    s = get_settings()
    if args.suite == "rescore":
        print(json.dumps(rescore(), indent=2))
    elif args.suite == "retrieval":
        run_retrieval(args.embed_models or [s.embed_model])
    else:
        run_agent(args.models or [s.chat_model], args.offline, args.limit)
    return 0
