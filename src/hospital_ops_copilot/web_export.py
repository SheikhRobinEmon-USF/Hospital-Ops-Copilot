"""Export data for the in-browser engine (public demo on GitHub Pages) and parity fixtures.

The public demo runs the analytics and the offline analyst in the visitor's browser, ported to
TypeScript in ``web/src/engine``. Python stays the source of truth:

1. ``export_dataset`` writes a compact, fixed-point columnar JSON of the hospital-year table.
2. ``load_export`` reads it back into a DataFrame, so Python can compute results on exactly the data
   the browser sees.
3. ``build_fixtures`` runs the Python analytics and offline analyst on that data and records inputs
   and outputs; the TypeScript test suite must reproduce them.
4. ``build_snapshot`` precomputes the default first view so the public page paints without waiting
   for the full dataset.
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path
from typing import Any

import pandas as pd

from . import __version__
from .analytics import benchmark as bm
from .analytics.kpis import KPIS
from .analytics.store import DataStore
from .rag.corpus import build_corpus
from .rag.index import Retriever

FORMAT_VERSION = 1
UNIT_SCALE = {"pct": 100_000, "usd": 100, "days": 1_000, "ratio": 10_000, "count": 1}
NUMERIC: dict[str, int] = {
    "year": 1, "beds": 1, "period_days": 1, "full_year": 1,
    "net_patient_revenue": 1, "operating_expense": 1, "net_income": 1, "total_assets": 1, "salaries": 1,
    "fte": 100, "discharges": 1, "adj_discharges": 100, "total_days": 1, "ap_discharges": 1,
    **{k.key: UNIT_SCALE[k.unit] for k in KPIS},
}
TEXT = ["ccn", "name", "city", "state", "facility_type", "facility_type_desc", "provider_type_desc", "control_desc",
        "ownership", "urban_rural", "bed_band", "report_id", "dq_flags", "fy_begin", "fy_end"]
DEFAULT_CCN = "100128"
DEFAULT_DIMS = list(bm.DEFAULT_PEER_DIMS)
HEADLINE = ["operating_margin", "total_margin", "opex_per_adj_discharge", "npr_per_adj_discharge",
            "fte_per_adj_occupied_bed", "occupancy_rate", "alos", "days_in_ar"]


def _json(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def export_dataset(df: pd.DataFrame) -> dict:
    df = df.sort_values(["ccn", "year"], kind="mergesort").reset_index(drop=True)
    cols: dict[str, Any] = {}
    for c, scale in NUMERIC.items():
        vals = df[c].astype(float).tolist()
        cols[c] = [None if (v != v) else int(round(v * scale)) for v in vals]
    for c in TEXT:
        s = df[c]
        if c in ("fy_begin", "fy_end"):
            s = pd.to_datetime(s).dt.strftime("%Y-%m-%d")
        vals = s.fillna("").astype(str).tolist()
        uniq = sorted(set(vals))
        index = {u: i for i, u in enumerate(uniq)}
        cols[c] = {"dict": uniq, "idx": [index[v] for v in vals]}
    return {"version": FORMAT_VERSION, "rows": len(df), "scale": NUMERIC, "columns": cols}


def load_export(data: dict) -> pd.DataFrame:
    """Rebuild the hospital-year table from the export (values exactly as the browser decodes them)."""
    out: dict[str, Any] = {}
    for c, scale in data["scale"].items():
        out[c] = [math.nan if v is None else v / scale for v in data["columns"][c]]
    for c in TEXT:
        col = data["columns"][c]
        out[c] = [col["dict"][i] for i in col["idx"]]
    df = pd.DataFrame(out)
    df["year"] = df["year"].astype(int)
    df["full_year"] = df["full_year"] == 1
    return df


def kpi_catalogue() -> list[dict]:
    return [{"key": k.key, "label": k.label, "category": k.category, "unit": k.unit, "direction": k.direction,
             "formula": k.formula, "fields": list(k.fields), "description": k.description} for k in KPIS]


def corpus_json() -> list[dict]:
    return [c.to_dict() for c in build_corpus()]


def _profile(store: DataStore, ccn: str, year: int | None) -> dict:
    d = dict(bm.profile(store, ccn, year))
    d["available_years"] = [int(y) for y in store.history(d["ccn"])["year"]]
    return d


def health(store: DataStore) -> dict:
    return {"status": "ok", "version": __version__, "years": store.years, "hospitals": int(store.df["ccn"].nunique()),
            "llm_backend": "offline", "chat_model": "", "embed_model": "", "ollama_available": False}


def snapshot_key(*parts: Any) -> str:
    """Request key shared with web/src/engine/index.ts (keep in sync)."""
    return "|".join("" if p is None else ",".join(p) if isinstance(p, list) else str(p) for p in parts)


def build_snapshot(store: DataStore) -> dict:
    ccn = DEFAULT_CCN
    return {
        snapshot_key("health"): health(store),
        snapshot_key("kpis"): kpi_catalogue(),
        snapshot_key("profile", ccn, None): _profile(store, ccn, None),
        snapshot_key("benchmark", ccn, None, DEFAULT_DIMS): bm.benchmark(store, ccn, None, DEFAULT_DIMS),
        snapshot_key("insights", ccn, None, DEFAULT_DIMS): bm.insights(store, ccn, None, DEFAULT_DIMS),
        snapshot_key("trend", ccn, HEADLINE, DEFAULT_DIMS): bm.trend(store, ccn, HEADLINE, DEFAULT_DIMS),
    }


QUESTIONS: list[tuple[str, str | None]] = [
    ("How do we compare to our peers?", "100128"),
    ("What are our biggest savings opportunities?", "100128"),
    ("What are our savings opportunities against the top quartile?", "240010"),
    ("How has our operating margin changed over time?", "220071"),
    ("How has our length of stay trended?", "100128"),
    ("What if volume grows 5% and labor costs rise 3%?", "100128"),
    ("What would a 4% labor cost increase do to our operating margin?", "240010"),
    ("What if we cut operating expenses 2%?", "220071"),
    ("How many payroll FTEs did we have in 2023?", "100128"),
    ("How does Tampa General Hospital compare to its peers in 2023?", None),
    ("What are the biggest savings opportunities for Massachusetts General Hospital?", None),
    ("Which Florida hospital with at least 200 beds had the best operating margin in 2023?", None),
    ("Top hospitals by days in accounts receivable in TX", None),
    ("Worst operating margin hospitals in California", None),
    ("How is days in accounts receivable calculated?", None),
    ("What does the cost-to-charge ratio measure?", None),
    ("How are peer groups defined?", None),
    ("Why is a city hospital labeled rural?", None),
    ("How does our occupancy rate compare?", "240010"),
    ("Tell me about hospital 330125", None),
    ("How do we compare?", None),
]


def _final(store: DataStore, retriever: Retriever, question: str, ccn: str | None) -> dict:
    from .llm.agent import Copilot

    c = Copilot(store=store, retriever=retriever, model="none")
    final = [e for e in c.stream(question, context_ccn=ccn, force_offline=True) if e["type"] == "final"][0]
    final.pop("latency_s", None)
    final["notes"] = []
    return json.loads(_json(final))


def build_fixtures(store: DataStore, seed: int = 7, n_random: int = 30) -> dict:
    rng = random.Random(seed)
    ccns = sorted(store.df["ccn"].unique())
    picks = [DEFAULT_CCN, "240010", "220071", "330125", "050373"] + rng.sample(ccns, n_random)
    dims_variants = [DEFAULT_DIMS, ["facility_type", "bed_band", "state"], ["facility_type", "ownership", "urban_rural", "state"],
                     ["state"]]
    cases: list[dict] = []

    def add(fn: str, args: dict, func):
        try:
            expected: Any = func()
            error = None
        except bm.NotFoundError as e:
            expected, error = None, str(e)
        cases.append({"fn": fn, "args": args, "expected": json.loads(_json(expected)) if expected is not None else None,
                      "error": error})

    for i, ccn in enumerate(picks):
        years = [None] + [int(y) for y in store.history(ccn)["year"]][:2]
        for year in years:
            add("profile", {"ccn": ccn, "year": year}, lambda c=ccn, y=year: _profile(store, c, y))
            dims = dims_variants[(i + (year or 0)) % len(dims_variants)]
            add("benchmark", {"ccn": ccn, "year": year, "peerDims": dims}, lambda c=ccn, y=year, d=dims: bm.benchmark(store, c, y, d))
            add("insights", {"ccn": ccn, "year": year, "peerDims": dims}, lambda c=ccn, y=year, d=dims: bm.insights(store, c, y, d))
            for target in ("median", "top_quartile"):
                add("opportunities", {"ccn": ccn, "year": year, "peerDims": dims, "target": target},
                    lambda c=ccn, y=year, d=dims, t=target: bm.opportunities(store, c, y, d, target=t))
        add("trend", {"ccn": ccn, "kpis": HEADLINE, "peerDims": DEFAULT_DIMS}, lambda c=ccn: bm.trend(store, c, HEADLINE, DEFAULT_DIMS))
        lever = {"volume_change_pct": rng.choice([0, 5, -3.5]), "rate_change_pct": rng.choice([0, 2]),
                 "opex_change_pct": rng.choice([0, -2]), "labor_cost_change_pct": rng.choice([0, 4]),
                 "variable_cost_share": rng.choice([0.35, 0.5])}
        add("scenario", {"ccn": ccn, "year": None, **lever}, lambda c=ccn, lv=lever: bm.scenario(store, c, None, **lv))
    add("profile", {"ccn": "999999", "year": None}, lambda: _profile(store, "999999", None))

    for kpi, kw in [("operating_margin", {"state": "FL", "min_beds": 200, "year": 2023}),
                    ("opex_per_adj_discharge", {"facility_type": "STH", "min_beds": 100}),
                    ("days_in_ar", {"state": "TX", "best_first": False}),
                    ("occupancy_rate", {"facility_type": "CAH", "top_n": 25}),
                    ("alos", {"state": "MN", "facility_type": "STH", "min_beds": 25, "year": 2022}),
                    ("medicaid_day_share", {})]:
        args = {"kpi": kpi, "year": None, "state": None, "facility_type": None, "min_beds": 0, "top_n": 10, "best_first": True, **kw}
        add("rank", args, lambda a=args: bm.rank(store, a["kpi"], a["year"], a["state"], a["facility_type"], a["min_beds"],
                                                 a["top_n"], a["best_first"]))

    for q, st in [("tampa general", None), ("mayo rochester", None), ("100128", None), ("general", "FL"),
                  ("tampa genral hosptal", None), ("st lucie", None), ("children", "TX"), ("zzqx", None)]:
        add("search", {"q": q, "state": st}, lambda q=q, st=st: store.search(q, state=st, limit=12))

    retriever = Retriever(chunks=build_corpus(), mode="bm25")
    for q in ["how is days cash on hand calculated", "peer groups", "net patient revenue worksheet line", "how full are our beds"]:
        add("docs", {"query": q}, lambda q=q: [h.to_dict() for h in retriever.search(q, k=3)])
    for q, ccn in QUESTIONS:
        add("ask", {"question": q, "ccn": ccn}, lambda q=q, c=ccn: _final(store, retriever, q, c))
    return {"version": FORMAT_VERSION, "cases": cases}


def export_web(out_dir: Path, source_df: pd.DataFrame, fixtures_path: Path | None = None) -> dict:
    """Write dataset, KPI catalogue, corpus, and snapshot into ``out_dir`` (and fixtures if asked)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    data = export_dataset(source_df)
    (out_dir / "hospitals.json").write_text(_json(data))
    store = DataStore(df=load_export(data))
    (out_dir / "kpis.json").write_text(_json(kpi_catalogue()))
    (out_dir / "corpus.json").write_text(_json(corpus_json()))
    (out_dir / "snapshot.json").write_text(_json(build_snapshot(store)))
    summary = {"rows": data["rows"], "files": sorted(p.name for p in out_dir.glob("*.json"))}
    if fixtures_path:
        fixtures_path.parent.mkdir(parents=True, exist_ok=True)
        fx = build_fixtures(store)
        fixtures_path.write_text(_json(fx))
        summary["fixtures"] = len(fx["cases"])
    return summary
