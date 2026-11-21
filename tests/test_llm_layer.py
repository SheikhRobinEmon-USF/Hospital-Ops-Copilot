from fastapi.testclient import TestClient

from hospital_ops_copilot.llm import grounding
from hospital_ops_copilot.llm.agent import Copilot, _text_tool_calls
from hospital_ops_copilot.llm.narrator import _pcts, detect_intent, detect_kpi
from hospital_ops_copilot.llm.ollama_client import ChatResult
from hospital_ops_copilot.llm.tools import TOOL_NAMES, ToolExecutor

# ---- grounding ----------------------------------------------------------------------------


def test_grounding_accepts_formatted_and_converted_numbers():
    data = [{"value": 0.0845, "peer_median": 0.021, "npr": 2_230_000_000, "label": "$24,121"}]
    rep = grounding.check("Margin was 8.5% vs 2.1%, 6.4 points above. Revenue $2.23B; cost $24,121.", data)
    assert rep.ungrounded == [], rep.to_dict()
    assert rep.total == 5


def test_grounding_flags_invented_numbers():
    rep = grounding.check("Margin was 12.7% and savings were $45M.", [{"value": 0.0845}])
    assert set(rep.ungrounded) == {"12.7%", "$45M"}
    assert rep.score == 0


def test_grounding_ignores_dates():
    rep = grounding.check("The period ran from October 1, 2022 to September 30, 2023 (2023-09-30).", [{}])
    assert rep.total == 0


def test_grounding_ignores_years_ccns_and_list_numbers():
    rep = grounding.check("1. In 2023, hospital 100128 had 3 areas to fix.", [{}])
    assert rep.total == 0 and rep.score == 1.0


# ---- routing and parsing ------------------------------------------------------------------


def test_intent_detection():
    assert detect_intent("What does days in AR mean?") == "docs"
    assert detect_intent("What if volume grows 5%?") == "scenario"
    assert detect_intent("Top hospitals by margin in FL") == "rank"
    assert detect_intent("How has our margin changed over time?") == "trend"
    assert detect_intent("Where can we save money?") == "opportunities"
    assert detect_intent("How do we compare to peers?") == "benchmark"


def test_kpi_detection_and_scenario_parsing():
    assert detect_kpi("what is our length of stay") == "alos"
    assert detect_kpi("cost per adjusted discharge") == "opex_per_adj_discharge"
    p = _pcts("What if volume grows 5% and we cut costs 2% while labor costs rise 3%?")
    assert p["volume_change_pct"] == 5 and p["opex_change_pct"] == -2 and p["labor_cost_change_pct"] == 3


def test_text_tool_call_parsing():
    calls = _text_tool_calls('Sure: {"name": "benchmark_hospital", "arguments": {"ccn": "100128"}}')
    assert calls[0]["function"]["name"] == "benchmark_hospital"


# ---- tools --------------------------------------------------------------------------------


def test_every_tool_runs(store, retriever, sample_ccn):
    ex = ToolExecutor(store, retriever)
    args = {
        "search_hospitals": {"query": "sample general"},
        "get_hospital_profile": {"ccn": sample_ccn},
        "benchmark_hospital": {"ccn": sample_ccn, "year": 2023},
        "find_opportunities": {"ccn": sample_ccn},
        "get_trend": {"ccn": sample_ccn},
        "run_scenario": {"ccn": sample_ccn, "volume_change_pct": 5},
        "rank_hospitals": {"kpi": "operating_margin"},
        "search_documentation": {"query": "how is occupancy rate calculated"},
    }
    assert set(args) == set(TOOL_NAMES)
    for name, a in args.items():
        r = ex.run(name, a)
        assert r.ok, (name, r.error)
        assert r.llm_view and len(r.llm_view) < 6000


