"""REST API for Hospital Ops Copilot (FastAPI). Run: ``uvicorn hospital_ops_copilot.api.main:app``."""

from __future__ import annotations

import json
import os
from collections import OrderedDict
from collections.abc import Callable
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .. import __version__
from ..analytics import benchmark as bm
from ..analytics.kpis import KPIS
from ..analytics.store import get_store
from ..config import get_settings
from ..llm.agent import Copilot
from ..llm.ollama_client import OllamaClient

app = FastAPI(
    title="Hospital Ops Copilot API",
    version=__version__,
    description="Hospital financial benchmarking on public CMS cost report data, with a local-LLM copilot.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("HOC_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)
_copilot: Copilot | None = None

# Results are pure functions of (data, arguments), so they are cached in memory. A benchmark is
# ~20 ms of pandas work; a cache hit is microseconds. Keyed by the store's identity so a data reload
# (or a test fixture) never serves stale results.
_CACHE: OrderedDict[tuple, Any] = OrderedDict()
_CACHE_MAX = 4096


def _cached(fn: Callable, *args: Any, **kwargs: Any) -> Any:
    norm = tuple(tuple(a) if isinstance(a, list) else a for a in args[1:])
    key = (fn.__name__, id(args[0]), norm, tuple(sorted(kwargs.items())))
    if key in _CACHE:
        _CACHE.move_to_end(key)
        return _CACHE[key]
    value = _wrap(fn, *args, **kwargs)
    _CACHE[key] = value
    if len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)
    return value


def copilot() -> Copilot:
    global _copilot
    if _copilot is None:
        _copilot = Copilot()
    return _copilot


def _wrap(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except bm.NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.get("/health")
def health() -> dict:
    s = get_settings()
    store = get_store()
    return {"status": "ok", "version": __version__, "years": store.years, "hospitals": int(store.df["ccn"].nunique()),
            "llm_backend": s.llm_backend, "chat_model": s.chat_model, "embed_model": s.embed_model,
            "ollama_available": copilot().backend_available()}


@app.get("/kpis")
def kpis() -> list[dict]:
    return [{"key": k.key, "label": k.label, "category": k.category, "unit": k.unit, "direction": k.direction,
             "formula": k.formula, "fields": list(k.fields), "description": k.description} for k in KPIS]


@app.get("/hospitals/search")
def search(q: str = Query(..., min_length=2), state: str | None = None, limit: int = 10) -> list[dict]:
    return get_store().search(q, state=state, limit=min(limit, 50))


@app.get("/models")
def models() -> dict:
    s = get_settings()
    client = OllamaClient()
    available = client.available() and s.llm_backend != "offline"
    names = []
    if available:
        try:
            names = [m for m in client.list_models() if "embed" not in m]
        except Exception:  # noqa: BLE001
            names = []
    return {"ollama_available": available, "default": s.chat_model, "models": names}


@app.get("/hospitals/{ccn}")
def profile(ccn: str, year: int | None = None) -> dict:
    d = dict(_cached(bm.profile, get_store(), ccn, year))
    d["available_years"] = [int(y) for y in get_store().history(d["ccn"])["year"]]
    return d


@app.get("/hospitals/{ccn}/insights")
def insights(ccn: str, year: int | None = None, peer_dims: list[str] | None = Query(None)) -> dict:
    """Proactive, deterministic highlights: biggest strengths, risks, and the top sized opportunity."""
    return _cached(bm.insights, get_store(), ccn, year, peer_dims)


@app.get("/hospitals/{ccn}/benchmark")
def benchmark(ccn: str, year: int | None = None, peer_dims: list[str] | None = Query(None)) -> dict:
    return _cached(bm.benchmark, get_store(), ccn, year, peer_dims)


@app.get("/hospitals/{ccn}/opportunities")
def opportunities(ccn: str, year: int | None = None, target: str = "median",
                  peer_dims: list[str] | None = Query(None)) -> dict:
    return _cached(bm.opportunities, get_store(), ccn, year, peer_dims, target=target)


@app.get("/hospitals/{ccn}/trend")
def trend(ccn: str, kpis: list[str] | None = Query(None), peer_dims: list[str] | None = Query(None)) -> dict:
    return _cached(bm.trend, get_store(), ccn, kpis, peer_dims)


class ScenarioIn(BaseModel):
    year: int | None = None
    volume_change_pct: float = 0
    rate_change_pct: float = 0
    opex_change_pct: float = 0
    labor_cost_change_pct: float = 0
    variable_cost_share: float = Field(0.35, ge=0, le=1)


@app.post("/hospitals/{ccn}/scenario")
def scenario(ccn: str, body: ScenarioIn) -> dict:
    return _wrap(bm.scenario, get_store(), ccn, body.year, body.volume_change_pct, body.rate_change_pct,
                 body.opex_change_pct, body.labor_cost_change_pct, body.variable_cost_share)


@app.get("/rankings/{kpi}")
def rankings(kpi: str, year: int | None = None, state: str | None = None, facility_type: str | None = None,
             min_beds: int = 0, top_n: int = 10, best_first: bool = True) -> dict:
    return _cached(bm.rank, get_store(), kpi, year, state, facility_type, min_beds, min(top_n, 100), best_first)


class AskIn(BaseModel):
    question: str = Field(..., min_length=3)
    ccn: str | None = None
    year: int | None = None
    model: str | None = None
    offline: bool = False


class StreamIn(AskIn):
    history: list[dict] = Field(default_factory=list)


@app.post("/ask/stream")
def ask_stream(body: StreamIn) -> StreamingResponse:
    """Server-sent events: start, tool_start, tool_end, token, reset, final."""
    c = copilot()
    if body.model and body.model != c.model:
        c = Copilot(store=c.store, retriever=c.retriever, model=body.model)

    def events():
        try:
            for ev in c.stream(body.question, context_ccn=body.ccn, context_year=body.year,
                               history=body.history, force_offline=body.offline):
                yield f"data: {json.dumps(ev, default=str)}\n\n"
        except Exception as e:  # noqa: BLE001
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/ask")
def ask(body: AskIn) -> dict:
    c = copilot()
    if body.model and body.model != c.model:
        c = Copilot(store=c.store, retriever=c.retriever, model=body.model)
    return c.ask(body.question, context_ccn=body.ccn, context_year=body.year, force_offline=body.offline).to_dict()
