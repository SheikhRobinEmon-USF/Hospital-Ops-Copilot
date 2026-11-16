"""Offline analyst: keyword intent routing plus templated narratives, with no LLM.

Used when Ollama is not running (for example on a hosted demo), in tests, and as the baseline in
evals. It calls the same tools as the LLM agent, so its numbers are identical; only the wording is
fixed.
"""

from __future__ import annotations

import re
import time

from ..analytics.kpis import KPI_BY_KEY, KPIS
from ..analytics.store import DataStore
from . import grounding
from .answer import AgentAnswer
from .tools import ToolExecutor, ToolResult

_KPI_SYNONYMS: dict[str, list[str]] = {
    "operating_margin": ["operating margin", "margin", "profitab"],
    "total_margin": ["total margin", "net margin", "bottom line"],
    "opex_per_adj_discharge": ["cost per", "unit cost", "expense per", "cost per case", "cost per discharge"],
    "npr_per_adj_discharge": ["revenue per", "yield", "net revenue per"],
    "labor_cost_share": ["salary share", "labor cost", "salary cost"],
    "contract_labor_ratio": ["contract labor", "agency", "travel nurse"],
    "fte_per_adj_occupied_bed": ["fte", "staffing", "productivity", "headcount"],
    "occupancy_rate": ["occupancy", "bed utilization", "utilization"],
    "alos": ["length of stay", "alos", "los"],
    "cost_to_charge_ratio": ["cost-to-charge", "cost to charge", "ccr", "markup"],
    "contractual_allowance_pct": ["contractual allowance", "discount", "write-off", "write off"],
    "uncompensated_care_pct": ["uncompensated", "charity", "bad debt"],
    "medicare_day_share": ["medicare"],
    "medicaid_day_share": ["medicaid"],
    "outpatient_revenue_share": ["outpatient"],
    "days_cash_on_hand": ["cash on hand", "days cash", "liquidity"],
    "current_ratio": ["current ratio"],
    "days_in_ar": ["a/r", "accounts receivable", "days in ar", "collections", "revenue cycle"],
    "debt_to_assets": ["leverage", "debt", "liabilities"],
}

STATE_NAMES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA", "colorado": "CO",
    "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA",
    "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
    "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
    "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",
    "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", "tennessee": "TN", "texas": "TX",
    "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY", "puerto rico": "PR",
}

