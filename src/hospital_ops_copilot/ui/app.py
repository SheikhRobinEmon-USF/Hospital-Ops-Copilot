"""Streamlit app: hospital benchmarking dashboard plus the local-LLM copilot.

Run with ``hoc ui`` or ``streamlit run src/hospital_ops_copilot/ui/app.py``.
"""

from __future__ import annotations

import altair as alt
import pandas as pd
import streamlit as st

from hospital_ops_copilot.analytics import benchmark as bm
from hospital_ops_copilot.analytics.kpis import KPI_BY_KEY, KPIS, format_usd, format_value
from hospital_ops_copilot.analytics.store import SOURCE_URL, get_store
from hospital_ops_copilot.config import get_settings
from hospital_ops_copilot.llm.agent import Copilot
from hospital_ops_copilot.llm.ollama_client import OllamaClient

st.set_page_config(page_title="Hospital Ops Copilot", layout="wide")

STATUS_COLORS = {"better than peers": "#2e7d32", "worse than peers": "#c62828", "in line with peers": "#607d8b",
                 "above peer range": "#ef6c00", "below peer range": "#1565c0", "insufficient data": "#bdbdbd"}
HEADLINE = ["operating_margin", "total_margin", "opex_per_adj_discharge", "npr_per_adj_discharge",
            "fte_per_adj_occupied_bed", "occupancy_rate", "alos", "days_in_ar"]
EXAMPLES = [
    "How do we compare to our peers?",
    "What are our biggest savings opportunities?",
    "How has our operating margin changed over time?",
    "What if volume grows 5% and labor costs rise 3%?",
    "How is cost per adjusted discharge calculated?",
    "Which Florida hospitals with 200+ beds have the best operating margin?",
]


@st.cache_resource
def store():
    return get_store()


@st.cache_resource
def copilot(model: str) -> Copilot:
    return Copilot(store=store(), model=model)


@st.cache_data(ttl=60)
def ollama_models() -> list[str]:
    c = OllamaClient()
    if not c.available():
        return []
    try:
        return [m for m in c.list_models() if "embed" not in m]
    except Exception:  # noqa: BLE001
        return []


def sidebar() -> tuple[str, int, list[str], str | None]:
    s = store()
    st.sidebar.title("Hospital Ops Copilot")
    st.sidebar.caption("Financial benchmarking on public CMS cost reports, with a local LLM copilot.")
    q = st.sidebar.text_input("Find a hospital (name, city, or CCN)", value=st.session_state.get("q", "Tampa General"))
    st.session_state["q"] = q
    state = st.sidebar.text_input("State (optional)", max_chars=2).upper() or None
    hits = s.search(q, state=state, limit=15) if len(q) >= 2 else []
    if not hits:
        st.sidebar.warning("No match. Showing Tampa General Hospital.")
        hits = s.search("100128")
    labels = [f"{h['name']} ({h['city']}, {h['state']}) [{h['ccn']}]" for h in hits]
    idx = st.sidebar.selectbox("Hospital", range(len(hits)), format_func=lambda i: labels[i])
    ccn = hits[idx]["ccn"]
    years = s.history(ccn)["year"].tolist()
    year = st.sidebar.selectbox("Cost report year", years[::-1])
    peer_dims = st.sidebar.multiselect("Peer group", list(bm.PEER_DIMENSIONS), default=list(bm.DEFAULT_PEER_DIMS),
                                       format_func=lambda d: bm.PEER_DIMENSIONS[d])
    st.sidebar.divider()
    models = ollama_models()
    s_ = get_settings()
    if models:
        default = models.index(s_.chat_model) if s_.chat_model in models else 0
        model = st.sidebar.selectbox("Local model (Ollama)", models, index=default)
        st.sidebar.success(f"Ollama connected: {len(models)} models")
    else:
        model = None
        st.sidebar.info("Ollama not detected. The copilot runs in offline analyst mode (same numbers, templated wording).")
    st.sidebar.caption(f"Data: [CMS Hospital Provider Cost Report]({SOURCE_URL}), years {s.years[0]} to {s.years[-1]}.")
    return ccn, int(year), peer_dims or list(bm.DEFAULT_PEER_DIMS), model


