"""REST API for Hospital Ops Copilot (FastAPI). Run: ``uvicorn hospital_ops_copilot.api.main:app``."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from .. import __version__
from ..analytics import benchmark as bm
from ..analytics.kpis import KPIS
from ..analytics.store import get_store
from ..config import get_settings
from ..llm.agent import Copilot

app = FastAPI(
    title="Hospital Ops Copilot API",
    version=__version__,
    description="Hospital financial benchmarking on public CMS cost report data, with a local-LLM copilot.",
)
_copilot: Copilot | None = None


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


@app.get("/hospitals/{ccn}")
def profile(ccn: str, year: int | None = None) -> dict:
    return _wrap(bm.profile, get_store(), ccn, year)


@app.get("/hospitals/{ccn}/benchmark")
def benchmark(ccn: str, year: int | None = None, peer_dims: list[str] | None = Query(None)) -> dict:
    return _wrap(bm.benchmark, get_store(), ccn, year, peer_dims)


@app.get("/hospitals/{ccn}/opportunities")
def opportunities(ccn: str, year: int | None = None, target: str = "median") -> dict:
    return _wrap(bm.opportunities, get_store(), ccn, year, target=target)


@app.get("/hospitals/{ccn}/trend")
def trend(ccn: str, kpis: list[str] | None = Query(None)) -> dict:
    return _wrap(bm.trend, get_store(), ccn, kpis)


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
    return _wrap(bm.rank, get_store(), kpi, year, state, facility_type, min_beds, min(top_n, 100), best_first)


class AskIn(BaseModel):
    question: str = Field(..., min_length=3)
    ccn: str | None = None
    year: int | None = None
    model: str | None = None
    offline: bool = False


@app.post("/ask")
def ask(body: AskIn) -> dict:
    c = copilot()
    if body.model and body.model != c.model:
        c = Copilot(store=c.store, retriever=c.retriever, model=body.model)
    return c.ask(body.question, context_ccn=body.ccn, context_year=body.year, force_offline=body.offline).to_dict()
