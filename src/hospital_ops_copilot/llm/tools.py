"""Tools the copilot can call. Each returns full data (for the UI) and a compact view (for the LLM).

Small local models work best with short, flat tool outputs, so ``llm_view`` keeps only the fields
an answer needs, with values pre-formatted. Numbers in the final answer are checked against the
full outputs by ``grounding.check``.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from ..analytics import benchmark as bm
from ..analytics.kpis import KPI_BY_KEY, KPI_KEYS
from ..analytics.store import DataStore
from ..rag.index import Retriever

PEER_DIMS = list(bm.PEER_DIMENSIONS)


def _fn(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {"type": "function", "function": {"name": name, "description": description,
                                             "parameters": {"type": "object", "properties": properties,
                                                            "required": required}}}


CCN = {"type": "string", "description": "6-digit CMS Certification Number (CCN) of the hospital, e.g. '100128'"}
YEAR = {"type": "integer", "description": "Cost report year (2021-2024). Omit for the latest year."}

TOOL_SCHEMAS: list[dict] = [
    _fn("search_hospitals", "Find hospitals by name, city, or CCN. Use this first when the user names a "
        "hospital but no CCN is known.",
        {"query": {"type": "string", "description": "Hospital name, city, or CCN"},
         "state": {"type": "string", "description": "Optional 2-letter state code, e.g. 'FL'"}}, ["query"]),
    _fn("get_hospital_profile", "Get a hospital's profile, headline financials (revenue, expense, net income) "
        "and all KPI values for one year.", {"ccn": CCN, "year": YEAR}, ["ccn"]),
    _fn("benchmark_hospital", "Compare a hospital's KPIs with its peer group: value, peer median, "
        "percentile, and status for each KPI.",
        {"ccn": CCN, "year": YEAR,
         "peer_dims": {"type": "array", "items": {"type": "string", "enum": PEER_DIMS},
                       "description": "Peer group dimensions. Default: facility_type and bed_band."},
         "kpis": {"type": "array", "items": {"type": "string", "enum": KPI_KEYS},
                  "description": "Optional subset of KPIs"}}, ["ccn"]),
    _fn("find_opportunities", "Estimate dollar savings and cash opportunities from closing gaps to the "
        "peer median or top quartile (unit cost, staffing, contract labor, revenue cycle, length of stay).",
        {"ccn": CCN, "year": YEAR,
         "target": {"type": "string", "enum": ["median", "top_quartile"], "description": "Default median"}},
        ["ccn"]),
    _fn("get_trend", "Get a hospital's KPI trend across all available years, with peer medians and "
        "the change from first to last year.",
        {"ccn": CCN, "kpis": {"type": "array", "items": {"type": "string", "enum": KPI_KEYS},
                              "description": "Optional KPIs; default is six headline KPIs"}}, ["ccn"]),
    _fn("run_scenario", "What-if projection of operating margin when volume, payment rates, operating "
        "expense, or labor cost change. All changes are percentages, e.g. 5 for +5% or -3 for -3%.",
        {"ccn": CCN, "year": YEAR,
         "volume_change_pct": {"type": "number"}, "rate_change_pct": {"type": "number"},
         "opex_change_pct": {"type": "number"}, "labor_cost_change_pct": {"type": "number"}}, ["ccn"]),
    _fn("rank_hospitals", "Rank hospitals on one KPI, optionally filtered by state, facility type, and "
        "minimum beds.",
        {"kpi": {"type": "string", "enum": KPI_KEYS}, "year": YEAR,
         "state": {"type": "string", "description": "2-letter state code"},
         "facility_type": {"type": "string", "description": "STH, CAH, PH, RH, LTCH, or CH"},
         "min_beds": {"type": "integer"}, "top_n": {"type": "integer", "description": "Default 10"},
         "best_first": {"type": "boolean", "description": "true = best performers first (default)"}},
        ["kpi"]),
    _fn("search_documentation", "Search KPI definitions, formulas, benchmarking methodology, and the CMS "
        "data dictionary. Use for 'what does X mean', 'how is X calculated', data caveats.",
        {"query": {"type": "string"}}, ["query"]),
]
TOOL_NAMES = [t["function"]["name"] for t in TOOL_SCHEMAS]


@dataclass
class ToolResult:
    name: str
    args: dict
    ok: bool
    data: Any = None
    llm_view: str = ""
    citations: list[dict] = field(default_factory=list)
    error: str | None = None

    def to_dict(self) -> dict:
        return {"name": self.name, "args": self.args, "ok": self.ok, "error": self.error,
                "citations": self.citations, "data": self.data}


def _j(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"), default=str)


def _view_profile(d: dict) -> dict:
    f = d["financials"]
    from ..analytics.kpis import format_usd
    return {"hospital": f"{d['name']} ({d['ccn']}), {d['city']}, {d['state']}", "year": d["year"],
            "fiscal_period": d["fiscal_period"], "type": d["facility_type"], "ownership": d["ownership"],
            "beds": d["beds"],
            "net_patient_revenue": format_usd(f["net_patient_revenue"]),
            "operating_expense": format_usd(f["operating_expense"]),
            "net_income": format_usd(f["net_income"]), "fte": f["fte"] and round(f["fte"]),
            "discharges": f["discharges"] and round(f["discharges"]),
            "kpis": {KPI_BY_KEY[k].label: v for k, v in d["kpis_formatted"].items() if v != "n/a"},
            "data_quality_flags": d["data_quality_flags"]}


def _view_benchmark(d: dict) -> dict:
    return {"hospital": f"{d['hospital']['name']} ({d['hospital']['ccn']})", "year": d["hospital"]["year"],
            "peer_group": f"{d['peer_group']['definition']} ({d['peer_group']['n_hospitals']} hospitals)",
            "kpis": [{"kpi": r["label"], "value": r["value_fmt"], "peer_median": r["peer_median_fmt"],
                      "percentile": r["percentile"], "status": r["status"]}
                     for r in d["kpis"] if r["value"] is not None]}


def _view_opps(d: dict) -> dict:
    return {"hospital": d["hospital"]["name"], "year": d["hospital"]["year"], "target": d["target"],
            "peer_group": d["peer_group"]["definition"],
            "opportunities": [{"area": o["area"], "current": o["current"], "target": o["target"],
                               "annual_impact": o["annual_impact_fmt"], "type": o["impact_type"],
                               "note": o["assumptions"]} for o in d["opportunities"]],
            "total_recurring_cost_savings": d["total_recurring_cost_savings_fmt"],
            "caveat": d["caveat"]}


def _view_trend(d: dict) -> dict:
    from ..analytics.kpis import format_value
    rows = []
    for p in d["series"]:
        row = {"year": p["year"]}
        for k in d["kpis"]:
            row[KPI_BY_KEY[k].label] = f"{format_value(k, p.get(k))} (peer median {format_value(k, p.get(k + '_peer_median'))})"
        rows.append(row)
    changes = {KPI_BY_KEY[k].label: v["change_fmt"] for k, v in d["change"].items()}
    return {"hospital": d["hospital"]["name"], "by_year": rows, "change_first_to_last_year": changes}


def _view_scenario(d: dict) -> dict:
    from ..analytics.kpis import format_usd
    b, s = d["baseline"], d["scenario"]
    return {"hospital": d["hospital"]["name"], "year": d["hospital"]["year"], "inputs": d["inputs"],
            "baseline": {"revenue": format_usd(b["net_patient_revenue"]), "expense": format_usd(b["operating_expense"]),
                         "operating_margin": b["operating_margin_fmt"]},
            "scenario": {"revenue": format_usd(s["net_patient_revenue"]), "expense": format_usd(s["operating_expense"]),
                         "operating_margin": s["operating_margin_fmt"]},
            "change_in_operating_income": d["delta"]["operating_income_fmt"],
            "change_in_margin_points": round(d["delta"]["operating_margin_pp"], 1)}


def _view_rank(d: dict) -> dict:
    return {"kpi": d["label"], "year": d["year"], "order": d["order"], "filters": d["filters"],
            "hospitals_considered": d["hospitals_considered"],
            "results": [{"rank": r["rank"], "hospital": f"{r['name']} ({r['ccn']})", "state": r["state"],
                         "beds": r["beds"], "value": r["value_fmt"]} for r in d["results"]]}


class ToolExecutor:
    def __init__(self, store: DataStore, retriever: Retriever | None = None):
        self.store = store
        self.retriever = retriever
        self._impl: dict[str, Callable[..., ToolResult]] = {
            "search_hospitals": self._search,
            "get_hospital_profile": self._profile,
            "benchmark_hospital": self._benchmark,
            "find_opportunities": self._opps,
            "get_trend": self._trend,
            "run_scenario": self._scenario,
            "rank_hospitals": self._rank,
            "search_documentation": self._docs,
        }

    def run(self, name: str, args: dict | str | None) -> ToolResult:
        if isinstance(args, str):
            try:
                args = json.loads(args) if args.strip() else {}
            except json.JSONDecodeError:
                args = {}
        args = {k: v for k, v in (args or {}).items() if v not in (None, "", [])}
        if name not in self._impl:
            return ToolResult(name, args, False, error=f"Unknown tool '{name}'. Available: {', '.join(TOOL_NAMES)}",
                              llm_view=_j({"error": f"unknown tool {name}"}))
        try:
            return self._impl[name](**args)
        except bm.NotFoundError as e:
            return ToolResult(name, args, False, error=str(e), llm_view=_j({"error": str(e)}))
        except TypeError as e:
            return ToolResult(name, args, False, error=f"Bad arguments: {e}", llm_view=_j({"error": f"bad arguments: {e}"}))

    # ---- implementations -------------------------------------------------------------------
    @staticmethod
    def _year(year: Any) -> int | None:
        if year is None:
            return None
        try:
            return int(year)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _ccn(ccn: Any) -> str:
        return str(ccn).strip().strip("'\"").zfill(6)

    def _search(self, query: str, state: str | None = None, **_: Any) -> ToolResult:
        hits = self.store.search(str(query), state=state, limit=8)
        args = {"query": query, "state": state}
        view = {"matches": [{"ccn": h["ccn"], "name": h["name"], "city": h["city"], "state": h["state"],
                             "type": h["facility_type"], "beds": h["beds"]} for h in hits]}
        if not hits:
            view["note"] = "No match. Try a shorter name or a city."
        return ToolResult("search_hospitals", args, True, hits, _j(view))

    def _profile(self, ccn: str, year: Any = None, **_: Any) -> ToolResult:
        d = bm.profile(self.store, self._ccn(ccn), self._year(year))
        return ToolResult("get_hospital_profile", {"ccn": ccn, "year": year}, True, d, _j(_view_profile(d)), [d["source"]])

    def _benchmark(self, ccn: str, year: Any = None, peer_dims: list[str] | None = None,
                   kpis: list[str] | None = None, **_: Any) -> ToolResult:
        if isinstance(peer_dims, str):
            peer_dims = [peer_dims]
        if isinstance(kpis, str):
            kpis = [kpis]
        kpis = [k for k in (kpis or []) if k in KPI_BY_KEY] or None
        d = bm.benchmark(self.store, self._ccn(ccn), self._year(year), peer_dims, kpis)
        return ToolResult("benchmark_hospital", {"ccn": ccn, "year": year, "peer_dims": peer_dims, "kpis": kpis},
                          True, d, _j(_view_benchmark(d)), [d["source"]])

    def _opps(self, ccn: str, year: Any = None, target: str = "median", **_: Any) -> ToolResult:
        target = "top_quartile" if "quart" in str(target) else "median"
        d = bm.opportunities(self.store, self._ccn(ccn), self._year(year), target=target)
        return ToolResult("find_opportunities", {"ccn": ccn, "year": year, "target": target}, True, d,
                          _j(_view_opps(d)), [d["source"]])

    def _trend(self, ccn: str, kpis: list[str] | None = None, **_: Any) -> ToolResult:
        if isinstance(kpis, str):
            kpis = [kpis]
        kpis = [k for k in (kpis or []) if k in KPI_BY_KEY] or None
        d = bm.trend(self.store, self._ccn(ccn), kpis)
        return ToolResult("get_trend", {"ccn": ccn, "kpis": kpis}, True, d, _j(_view_trend(d)), [d["source"]])

    def _scenario(self, ccn: str, year: Any = None, volume_change_pct: float = 0, rate_change_pct: float = 0,
                  opex_change_pct: float = 0, labor_cost_change_pct: float = 0, **_: Any) -> ToolResult:
        d = bm.scenario(self.store, self._ccn(ccn), self._year(year), float(volume_change_pct),
                        float(rate_change_pct), float(opex_change_pct), float(labor_cost_change_pct))
        return ToolResult("run_scenario", {"ccn": ccn, "year": year, **d["inputs"]}, True, d,
                          _j(_view_scenario(d)), [d["source"]])

    def _rank(self, kpi: str, year: Any = None, state: str | None = None, facility_type: str | None = None,
              min_beds: int = 0, top_n: int = 10, best_first: bool = True, **_: Any) -> ToolResult:
        d = bm.rank(self.store, kpi, self._year(year), state, facility_type, int(min_beds or 0),
                    min(int(top_n or 10), 25), bool(best_first))
        return ToolResult("rank_hospitals", {"kpi": kpi, "year": year, "state": state, "facility_type": facility_type,
                                             "min_beds": min_beds, "top_n": top_n, "best_first": best_first},
                          True, d, _j(_view_rank(d)), [d["source"]])

    def _docs(self, query: str, **_: Any) -> ToolResult:
        if self.retriever is None:
            return ToolResult("search_documentation", {"query": query}, False, error="Documentation index unavailable",
                              llm_view=_j({"error": "documentation index unavailable"}))
        hits = self.retriever.search(str(query), k=3)
        data = [h.to_dict() for h in hits]
        view = {"passages": [{"ref": f"[{i}]", "title": h["title"], "text": h["text"][:900]}
                             for i, h in enumerate(data, 1)]}
        cites = [{"dataset": h["source"], "title": h["title"], "url": h["url"]} for h in data]
        return ToolResult("search_documentation", {"query": query}, True, data, _j(view), cites)