STATES = set(["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "PR", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "GU", "VI"])


def detect_state(text: str, allow_names: bool = True) -> str | None:
    code = next((w for w in re.findall(r"\b[A-Z]{2}\b", text) if w in STATES), None)
    if code or not allow_names:
        return code
    t = text.lower()
    for name in sorted(STATE_NAMES, key=len, reverse=True):
        if re.search(rf"\b{name}\b", t):
            return STATE_NAMES[name]
    return None


def detect_min_beds(text: str) -> int | None:
    m = re.search(r"(\d{2,4})\+?\s*(?:or more\s*)?beds", text.lower())
    return int(m.group(1)) if m else None


def detect_kpi(text: str) -> str | None:
    t = text.lower()
    for key in KPI_BY_KEY:
        if key in t:
            return key
    best, best_len = None, 0
    for key, words in _KPI_SYNONYMS.items():
        for w in words:
            if w in t and len(w) > best_len:
                best, best_len = key, len(w)
    return best


def detect_intent(q: str) -> str:
    t = q.lower()
    if re.search(r"\b(what does|what is|define|definition|meaning|how is .* (calculated|computed|measured)|formula|methodology|how do you)\b", t) \
            and not re.search(r"\b(our|we|this hospital|\d{6})\b", t):
        return "docs"
    if re.search(r"what if|scenario|if (we|our|volume|rates?|costs?|expenses?|labor)|simulate|project(ion)?|"
                 r"what would|would happen|impact of|effect of", t) and re.search(r"\d", t):
        return "scenario"
    if re.search(r"\b(rank|top \d+|top|best|worst|leaderboard|highest|lowest)\b", t) and not re.search(r"\b(our|we|\d{6})\b", t):
        return "rank"
    if re.search(r"trend|over time|since|history|changed|year over year|yoy|trajectory", t):
        return "trend"
    if re.search(r"opportunit|sav(e|ing)|cut|reduce cost|improve|where (can|should)|gap", t):
        return "opportunities"
    if re.search(r"profile|overview|tell me about|who is|basic|how many|how much|what (was|is) (our|the) "
                 r"(net|total|revenue|income|fte|bed)", t) and not re.search(r"compar|peer|benchmark", t):
        return "profile"
    return "benchmark"


def _pcts(q: str) -> dict[str, float]:
    """Parse what-if levers like 'volume +5%', 'cut costs 3%', 'labor costs rise 4%'."""
    t = q.lower()
    out: dict[str, float] = {}
    patterns = {
        "volume_change_pct": r"(volume|discharges|admissions|patients)",
        "rate_change_pct": r"(rates?|prices?|reimbursement|payments?)",
        "labor_cost_change_pct": r"(labor|wages?|salar(y|ies))",
        "opex_change_pct": r"(costs?|expenses?|opex|spending)",
    }
    for key, noun in patterns.items():
        m = re.search(noun + r"[^.%\d]{0,30}?(?P<v>[-+]?\d+(?:\.\d+)?)\s?%", t) or \
            re.search(r"(?P<v>[-+]?\d+(?:\.\d+)?)\s?%[^.%\d]{0,25}?" + noun, t)
        if m:
            v = float(m.group("v"))
            window = t[max(0, m.start() - 8):m.end()]
            if re.search(r"(cut|reduc|lower|decreas|drop|fall|declin|less)", window) and v > 0:
                v = -v
            out[key] = v
            t = t[:m.start()] + " " * (m.end() - m.start()) + t[m.end():]
    if "labor_cost_change_pct" in out and "opex_change_pct" in out and out["labor_cost_change_pct"] == out["opex_change_pct"]:
        del out["opex_change_pct"]
    return out


def _n(v: float | None) -> str:
    return "n/a" if v is None else f"{v:,.0f}"


class OfflineRouter:
    def __init__(self, tools: ToolExecutor, store: DataStore):
        self.tools = tools
        self.store = store

    def _resolve(self, q: str, results: list[ToolResult]) -> str | None:
        m = re.search(r"\b(\d{6})\b", q)
        if m and self.store.get(m.group(1)) is not None:
            return m.group(1)
        state = detect_state(q, allow_names=False)
        name = re.sub(r"(?i)\b(how|does|do|is|are|what|which|compare|compared|benchmark|to|its|their|peers?|in|the|"
                      r"for|of|vs|versus|trend|opportunit\w*|savings?|margin|cost|show|me|tell|about|our|we|"
                      r"hospital's|year|fy)\b|\d{4}|[?.,]", " ", q)
        name = " ".join(name.split())
        if len(name) < 3:
            return None
        r = self.tools.run("search_hospitals", {"query": name, "state": state})
        results.append(r)
        return r.data[0]["ccn"] if r.ok and r.data else None

    def answer(self, question: str, context_ccn: str | None = None, context_year: int | None = None) -> AgentAnswer:
        t0 = time.perf_counter()
        intent = detect_intent(question)
        results: list[ToolResult] = []
        m = re.search(r"\b(20[12]\d)\b", question)
        year = int(m.group(1)) if m else context_year
        kpi = detect_kpi(question)
        text = ""
        if intent == "docs":
            r = self.tools.run("search_documentation", {"query": question})
            results.append(r)
            text = self._docs(r)
        elif intent == "rank":
            state = detect_state(question)
            worst = bool(re.search(r"worst|lowest|bottom", question.lower())) and KPI_BY_KEY.get(kpi or "", KPIS[0]).direction != "lower"
            r = self.tools.run("rank_hospitals", {"kpi": kpi or "operating_margin", "year": year, "state": state,
                                                  "min_beds": detect_min_beds(question) or 25, "top_n": 10, "best_first": not worst})
            results.append(r)
            text = self._rank(r)
        else:
            ccn = None
            if not re.search(r"\b(our|we|us|this hospital)\b", question.lower()) or not context_ccn:
                ccn = self._resolve(question, results) if not context_ccn or re.search(r"\b\d{6}\b", question) else None
            ccn = ccn or context_ccn
            if not ccn:
                text = ("I could not tell which hospital you mean. Name the hospital (and state), give its 6-digit CCN, "
                        "or select one in the sidebar.")
            elif intent == "scenario":
                levers = _pcts(question) or {"volume_change_pct": 5.0}
                r = self.tools.run("run_scenario", {"ccn": ccn, "year": year, **levers})
                results.append(r)
                text = self._scenario(r)
            elif intent == "trend":
                r = self.tools.run("get_trend", {"ccn": ccn, "kpis": [kpi] if kpi else None})
                results.append(r)
                text = self._trend(r)
            elif intent == "opportunities":
                target = "top_quartile" if "quartile" in question.lower() else "median"
                r = self.tools.run("find_opportunities", {"ccn": ccn, "year": year, "target": target})
                results.append(r)
                text = self._opps(r)
            elif intent == "profile":
                r = self.tools.run("get_hospital_profile", {"ccn": ccn, "year": year})
                results.append(r)
                text = self._profile(r)
            else:
                r = self.tools.run("benchmark_hospital", {"ccn": ccn, "year": year})
                results.append(r)
                text = self._benchmark(r, kpi)
        ans = AgentAnswer(question, text, "offline", None, results)
        ans.steps = len(results)
        ans.grounding = grounding.check(text, [t.data for t in results if t.ok])
        ans.latency_s = time.perf_counter() - t0
        return ans

    # ---- templates ---------------------------------------------------------------------------
    @staticmethod
    def _err(r: ToolResult) -> str | None:
        return None if r.ok else f"I could not get that data: {r.error}"

    def _benchmark(self, r: ToolResult, kpi: str | None) -> str:
        if (e := self._err(r)):
            return e
        d = r.data
        h, pg = d["hospital"], d["peer_group"]
        rows = [x for x in d["kpis"] if x["value"] is not None]
        lines = [f"**{h['name']}** ({h['ccn']}, {h['year']}) compared with {pg['n_hospitals']} peers "
                 f"({pg['definition']}):", ""]
        if kpi:
            focus = [x for x in rows if x["kpi"] == kpi]
            rows = focus + [x for x in rows if x["kpi"] != kpi and x["status"] in ("better than peers", "worse than peers")][:3]
        else:
            headline = ["operating_margin", "opex_per_adj_discharge", "npr_per_adj_discharge",
                        "fte_per_adj_occupied_bed", "occupancy_rate", "alos", "days_in_ar"]
            rows = [x for x in rows if x["kpi"] in headline]
        for x in rows:
            pct = f", {x['percentile']:.0f}th percentile" if x["percentile"] is not None else ""
            lines.append(f"- {x['label']}: {x['value_fmt']} vs peer median {x['peer_median_fmt']}{pct} ({x['status']}).")
        worse = [x["label"].lower() for x in d["kpis"] if x["status"] == "worse than peers"]
        better = [x["label"].lower() for x in d["kpis"] if x["status"] == "better than peers"]
        lines.append("")
        if better:
            lines.append("Strengths: " + ", ".join(better) + ".")
        if worse:
            lines.append("Watch: " + ", ".join(worse) + ".")
        if pg["relaxed_dimensions"]:
            lines.append(f"Peer group was widened (dropped {', '.join(pg['relaxed_dimensions'])}) to reach enough peers.")
        lines.append("Benchmarks are not adjusted for case mix.")
        return "\n".join(lines)

    def _opps(self, r: ToolResult) -> str:
        if (e := self._err(r)):
            return e
        d = r.data
        if not d["opportunities"]:
            return f"{d['hospital']['name']} is at or better than the {d['target']} on every sized KPI in {d['hospital']['year']}."
        lines = [f"**{d['hospital']['name']}** ({d['hospital']['year']}), gaps to the {d['target']} of "
                 f"{d['peer_group']['n_hospitals']} peers ({d['peer_group']['definition']}):", ""]
        for o in d["opportunities"]:
            impact = o["annual_impact_fmt"] if o["annual_impact_usd"] is not None else o["assumptions"].split(". ")[0]
            lines.append(f"- {o['area']}: {o['current']} vs target {o['target']}, {impact} ({o['impact_type']}).")
        lines += ["", f"Estimated recurring cost savings: {d['total_recurring_cost_savings_fmt']} a year "
                      "(labor gaps are part of the unit-cost gap, so they are not added).", d["caveat"]]
        return "\n".join(lines)

    def _trend(self, r: ToolResult) -> str:
        if (e := self._err(r)):
            return e
        d = r.data
        lines = [f"**{d['hospital']['name']}**, {d['series'][0]['year']} to {d['series'][-1]['year']}:", ""]
        from ..analytics.kpis import format_value
        for k in d["kpis"]:
            c = d["change"].get(k)
            if not c:
                continue
            last_med = d["series"][-1].get(k + "_peer_median")
            lines.append(f"- {KPI_BY_KEY[k].label}: {format_value(k, c['from'])} to {format_value(k, c['to'])} "
                         f"({c['change_fmt']}); latest peer median {format_value(k, last_med)}.")
        partial = [str(p["year"]) for p in d["series"] if not p["full_year_report"]]
        if partial:
            lines.append(f"Partial-year reports: {', '.join(partial)}.")
        return "\n".join(lines)

    def _scenario(self, r: ToolResult) -> str:
        if (e := self._err(r)):
            return e
        d = r.data
        inp = {k: v for k, v in d["inputs"].items() if k != "variable_cost_share" and v}
        levers = ", ".join(f"{k.replace('_change_pct', '').replace('_', ' ')} {v:+g}%" for k, v in inp.items()) or "no change"
        from ..analytics.kpis import format_usd
        return (f"**{d['hospital']['name']}** ({d['hospital']['year']}) what-if: {levers}.\n\n"
                f"- Operating margin: {d['baseline']['operating_margin_fmt']} to {d['scenario']['operating_margin_fmt']} "
                f"({d['delta']['operating_margin_pp']:+.1f} points).\n"
                f"- Operating income changes by {d['delta']['operating_income_fmt']} "
                f"(revenue {format_usd(d['scenario']['net_patient_revenue'])}, expense {format_usd(d['scenario']['operating_expense'])}).\n\n"
                f"Assumes {d['inputs']['variable_cost_share']:.0%} of operating expense varies with volume.")

    def _profile(self, r: ToolResult) -> str:
        if (e := self._err(r)):
            return e
        d = r.data
        f = d["financials"]
        from ..analytics.kpis import format_usd
        return (f"**{d['name']}** ({d['ccn']}), {d['city']}, {d['state']}: {d['facility_type']}, {d['ownership']}, "
                f"{_n(d['beds'])} beds. Cost report {d['year']} ({d['fiscal_period']}).\n\n"
                f"- Net patient revenue {format_usd(f['net_patient_revenue'])}, operating expense "
                f"{format_usd(f['operating_expense'])}, net income {format_usd(f['net_income'])}.\n"
                f"- Payroll FTEs {_n(f['fte'])}, discharges {_n(f['discharges'])}, beds {_n(d['beds'])}.\n"
                f"- Operating margin {d['kpis_formatted']['operating_margin']}, occupancy {d['kpis_formatted']['occupancy_rate']}, "
                f"average length of stay {d['kpis_formatted']['alos']}.")

    def _rank(self, r: ToolResult) -> str:
        if (e := self._err(r)):
            return e
        d = r.data
        where = ", ".join(f"{k} {v}" for k, v in d["filters"].items() if v) or "all hospitals"
        lines = [f"**{d['label']}**, {d['year']}, {d['order']} ({where}; {d['hospitals_considered']} hospitals):", ""]
        for x in d["results"]:
            lines.append(f"{x['rank']}. {x['name']} ({x['city']}, {x['state']}): {x['value_fmt']}")
        lines += ["", "Extreme values can reflect reporting differences; check the hospital's data quality flags."]
        return "\n".join(lines)

    def _docs(self, r: ToolResult) -> str:
        if (e := self._err(r)):
            return e
        if not r.data:
            return "I found nothing in the documentation for that."
        top = r.data[0]
        body = top["text"]
        if len(body) > 900:
            body = body[:900].rsplit(" ", 1)[0] + "..."
        others = "; ".join(h["title"] for h in r.data[1:])
        return f"**{top['title']}**\n\n{body}" + (f"\n\nRelated: {others}." if others else "")
