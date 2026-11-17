"""Peer benchmarking, opportunity sizing, trends, rankings, and what-if scenarios.

Everything here is deterministic arithmetic on CMS data. The LLM never computes numbers; it
calls these functions through tools and explains their output.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
import pandas as pd

from .kpis import KPI_BY_KEY, KPIS, format_usd, format_value, ordinal
from .store import SOURCE_NAME, DataStore

PEER_DIMENSIONS = {
    "facility_type": "facility type",
    "bed_band": "bed size",
    "state": "state",
    "ownership": "ownership",
    "urban_rural": "urban/rural",
}
DEFAULT_PEER_DIMS = ("facility_type", "bed_band")
MIN_PEERS = 10
# When a peer group is too small, drop dimensions in this order until it has MIN_PEERS hospitals.
RELAX_ORDER = ("state", "ownership", "urban_rural", "bed_band")


class NotFoundError(LookupError):
    pass


def _clean(v):
    if v is None:
        return None
    if isinstance(v, (np.floating, float)):
        return None if np.isnan(v) else float(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, pd.Timestamp):
        return v.date().isoformat()
    return v


def _row(store: DataStore, ccn: str, year: int | None) -> pd.Series:
    row = store.get(ccn, year)
    if row is None:
        hint = f" for {year}" if year else ""
        raise NotFoundError(f"No cost report found for CCN {ccn}{hint}. Available years: {store.years}")
    return row


def source_citation(row: pd.Series, fields: list[str] | None = None) -> dict:
    return {
        "dataset": SOURCE_NAME,
        "year": int(row["year"]),
        "ccn": row["ccn"],
        "report_id": row.get("report_id"),
        "fiscal_period": f"{_clean(row['fy_begin'])} to {_clean(row['fy_end'])}",
        "fields": fields or [],
    }


def profile(store: DataStore, ccn: str, year: int | None = None) -> dict:
    r = _row(store, ccn, year)
    kpis = {k.key: _clean(r[k.key]) for k in KPIS}
    return {
        "ccn": r["ccn"],
        "name": r["name"],
        "city": r["city"],
        "state": r["state"],
        "year": int(r["year"]),
        "fiscal_period": f"{_clean(r['fy_begin'])} to {_clean(r['fy_end'])}",
        "facility_type": r["facility_type_desc"],
        "provider_type": r["provider_type_desc"],
        "ownership": f"{r['ownership']} ({r['control_desc']})",
        "urban_rural": r["urban_rural"],
        "beds": _clean(r["beds"]),
        "bed_band": r["bed_band"],
        "full_year_report": bool(r["full_year"]),
        "financials": {
            "net_patient_revenue": _clean(r["net_patient_revenue"]),
            "operating_expense": _clean(r["operating_expense"]),
            "net_income": _clean(r["net_income"]),
            "total_assets": _clean(r["total_assets"]),
            "fte": _clean(r["fte"]),
            "discharges": _clean(r["discharges"]),
            "adjusted_discharges": _clean(r["adj_discharges"]),
            "patient_days": _clean(r["total_days"]),
        },
        "kpis": kpis,
        "kpis_formatted": {k: format_value(k, v) for k, v in kpis.items()},
        "data_quality_flags": [f for f in str(r["dq_flags"]).split(",") if f],
        "source": source_citation(r, ["Net Patient Revenue", "Less Total Operating Expense", "Net Income"]),
    }


@dataclass
class PeerGroup:
    dims: dict[str, str]
    requested_dims: list[str]
    relaxed: list[str]
    frame: pd.DataFrame = field(repr=False)

    @property
    def n(self) -> int:
        return len(self.frame)

    def describe(self) -> str:
        parts = [f"{PEER_DIMENSIONS[d]} = {v}" for d, v in self.dims.items()]
        return ", ".join(parts) if parts else "all hospitals"


def peer_group(store: DataStore, row: pd.Series, dims: list[str] | tuple[str, ...] | None = None,
               min_peers: int = MIN_PEERS) -> PeerGroup:
    requested = [d for d in (dims or DEFAULT_PEER_DIMS) if d in PEER_DIMENSIONS]
    active = list(requested)
    year_df = store.df[(store.df["year"] == row["year"]) & store.df["full_year"] & (store.df["ccn"] != row["ccn"])]
    relaxed: list[str] = []
    while True:
        mask = pd.Series(True, index=year_df.index)
        for d in active:
            mask &= year_df[d] == row[d]
        frame = year_df[mask]
        if len(frame) >= min_peers or not active:
            break
        drop = next((d for d in RELAX_ORDER if d in active), active[-1])
        active.remove(drop)
        relaxed.append(drop)
    return PeerGroup({d: str(row[d]) for d in active}, requested, relaxed, frame)


def _status(kpi_key: str, value: float | None, p25: float | None, p75: float | None) -> str:
    if value is None or p25 is None or p75 is None:
        return "insufficient data"
    k = KPI_BY_KEY[kpi_key]
    if p25 <= value <= p75:
        return "in line with peers"
    above = value > p75
    if k.direction is None:
        return "above peer range" if above else "below peer range"
    good = above if k.direction == "higher" else not above
    return "better than peers" if good else "worse than peers"


def benchmark(store: DataStore, ccn: str, year: int | None = None, peer_dims: list[str] | None = None,
              kpis: list[str] | None = None) -> dict:
    r = _row(store, ccn, year)
    pg = peer_group(store, r, peer_dims)
    rows = []
    for key in kpis or [k.key for k in KPIS]:
        if key not in KPI_BY_KEY:
            continue
        k = KPI_BY_KEY[key]
        value = _clean(r[key])
        peers = pg.frame[key].dropna()
        if len(peers) >= 3:
            p25, med, p75 = (float(x) for x in np.percentile(peers, [25, 50, 75]))
            pct = float((peers < value).mean() * 100 + (peers == value).mean() * 50) if value is not None else None
        else:
            p25 = med = p75 = pct = None
        rows.append({
            "kpi": key,
            "label": k.label,
            "category": k.category,
            "value": value,
            "value_fmt": format_value(key, value),
            "peer_median": med,
            "peer_median_fmt": format_value(key, med),
            "peer_p25": p25,
            "peer_p75": p75,
            "peer_range_fmt": f"{format_value(key, p25)} to {format_value(key, p75)}",
            "percentile": None if pct is None else round(pct, 1),
            "peers_with_data": int(len(peers)),
            "direction": k.direction,
            "status": _status(key, value, p25, p75),
        })
    return {
        "hospital": {"ccn": r["ccn"], "name": r["name"], "state": r["state"], "year": int(r["year"]),
                     "beds": _clean(r["beds"]), "facility_type": r["facility_type_desc"]},
        "peer_group": {"definition": pg.describe(), "n_hospitals": pg.n, "requested": pg.requested_dims,
                       "relaxed_dimensions": pg.relaxed,
                       "note": "Peers are other hospitals with full-year reports in the same year."},
        "kpis": rows,
        "source": source_citation(r, sorted({f for key in (kpis or [k.key for k in KPIS]) if key in KPI_BY_KEY
                                             for f in KPI_BY_KEY[key].fields})),
    }


@dataclass
class Opportunity:
    area: str
    kpi: str
    current: str
    target: str
    annual_impact_usd: float | None
    impact_type: str
    formula: str
    assumptions: str

    def to_dict(self) -> dict:
        d = asdict(self)
        d["annual_impact_fmt"] = format_usd(self.annual_impact_usd) if self.annual_impact_usd is not None else "n/a"
        return d


def opportunities(store: DataStore, ccn: str, year: int | None = None, peer_dims: list[str] | None = None,
                  target: str = "median", contract_premium: float = 0.25) -> dict:
    """Size the gap to a peer target (median or top quartile) in dollars, KPI by KPI."""
    r = _row(store, ccn, year)
    pg = peer_group(store, r, peer_dims)
    q = 50 if target == "median" else 25  # 25 -> top quartile for "lower is better" metrics

    def tgt(key: str, higher_better: bool = False) -> float | None:
        s = pg.frame[key].dropna()
        if len(s) < 3:
            return None
        return float(np.percentile(s, 100 - q if higher_better else q))

    period = float(r["period_days"]) if r["period_days"] == r["period_days"] else 365.0
    annualize = 365.0 / period if period > 0 else 1.0
    out: list[Opportunity] = []

    v, t = _clean(r["opex_per_adj_discharge"]), tgt("opex_per_adj_discharge")
    adj = _clean(r["adj_discharges"])
    if v and t and adj and v > t:
        out.append(Opportunity(
            "Unit cost", "opex_per_adj_discharge", format_value("opex_per_adj_discharge", v),
            format_value("opex_per_adj_discharge", t), (v - t) * adj * annualize, "cost savings",
            "(current - target cost per adjusted discharge) x adjusted discharges",
            "Volume held constant. Some gap may reflect case mix, teaching, or service lines that peers lack."))

    v, t = _clean(r["fte_per_adj_occupied_bed"]), tgt("fte_per_adj_occupied_bed")
    fte, sal = _clean(r["fte"]), _clean(r["salaries"])
    if v and t and fte and sal and v > t:
        excess_fte = fte * (1 - t / v)
        out.append(Opportunity(
            "Staffing productivity", "fte_per_adj_occupied_bed", format_value("fte_per_adj_occupied_bed", v),
            format_value("fte_per_adj_occupied_bed", t), excess_fte * (sal / fte) * annualize, "cost savings",
            "FTEs above target x average salary per FTE (Total Salaries / FTEs)",
            f"About {excess_fte:,.0f} FTEs above target. Achieved over time through attrition and scheduling, "
            "not layoffs. Excludes benefits."))

    v, t = _clean(r["contract_labor_ratio"]), tgt("contract_labor_ratio")
    if v is not None and t is not None and sal and v > t:
        excess = (v - t) * sal
        out.append(Opportunity(
            "Contract labor", "contract_labor_ratio", format_value("contract_labor_ratio", v),
            format_value("contract_labor_ratio", t), excess * contract_premium * annualize, "cost savings",
            f"(current - target ratio) x salaries x {contract_premium:.0%} contract premium",
            f"Assumes converting excess contract labor to employed staff saves {contract_premium:.0%} of that spend."))

    v, t = _clean(r["days_in_ar"]), tgt("days_in_ar")
    npr = _clean(r["net_patient_revenue"])
    if v and t and npr and v > t:
        out.append(Opportunity(
            "Revenue cycle", "days_in_ar", format_value("days_in_ar", v), format_value("days_in_ar", t),
            (v - t) * npr / period, "one-time cash release",
            "(current - target days in A/R) x daily net patient revenue",
            "A one-time working capital improvement, not recurring profit."))

    v, t = _clean(r["alos"]), tgt("alos")
    ap_dis = _clean(r["ap_discharges"])
    if v and t and ap_dis and v > t:
        freed_days = (v - t) * ap_dis
        out.append(Opportunity(
            "Length of stay", "alos", format_value("alos", v), format_value("alos", t), None, "capacity",
            "(current - target ALOS) x discharges = bed days freed",
            f"Frees about {freed_days * annualize:,.0f} bed days a year (about {freed_days / period:,.1f} staffed beds). "
            "Not case-mix adjusted; value depends on whether freed beds are refilled."))

    v, t = _clean(r["npr_per_adj_discharge"]), tgt("npr_per_adj_discharge", higher_better=True)
    if v and t and adj and v < t:
        out.append(Opportunity(
            "Revenue yield", "npr_per_adj_discharge", format_value("npr_per_adj_discharge", v),
            format_value("npr_per_adj_discharge", t), (t - v) * adj * annualize, "revenue upside",
            "(target - current net revenue per adjusted discharge) x adjusted discharges",
            "Largely driven by payer mix and contracts. Treat as an upper bound."))

    items = sorted((o.to_dict() for o in out), key=lambda d: -(d["annual_impact_usd"] or 0))
    # Staffing and contract labor gaps are components of the unit-cost gap, so they are not added to it.
    by_area = {o["area"]: o["annual_impact_usd"] or 0 for o in items}
    labor = by_area.get("Staffing productivity", 0) + by_area.get("Contract labor", 0)
    recurring = max(by_area.get("Unit cost", 0), labor)
    return {
        "hospital": {"ccn": r["ccn"], "name": r["name"], "year": int(r["year"])},
        "target": "peer median" if target == "median" else "peer top quartile",
        "peer_group": {"definition": pg.describe(), "n_hospitals": pg.n},
        "opportunities": items,
        "total_recurring_cost_savings_usd": recurring,
        "total_recurring_cost_savings_fmt": format_usd(recurring),
        "total_note": "Recurring cost savings = the larger of the unit-cost gap and the labor gaps, because "
                      "labor gaps are part of unit cost. Cash release and revenue upside are reported separately.",
        "caveat": "Benchmarks show where to look, not what to cut. Validate each gap against case mix and "
                  "service mix before setting targets.",
        "source": source_citation(r, ["Less Total Operating Expense", "FTE - Employees on Payroll",
                                      "Total Salaries From Worksheet A", "Contract Labor: Direct Patient Care",
                                      "Accounts Receivable", "Net Patient Revenue"]),
    }


def trend(store: DataStore, ccn: str, kpis: list[str] | None = None, peer_dims: list[str] | None = None) -> dict:
    hist = store.history(ccn)
    if hist.empty:
        raise NotFoundError(f"No cost reports found for CCN {ccn}.")
    keys = [k for k in (kpis or ["operating_margin", "opex_per_adj_discharge", "npr_per_adj_discharge",
                                  "occupancy_rate", "alos", "fte_per_adj_occupied_bed"]) if k in KPI_BY_KEY]
    series = []
    for _, r in hist.iterrows():
        pg = peer_group(store, r, peer_dims)
        point = {"year": int(r["year"]), "full_year_report": bool(r["full_year"])}
        for k in keys:
            point[k] = _clean(r[k])
            med = pg.frame[k].median()
            point[f"{k}_peer_median"] = _clean(med)
        series.append(point)
    changes = {}
    first, last = series[0], series[-1]
    for k in keys:
        a, b = first.get(k), last.get(k)
        if a is not None and b is not None and first["year"] != last["year"]:
            unit = KPI_BY_KEY[k].unit
            delta = b - a
            changes[k] = {
                "from_year": first["year"], "to_year": last["year"], "from": a, "to": b, "change": delta,
                "change_fmt": (f"{delta * 100:+.1f} percentage points" if unit == "pct"
                               else f"{(delta / a * 100 if a else 0):+.1f}%"),
            }
    r0 = hist.iloc[-1]
    return {"hospital": {"ccn": r0["ccn"], "name": r0["name"]}, "kpis": keys, "series": series,
            "change": changes, "source": source_citation(r0, sorted({f for k in keys for f in KPI_BY_KEY[k].fields}))}


def scenario(store: DataStore, ccn: str, year: int | None = None, volume_change_pct: float = 0.0,
             rate_change_pct: float = 0.0, opex_change_pct: float = 0.0, labor_cost_change_pct: float = 0.0,
             variable_cost_share: float = 0.35) -> dict:
    """Transparent what-if on the operating margin.

    revenue  = NPR x (1 + volume) x (1 + rate)
    expense  = OpEx + OpEx x variable_share x volume + salaries x labor_change + OpEx x opex_change
    """
    r = _row(store, ccn, year)
    npr, opex, sal = _clean(r["net_patient_revenue"]), _clean(r["operating_expense"]), _clean(r["salaries"]) or 0.0
    if not npr or not opex:
        raise NotFoundError("Net patient revenue or operating expense is missing for this report.")
    vol, rate, oc, lc = (x / 100.0 for x in (volume_change_pct, rate_change_pct, opex_change_pct, labor_cost_change_pct))
    new_rev = npr * (1 + vol) * (1 + rate)
    new_opex = opex + opex * variable_cost_share * vol + sal * lc + opex * oc
    base_margin = (npr - opex) / npr
    new_margin = (new_rev - new_opex) / new_rev
    return {
        "hospital": {"ccn": r["ccn"], "name": r["name"], "year": int(r["year"])},
        "inputs": {"volume_change_pct": volume_change_pct, "rate_change_pct": rate_change_pct,
                   "opex_change_pct": opex_change_pct, "labor_cost_change_pct": labor_cost_change_pct,
                   "variable_cost_share": variable_cost_share},
        "baseline": {"net_patient_revenue": npr, "operating_expense": opex, "operating_income": npr - opex,
                     "operating_margin": base_margin, "operating_margin_fmt": format_value("operating_margin", base_margin)},
        "scenario": {"net_patient_revenue": new_rev, "operating_expense": new_opex,
                     "operating_income": new_rev - new_opex, "operating_margin": new_margin,
                     "operating_margin_fmt": format_value("operating_margin", new_margin)},
        "delta": {"operating_income": (new_rev - new_opex) - (npr - opex),
                  "operating_income_fmt": format_usd((new_rev - new_opex) - (npr - opex)),
                  "operating_margin_pp": (new_margin - base_margin) * 100},
        "formula": "revenue = NPR x (1 + volume) x (1 + rate); expense = OpEx x (1 + variable_share x volume + "
                   "opex_change) + salaries x labor_change",
        "source": source_citation(r, ["Net Patient Revenue", "Less Total Operating Expense",
                                      "Total Salaries From Worksheet A"]),
    }


def rank(store: DataStore, kpi: str, year: int | None = None, state: str | None = None,
         facility_type: str | None = None, min_beds: int = 0, top_n: int = 10, best_first: bool = True) -> dict:
    if kpi not in KPI_BY_KEY:
        raise NotFoundError(f"Unknown KPI '{kpi}'. Options: {', '.join(KPI_BY_KEY)}")
    k = KPI_BY_KEY[kpi]
    year = int(year or store.latest_year)
    where = ["year = ?", "full_year", f"{kpi} IS NOT NULL", "coalesce(beds, 0) >= ?"]
    params: list = [year, min_beds]
    if state:
        where.append("state = ?")
        params.append(state.upper())
    if facility_type:
        where.append("facility_type = ?")
        params.append(facility_type.upper())
    ascending = (k.direction == "lower") == best_first if k.direction else not best_first
    order = "ASC" if ascending else "DESC"
    q = (f"SELECT ccn, name, city, state, facility_type, beds, {kpi} AS value FROM hospital_year "
         f"WHERE {' AND '.join(where)} ORDER BY value {order}, ccn ASC LIMIT ?")
    df = store.sql(q, params + [int(top_n)])
    n = store.sql(f"SELECT count(*) AS n FROM hospital_year WHERE {' AND '.join(where)}", params)["n"].iloc[0]
    rows = df.to_dict("records")
    for i, row in enumerate(rows, 1):
        row["rank"] = i
        row["value_fmt"] = format_value(kpi, row["value"])
        row["beds"] = _clean(row["beds"])
    return {"kpi": kpi, "label": k.label, "year": year, "order": "best first" if best_first else "worst first",
            "filters": {"state": state, "facility_type": facility_type, "min_beds": min_beds},
            "hospitals_considered": int(n), "results": rows,
            "source": {"dataset": SOURCE_NAME, "year": year, "fields": list(k.fields)}}


def insights(store: DataStore, ccn: str, year: int | None = None, peer_dims: list[str] | None = None) -> dict:
    """Proactive, deterministic highlights: biggest strengths, risks, and the top sized opportunity."""
    b = benchmark(store, ccn, year, peer_dims)
    o = opportunities(store, ccn, year, peer_dims)
    directional = [r for r in b["kpis"] if r["percentile"] is not None and r["direction"]]

    def goodness(r: dict) -> float:
        return r["percentile"] if r["direction"] == "higher" else 100 - r["percentile"]

    items = []
    for r in sorted((r for r in directional if r["status"] == "worse than peers"), key=goodness)[:3]:
        items.append({"kind": "risk", "kpi": r["kpi"], "title": f"{r['label']} trails peers",
                      "detail": f"{r['value_fmt']} vs peer median {r['peer_median_fmt']} ({ordinal(r['percentile'])} percentile).",
                      "ask": f"Why is our {r['label'].lower()} worse than peers, and what would closing the gap be worth?"})
    for r in sorted((r for r in directional if r["status"] == "better than peers"), key=goodness, reverse=True)[:2]:
        items.append({"kind": "strength", "kpi": r["kpi"], "title": f"{r['label']} leads peers",
                      "detail": f"{r['value_fmt']} vs peer median {r['peer_median_fmt']} ({ordinal(r['percentile'])} percentile).",
                      "ask": f"How has our {r['label'].lower()} trended over time?"})
    sized = [x for x in o["opportunities"] if x["annual_impact_usd"]]
    if sized:
        top = sized[0]
        items.insert(0, {"kind": "opportunity", "kpi": top["kpi"], "title": f"{top['area']}: {top['annual_impact_fmt']}",
                         "detail": f"{top['current']} vs target {top['target']} ({top['impact_type']}).",
                         "ask": "What are our biggest savings opportunities?"})
    return {"hospital": b["hospital"], "peer_group": b["peer_group"], "insights": items}
