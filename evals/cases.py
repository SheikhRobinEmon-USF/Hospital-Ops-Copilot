"""Evaluation cases. Expected answers are computed from the data at run time, so the suite stays
valid when the dataset is rebuilt with newer CMS files."""

from __future__ import annotations

from dataclasses import dataclass, field

from hospital_ops_copilot.analytics import benchmark as bm
from hospital_ops_copilot.analytics.store import DataStore

TGH, MAYO, MGH = "100128", "240010", "220071"


@dataclass
class AgentCase:
    id: str
    question: str
    expected_tools: list[set[str]]  # each set: at least one of these tools must be called
    numbers: list[tuple[float, float]] = field(default_factory=list)  # (expected raw value, abs tolerance)
    keywords: list[str] = field(default_factory=list)  # all must appear (case-insensitive)
    context_ccn: str | None = None
    context_year: int | None = None


def _pct(x: float) -> tuple[float, float]:
    """A percentage KPI: matches when the answer shows it to within 0.15 points."""
    return (x, 0.0015)


def _usd(x: float) -> tuple[float, float]:
    """A dollar amount: matches within 1% to allow $3.44B or $3,444M style rounding."""
    return (x, abs(x) * 0.01)


def agent_cases(store: DataStore) -> list[AgentCase]:
    p23 = bm.profile(store, TGH, 2023)
    p24 = bm.profile(store, TGH, 2024)
    b23 = {r["kpi"]: r for r in bm.benchmark(store, TGH, 2023)["kpis"]}
    mayo = {r["kpi"]: r for r in bm.benchmark(store, MAYO)["kpis"]}
    opp = bm.opportunities(store, MGH)
    scen = bm.scenario(store, TGH, None, volume_change_pct=5, opex_change_pct=-2)
    scen_labor = bm.scenario(store, MAYO, None, labor_cost_change_pct=4)
    tr = bm.trend(store, MGH, ["operating_margin"])
    rank = bm.rank(store, "operating_margin", 2023, state="FL", min_beds=200, top_n=1)["results"][0]
    top_word = max(rank["name"].split(), key=len)
    return [
        AgentCase("profile_margin", "What was Tampa General Hospital's operating margin in 2023?",
                  [{"search_hospitals", "get_hospital_profile", "benchmark_hospital"}],
                  [_pct(p23["kpis"]["operating_margin"])]),
        AgentCase("benchmark_cost", "How does our cost per adjusted discharge compare with peers in 2023?",
                  [{"benchmark_hospital"}],
                  [_usd(b23["opex_per_adj_discharge"]["value"]), _usd(b23["opex_per_adj_discharge"]["peer_median"])], context_ccn=TGH),
        AgentCase("benchmark_alos", "What is our average length of stay and how does it compare to peers?",
                  [{"benchmark_hospital", "get_hospital_profile"}], [(mayo["alos"]["value"], 0.06)],
                  context_ccn=MAYO),
        AgentCase("opportunities", "What are the biggest savings opportunities for Massachusetts General Hospital?",
                  [{"find_opportunities"}],
                  [_usd(opp["total_recurring_cost_savings_usd"])] if opp["total_recurring_cost_savings_usd"] else []),
        AgentCase("scenario", "If volume grows 5% and operating expenses fall 2%, what happens to our operating margin?",
                  [{"run_scenario"}], [_pct(scen["scenario"]["operating_margin"])], context_ccn=TGH),
        AgentCase("trend", "How has our operating margin changed since 2021?", [{"get_trend"}],
                  [_pct(tr["series"][-1]["operating_margin"])], context_ccn=MGH),
        AgentCase("rank", "Which Florida hospital with at least 200 beds had the best operating margin in 2023?",
                  [{"rank_hospitals"}], [_pct(rank["value"])], keywords=[top_word]),
        AgentCase("docs_ar", "How is days in accounts receivable calculated?", [{"search_documentation"}],
                  keywords=["receivable", "net patient revenue"]),
        AgentCase("occupancy", "What is our occupancy rate in 2024?", [{"get_hospital_profile", "benchmark_hospital"}],
                  [_pct(p24["kpis"]["occupancy_rate"])], context_ccn=TGH),
        AgentCase("scenario_labor", "What would a 4% labor cost increase do to our operating margin?", [{"run_scenario"}],
                  [_pct(scen_labor["scenario"]["operating_margin"])], context_ccn=MAYO),
        AgentCase("docs_ccr", "What does the cost-to-charge ratio measure?", [{"search_documentation"}],
                  keywords=["charge"]),
        AgentCase("profile_fte", "How many payroll FTEs did we have in 2023?",
                  [{"get_hospital_profile", "benchmark_hospital"}], [(p23["financials"]["fte"], 1.0)],
                  context_ccn=TGH),
    ]


# Retrieval cases: (query, substring that must appear in a relevant chunk id).
# Retrieval cases: (query, substring that must appear in a relevant chunk's title).
RETRIEVAL_CASES: list[tuple[str, str]] = [
    ("How is operating margin calculated?", "(operating_margin)"),
    ("what counts as total margin including investment income", "(total_margin)"),
    ("cost per adjusted discharge formula", "(opex_per_adj_discharge)"),
    ("revenue per case", "(npr_per_adj_discharge)"),
    ("how much do we rely on agency nurses", "(contract_labor_ratio)"),
    ("staffing intensity per occupied bed", "(fte_per_adj_occupied_bed)"),
    ("how full are our beds", "(occupancy_rate)"),
    ("average length of stay definition", "(alos)"),
    ("markup of list prices over cost", "(cost_to_charge_ratio)"),
    ("payer discounts written off from gross charges", "(contractual_allowance_pct)"),
    ("charity care and bad debt burden", "(uncompensated_care_pct)"),
    ("share of days paid by Medicaid", "(medicaid_day_share)"),
    ("how many days could we operate on our cash", "(days_cash_on_hand)"),
    ("how long does it take to collect from payers", "(days_in_ar)"),
    ("leverage liabilities to assets", "(debt_to_assets)"),
    ("how are peer groups defined", "methodology: Peer groups"),
    ("why is a city hospital labeled rural", "methodology: Urban and rural"),
    ("what happens when a hospital files two cost reports in one year", "methodology: Cleaning rules"),
    ("how are savings opportunities estimated", "methodology: Opportunity sizing"),
    ("what variable cost share does the what-if model assume", "methodology: What-if"),
    ("which worksheet line is net patient revenue on", "dictionary: Net Patient Revenue"),
    ("how does CMS count FTE employees on payroll", "dictionary: FTE - Employees on Payroll"),
    ("type of control codes for proprietary hospitals", "dictionary: Type of Control"),
    ("what is a CMS certification number", "dictionary: Provider CCN"),
    ("where does the cost report data come from HCRIS", "CMS methodology"),
]