def test_tool_errors_are_reported_not_raised(store, retriever):
    ex = ToolExecutor(store, retriever)
    assert not ex.run("benchmark_hospital", {"ccn": "999999"}).ok
    assert not ex.run("nope", {}).ok
    assert not ex.run("rank_hospitals", {"kpi": "made_up"}).ok


def test_documentation_search_finds_kpi(retriever):
    hits = retriever.search("how is days cash on hand calculated", k=3)
    assert any("days_cash_on_hand" in h.chunk.title for h in hits)


# ---- agent --------------------------------------------------------------------------------


class FakeClient:
    """Scripted Ollama stand-in: first a tool call, then an answer quoting tool output."""

    def __init__(self, ccn: str):
        self.ccn = ccn
        self.calls = 0

    def available(self) -> bool:
        return True

    def chat(self, messages, model=None, tools=None, **kw):
        self.calls += 1
        if self.calls == 1:
            return ChatResult("", [{"function": {"name": "benchmark_hospital", "arguments": {"ccn": self.ccn, "year": 2023}}}])
        import json
        tool_msg = json.loads(messages[-1]["content"])
        m = tool_msg["kpis"][0]
        return ChatResult(f"{m['kpi']} is {m['value']} vs a peer median of {m['peer_median']}. Also 1234.5% made up.")


def test_agent_loop_with_fake_model(store, retriever, sample_ccn):
    c = Copilot(store=store, retriever=retriever, client=FakeClient(sample_ccn), model="fake")
    ans = c.ask("How do we compare?", context_ccn=sample_ccn)
    assert ans.backend == "ollama"
    assert ans.tools_called == ["benchmark_hospital"]
    assert ans.grounding.ungrounded == ["1234.5%"]
    assert ans.sources and ans.sources[0]["ccn"] == sample_ccn


def test_offline_router_end_to_end(store, retriever, sample_ccn):
    c = Copilot(store=store, retriever=retriever, model="none")
    for q in ["How do we compare to peers?", "What are our savings opportunities?", "What if volume grows 5%?",
              "How has our margin changed over time?", "What does occupancy rate mean?"]:
        a = c.ask(q, context_ccn=sample_ccn, force_offline=True)
        assert a.backend == "offline" and a.answer
        assert a.grounding.score == 1.0, (q, a.grounding.to_dict())


# ---- API ----------------------------------------------------------------------------------


def test_api(monkeypatch, store, retriever, sample_ccn):
    from hospital_ops_copilot.api import main

    monkeypatch.setattr(main, "get_store", lambda: store)
    monkeypatch.setattr(main, "_copilot", Copilot(store=store, retriever=retriever, model="none"))
    client = TestClient(main.app)
    assert client.get(f"/hospitals/{sample_ccn}/benchmark", params={"year": 2023}).status_code == 200
    assert client.get("/hospitals/999999").status_code == 404
    assert client.get("/hospitals/search", params={"q": "sample"}).json()[0]["ccn"] == sample_ccn
    assert client.get("/kpis").status_code == 200
    s = client.post(f"/hospitals/{sample_ccn}/scenario", json={"volume_change_pct": 5}).json()
    assert s["delta"]["operating_income"] > 0
    r = client.post("/ask", json={"question": "How do we compare?", "ccn": sample_ccn, "offline": True}).json()
    assert r["backend"] == "offline" and r["tools_called"]


def test_api_stream_and_insights(monkeypatch, store, retriever, sample_ccn):
    import json as _json

    from hospital_ops_copilot.api import main

    monkeypatch.setattr(main, "get_store", lambda: store)
    monkeypatch.setattr(main, "_copilot", Copilot(store=store, retriever=retriever, model="none"))
    client = TestClient(main.app)
    ins = client.get(f"/hospitals/{sample_ccn}/insights", params={"year": 2023}).json()
    assert ins["insights"] and all(i["kind"] in {"risk", "strength", "opportunity"} for i in ins["insights"])
    prof = client.get(f"/hospitals/{sample_ccn}").json()
    assert prof["available_years"] == [2022, 2023]
    with client.stream("POST", "/ask/stream", json={"question": "How do we compare?", "ccn": sample_ccn,
                                                    "offline": True}) as r:
        events = [_json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]
    types = [e["type"] for e in events]
    assert types[0] == "start" and types[-1] == "final"
    assert "tool_start" in types and "tool_end" in types and "token" in types
    final = events[-1]
    assert final["answer"] == "".join(e["text"] for e in events if e["type"] == "token")
    assert final["followups"]