def header(p: dict) -> None:
    st.title(p["name"].title())
    st.caption(f"CCN {p['ccn']} · {p['city']}, {p['state']} · {p['facility_type']} · {p['ownership']} · "
               f"{p['beds']:.0f} beds · {p['urban_rural']} (Medicare indicator) · fiscal period {p['fiscal_period']}")
    if p["data_quality_flags"]:
        st.warning("Data quality flags for this report: " + ", ".join(p["data_quality_flags"]) +
                   ". Flagged KPIs are excluded as implausible values.")


def overview(p: dict, b: dict) -> None:
    f = p["financials"]
    c = st.columns(4)
    c[0].metric("Net patient revenue", format_usd(f["net_patient_revenue"]))
    c[1].metric("Operating expense", format_usd(f["operating_expense"]))
    c[2].metric("Net income", format_usd(f["net_income"]))
    c[3].metric("Payroll FTEs", f"{f['fte']:,.0f}" if f["fte"] else "n/a")
    st.subheader("Headline KPIs vs peer median")
    st.caption(f"Peer group: {b['peer_group']['definition']} ({b['peer_group']['n_hospitals']} hospitals, same year).")
    rows = {r["kpi"]: r for r in b["kpis"]}
    cols = st.columns(4)
    for i, key in enumerate(HEADLINE):
        r = rows[key]
        k = KPI_BY_KEY[key]
        delta = None
        if r["value"] is not None and r["peer_median"] is not None:
            diff = r["value"] - r["peer_median"]
            delta = f"{diff * 100:+.1f} pts vs median" if k.unit == "pct" else f"{format_value(key, diff)} vs median"
        cols[i % 4].metric(k.label, r["value_fmt"], delta,
                           delta_color="normal" if k.direction == "higher" else "inverse" if k.direction == "lower" else "off",
                           help=k.description)


def benchmark_tab(b: dict) -> None:
    df = pd.DataFrame(b["kpis"])
    df = df[df["percentile"].notna()]
    st.caption(f"Percentile rank among {b['peer_group']['n_hospitals']} peers ({b['peer_group']['definition']}). "
               "Bands mark the 25th to 75th percentile.")
    if b["peer_group"]["relaxed_dimensions"]:
        st.info("Peer group widened to reach 10 peers: dropped " + ", ".join(b["peer_group"]["relaxed_dimensions"]))
    base = alt.Chart(df).encode(y=alt.Y("label:N", sort=None, title=None, axis=alt.Axis(labelLimit=320)))
    band = alt.Chart(pd.DataFrame({"x": [25], "x2": [75]})).mark_rect(opacity=0.12, color="#607d8b").encode(x="x:Q", x2="x2:Q")
    dots = base.mark_circle(size=160).encode(
        x=alt.X("percentile:Q", scale=alt.Scale(domain=[0, 100]), title="Percentile among peers"),
        color=alt.Color("status:N", scale=alt.Scale(domain=list(STATUS_COLORS)[:-1], range=list(STATUS_COLORS.values())[:-1]),
                        legend=alt.Legend(orient="bottom", title=None)),
        tooltip=["label", "value_fmt", "peer_median_fmt", "peer_range_fmt", "percentile", "status", "peers_with_data"])
    st.altair_chart(band + dots, width="stretch")
    show = pd.DataFrame(b["kpis"])[["category", "label", "value_fmt", "peer_median_fmt", "peer_range_fmt", "percentile",
                                    "status", "peers_with_data"]]
    show.columns = ["Category", "KPI", "Value", "Peer median", "Peer IQR", "Percentile", "Status", "Peers with data"]
    st.dataframe(show, hide_index=True, width="stretch")