def test_streaming_agent_with_fake_model(store, retriever, sample_ccn):
    class StreamingFake(FakeClient):
        def chat_stream(self, messages, model=None, tools=None, **kw):
            res = self.chat(messages, model, tools)
            if res.tool_calls:
                yield {"message": {"content": "", "tool_calls": res.tool_calls}}
            else:
                for word in res.content.split(" "):
                    yield {"message": {"content": word + " "}}
            yield {"done": True, "eval_count": 5, "prompt_eval_count": 50}

    c = Copilot(store=store, retriever=retriever, client=StreamingFake(sample_ccn), model="fake")
    events = list(c.stream("How do we compare?", context_ccn=sample_ccn))
    types = [e["type"] for e in events]
    assert types[0] == "start" and "tool_start" in types and "token" in types and types[-1] == "final"
    assert events[-1]["tools_called"] == ["benchmark_hospital"]


def test_scenario_rejects_total_revenue_loss(store, sample_ccn):
    import pytest

    from hospital_ops_copilot.analytics import benchmark as bm

    with pytest.raises(bm.InvalidInputError):
        bm.scenario(store, sample_ccn, 2023, volume_change_pct=-100)
    with pytest.raises(bm.InvalidInputError):
        bm.scenario(store, sample_ccn, 2023, rate_change_pct=-120)


def test_tool_errors_do_not_crash_the_agent(store, retriever, sample_ccn):
    ex = ToolExecutor(store, retriever)
    r = ex.run("run_scenario", {"ccn": sample_ccn, "volume_change_pct": -100})
    assert not r.ok and "-100%" in r.error
    assert not ex.run("run_scenario", {"ccn": sample_ccn, "volume_change_pct": "five"}).ok
    assert not ex.run("rank_hospitals", {"kpi": "operating_margin", "top_n": "ten"}).ok
    assert not ex.run("benchmark_hospital", ["not", "a", "dict"]).ok
    c = Copilot(store=store, retriever=retriever, model="none")
    a = c.ask("What if volume falls 100%?", context_ccn=sample_ccn, force_offline=True)
    assert "-100%" in a.answer and a.tool_results and not a.tool_results[0].ok


def test_rank_tool_parses_string_booleans(store, retriever):
    ex = ToolExecutor(store, retriever)
    best = ex.run("rank_hospitals", {"kpi": "operating_margin", "best_first": True}).data["results"][0]["value"]
    worst = ex.run("rank_hospitals", {"kpi": "operating_margin", "best_first": "false"}).data["results"][0]["value"]
    assert worst < best


def test_api_validates_inputs(monkeypatch, store, retriever, sample_ccn):
    from hospital_ops_copilot.api import main

    monkeypatch.setattr(main, "get_store", lambda: store)
    monkeypatch.setattr(main, "_copilot", Copilot(store=store, retriever=retriever, model="none"))
    client = TestClient(main.app)
    assert client.get("/rankings/operating_margin", params={"top_n": -5}).status_code == 422
    assert client.get("/hospitals/search", params={"q": "sample", "limit": -3}).status_code == 422
    r = client.post(f"/hospitals/{sample_ccn}/scenario", json={"volume_change_pct": -100})
    assert r.status_code == 400 and "-100%" in r.json()["detail"]
    assert client.post("/ask/stream", json={"question": "How do we compare?", "history": [{"role": "user"}]}).status_code == 422