def opportunities_tab(ccn: str, year: int, peer_dims: list[str]) -> None:
    target = st.radio("Target", ["median", "top_quartile"], horizontal=True,
                      format_func=lambda t: "Peer median" if t == "median" else "Peer top quartile")
    o = bm.opportunities(store(), ccn, year, peer_dims, target=target)
    c = st.columns(2)
    c[0].metric("Estimated recurring cost savings", o["total_recurring_cost_savings_fmt"], help=o["total_note"])
    cash = sum(x["annual_impact_usd"] or 0 for x in o["opportunities"] if x["impact_type"] == "one-time cash release")
    c[1].metric("One-time cash release (A/R)", format_usd(cash))
    if not o["opportunities"]:
        st.success("At or better than target on every sized KPI.")
        return
    df = pd.DataFrame(o["opportunities"])
    sized = df[df["annual_impact_usd"].notna()]
    if not sized.empty:
        st.altair_chart(alt.Chart(sized).mark_bar().encode(
            x=alt.X("annual_impact_usd:Q", title="Estimated impact (USD)", axis=alt.Axis(format="$,.2s")),
            y=alt.Y("area:N", sort="-x", title=None, axis=alt.Axis(labelLimit=240)), color=alt.Color("impact_type:N", legend=alt.Legend(orient="bottom", title=None)),
            tooltip=["area", "current", "target", "annual_impact_fmt", "formula", "assumptions"]), width="stretch")
    t = df[["area", "current", "target", "annual_impact_fmt", "impact_type", "formula", "assumptions"]]
    t.columns = ["Area", "Current", "Target", "Impact", "Type", "Formula", "Assumptions"]
    st.dataframe(t, hide_index=True, width="stretch")
    st.caption(o["caveat"])


def trends_tab(ccn: str, peer_dims: list[str]) -> None:
    key = st.selectbox("KPI", [k.key for k in KPIS], format_func=lambda k: KPI_BY_KEY[k].label)
    t = bm.trend(store(), ccn, [key], peer_dims)
    rows = []
    for p in t["series"]:
        rows.append({"year": str(p["year"]), "series": "This hospital", "value": p.get(key)})
        rows.append({"year": str(p["year"]), "series": "Peer median", "value": p.get(key + "_peer_median")})
    df = pd.DataFrame(rows).dropna()
    fmt = "%" if KPI_BY_KEY[key].unit == "pct" else ",.2f"
    st.altair_chart(alt.Chart(df).mark_line(point=True).encode(
        x=alt.X("year:O", title="Cost report year"), y=alt.Y("value:Q", title=KPI_BY_KEY[key].label, axis=alt.Axis(format=fmt)),
        color=alt.Color("series:N", legend=alt.Legend(orient="bottom", title=None)), tooltip=["year", "series", "value"]),
        width="stretch")
    if key in t["change"]:
        c = t["change"][key]
        st.write(f"{KPI_BY_KEY[key].label}: {format_value(key, c['from'])} in {c['from_year']} to "
                 f"{format_value(key, c['to'])} in {c['to_year']} ({c['change_fmt']}).")
    st.caption(KPI_BY_KEY[key].description + " Formula: " + KPI_BY_KEY[key].formula + ".")


def scenario_tab(ccn: str, year: int) -> None:
    c = st.columns(5)
    vol = c[0].slider("Volume change %", -20.0, 20.0, 0.0, 0.5)
    rate = c[1].slider("Payment rate change %", -10.0, 10.0, 0.0, 0.5)
    opex = c[2].slider("Operating expense change %", -10.0, 10.0, 0.0, 0.5)
    labor = c[3].slider("Labor cost change %", -10.0, 15.0, 0.0, 0.5)
    var = c[4].slider("Variable cost share", 0.0, 1.0, 0.35, 0.05)
    s = bm.scenario(store(), ccn, year, vol, rate, opex, labor, var)
    m = st.columns(3)
    m[0].metric("Operating margin", s["scenario"]["operating_margin_fmt"], f"{s['delta']['operating_margin_pp']:+.1f} pts")
    m[1].metric("Operating income", format_usd(s["scenario"]["operating_income"]), s["delta"]["operating_income_fmt"])
    m[2].metric("Net patient revenue", format_usd(s["scenario"]["net_patient_revenue"]))
    st.caption("Model: " + s["formula"] + ". Baseline margin " + s["baseline"]["operating_margin_fmt"] + ".")


def market_tab(year: int) -> None:
    c = st.columns(5)
    key = c[0].selectbox("Rank by", [k.key for k in KPIS], format_func=lambda k: KPI_BY_KEY[k].label, key="rank_kpi")
    state = c[1].text_input("State", "FL", max_chars=2, key="rank_state").upper() or None
    ftype = c[2].selectbox("Facility type", ["STH", "CAH", "PH", "RH", "LTCH", "CH", "Any"])
    min_beds = c[3].number_input("Minimum beds", 0, 2000, 100, 25)
    best = c[4].radio("Order", ["Best first", "Worst first"]) == "Best first"
    r = bm.rank(store(), key, year, state, None if ftype == "Any" else ftype, int(min_beds), 25, best)
    st.caption(f"{r['hospitals_considered']} hospitals meet the filters ({r['year']} full-year reports).")
    df = pd.DataFrame(r["results"])
    if not df.empty:
        st.dataframe(df[["rank", "name", "city", "state", "beds", "value_fmt"]].rename(columns={"value_fmt": KPI_BY_KEY[key].label}),
                     hide_index=True, width="stretch")


def copilot_tab(ccn: str, year: int, name: str, model: str | None) -> None:
    st.caption(f"Ask about **{name.title()}** or any hospital. Every figure comes from a tool call over CMS data; "
               "numbers the model states are checked against tool outputs.")
    hist_key = f"chat_{ccn}"
    history = st.session_state.setdefault(hist_key, [])
    cols = st.columns(3)
    clicked = None
    for i, ex in enumerate(EXAMPLES):
        if cols[i % 3].button(ex, key=f"ex{i}", width="stretch"):
            clicked = ex
    for turn in history:
        with st.chat_message(turn["role"]):
            st.markdown(turn["content"])
            if turn.get("meta"):
                _meta(turn["meta"])
    prompt = st.chat_input("Ask the copilot") or clicked
    if prompt:
        history.append({"role": "user", "content": prompt})
        with st.chat_message("user"):
            st.markdown(prompt)
        with st.chat_message("assistant"):
            with st.spinner("Calling tools and drafting the answer..." if model else "Running offline analyst..."):
                c = copilot(model or get_settings().chat_model)
                ans = c.ask(prompt, context_ccn=ccn, context_year=year,
                            history=[{"role": t["role"], "content": t["content"]} for t in history[:-1]],
                            force_offline=model is None)
            st.markdown(ans.answer)
            meta = ans.to_dict()
            _meta(meta)
        history.append({"role": "assistant", "content": ans.answer, "meta": meta})


def _meta(meta: dict) -> None:
    g = meta.get("grounding") or {}
    badge = (f"Grounded numbers: {g.get('numbers_grounded', 0)}/{g.get('numbers_checked', 0)}"
             if g.get("numbers_checked") else "No figures to check")
    who = f"{meta['backend']}{' · ' + meta['model'] if meta.get('model') else ''}"
    st.caption(f"{who} · {badge} · {meta['latency_s']}s · tools: {', '.join(meta['tools_called']) or 'none'}")
    if g.get("ungrounded"):
        st.warning("Not found in tool outputs: " + ", ".join(g["ungrounded"]))
    for n in meta.get("notes", []):
        st.caption(f"Note: {n}")
    with st.expander("Sources and tool calls"):
        for s in meta.get("sources", []):
            if s.get("url"):
                st.markdown(f"- [{s.get('title') or s.get('dataset')}]({s['url']})")
            else:
                fields = ", ".join(s.get("fields", [])[:8])
                st.markdown(f"- {s.get('dataset')}, {s.get('year')}, CCN {s.get('ccn')}, report {s.get('report_id')}, "
                            f"period {s.get('fiscal_period')}. Fields: {fields}")
        st.json(meta.get("tool_calls", []), expanded=False)


def main() -> None:
    try:
        _ = store().df
    except FileNotFoundError as e:
        st.error(f"{e}")
        st.stop()
    ccn, year, peer_dims, model = sidebar()
    p = bm.profile(store(), ccn, year)
    b = bm.benchmark(store(), ccn, year, peer_dims)
    header(p)
    tabs = st.tabs(["Overview", "Benchmark", "Opportunities", "Trends", "What-if", "Market", "Copilot"])
    with tabs[0]:
        overview(p, b)
    with tabs[1]:
        benchmark_tab(b)
    with tabs[2]:
        opportunities_tab(ccn, year, peer_dims)
    with tabs[3]:
        trends_tab(ccn, peer_dims)
    with tabs[4]:
        scenario_tab(ccn, year)
    with tabs[5]:
        market_tab(year)
    with tabs[6]:
        copilot_tab(ccn, year, p["name"], model)


main()
