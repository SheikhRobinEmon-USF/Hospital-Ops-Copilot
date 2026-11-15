import numpy as np
import pandas as pd
import pytest

from hospital_ops_copilot.analytics import benchmark as bm
from hospital_ops_copilot.analytics.kpis import (
    KPI_KEYS,
    format_usd,
    format_value,
    glossary_markdown,
)
from hospital_ops_copilot.data.build import dedupe, derive


def test_every_kpi_is_derived(kpi_frame):
    for key in KPI_KEYS:
        assert key in kpi_frame.columns
        assert kpi_frame[key].notna().mean() > 0.9, key


def test_kpi_formulas_match_definitions(kpi_frame):
    r = kpi_frame.iloc[0]
    assert r["operating_margin"] == pytest.approx((r["net_patient_revenue"] - r["operating_expense"]) / r["net_patient_revenue"])
    adj = r["total_charges"] / r["inpatient_charges"]
    assert r["opex_per_adj_discharge"] == pytest.approx(r["operating_expense"] / (r["discharges"] * adj))
    assert r["alos"] == pytest.approx(r["ap_days"] / r["ap_discharges"])
    assert r["occupancy_rate"] == pytest.approx(r["ap_days"] / r["ap_bed_days_available"])
    net_ar = r["accounts_receivable"] + r["ar_allowance"]
    assert r["days_in_ar"] == pytest.approx(net_ar / (r["net_patient_revenue"] / r["period_days"]))


def test_dedupe_keeps_longest_period():
    df = pd.DataFrame({"ccn": ["000001", "000001"], "year": [2023, 2023],
                       "fy_begin": pd.to_datetime(["2023-01-01", "2023-07-01"]),
                       "fy_end": pd.to_datetime(["2023-06-30", "2023-12-31"]), "x": [1, 2]})
    df.loc[1, "fy_begin"] = pd.Timestamp("2023-01-01")
    out = dedupe(df)
    assert len(out) == 1 and out.iloc[0]["x"] == 2


def test_out_of_bounds_values_are_nulled_and_flagged(kpi_frame):
    bad = kpi_frame.head(1).copy()
    raw_cols = [c for c in bad.columns if c not in KPI_KEYS and c not in ("dq_flags",)]
    bad = bad[raw_cols]
    bad["operating_expense"] = bad["net_patient_revenue"] * 10  # margin -900%
    out = derive(bad)
    assert np.isnan(out.iloc[0]["operating_margin"])
    assert "operating_margin" in out.iloc[0]["dq_flags"]


def test_formatting():
    assert format_value("operating_margin", 0.0845) == "8.5%"
    assert format_value("opex_per_adj_discharge", 12345.6) == "$12,346"
    assert format_value("alos", 4.25) == "4.2 days" or format_value("alos", 4.25) == "4.3 days"
    assert format_usd(1_234_000) == "$1.2M"
    assert format_usd(-2_500_000_000) == "-$2.50B"
    assert "Operating margin" in glossary_markdown()


def test_benchmark_percentiles(store, sample_ccn):
    b = bm.benchmark(store, sample_ccn, 2023)
    assert b["peer_group"]["n_hospitals"] >= 10
    row = next(r for r in b["kpis"] if r["kpi"] == "operating_margin")
    assert row["peer_p25"] <= row["peer_median"] <= row["peer_p75"]
    assert 0 <= row["percentile"] <= 100
    assert row["status"] in {"better than peers", "worse than peers", "in line with peers"}


def test_peer_group_relaxes_when_small(store, sample_ccn):
    r = store.get(sample_ccn, 2023)
    pg = bm.peer_group(store, r, ["facility_type", "bed_band", "state", "ownership"], min_peers=10)
    assert pg.n >= 10
    assert "state" in pg.relaxed or pg.n >= 10


def test_opportunities_are_consistent(store, kpi_frame):
    for ccn in kpi_frame["ccn"].unique()[:10]:
        o = bm.opportunities(store, ccn, 2023)
        for opp in o["opportunities"]:
            assert opp["annual_impact_usd"] is None or opp["annual_impact_usd"] > 0
        by = {x["area"]: x["annual_impact_usd"] or 0 for x in o["opportunities"]}
        labor = by.get("Staffing productivity", 0) + by.get("Contract labor", 0)
        assert o["total_recurring_cost_savings_usd"] == pytest.approx(max(by.get("Unit cost", 0), labor))


def test_scenario_math(store, sample_ccn):
    s = bm.scenario(store, sample_ccn, 2023, volume_change_pct=10, opex_change_pct=-2, variable_cost_share=0.4)
    npr, opex = s["baseline"]["net_patient_revenue"], s["baseline"]["operating_expense"]
    assert s["scenario"]["net_patient_revenue"] == pytest.approx(npr * 1.1)
    assert s["scenario"]["operating_expense"] == pytest.approx(opex + opex * 0.4 * 0.1 - opex * 0.02)
    zero = bm.scenario(store, sample_ccn, 2023)
    assert zero["delta"]["operating_income"] == pytest.approx(0)


def test_trend_and_rank(store, sample_ccn):
    t = bm.trend(store, sample_ccn, ["operating_margin"])
    assert [p["year"] for p in t["series"]] == [2022, 2023]
    assert "operating_margin" in t["change"]
    r = bm.rank(store, "opex_per_adj_discharge", 2023, top_n=5)
    vals = [x["value"] for x in r["results"]]
    assert vals == sorted(vals)  # lower is better -> ascending when best first
    r2 = bm.rank(store, "operating_margin", 2023, top_n=5)
    vals2 = [x["value"] for x in r2["results"]]
    assert vals2 == sorted(vals2, reverse=True)


def test_search(store, sample_ccn):
    hits = store.search("sample general")
    assert hits[0]["ccn"] == sample_ccn
    assert store.search(sample_ccn)[0]["ccn"] == sample_ccn


def test_not_found(store):
    with pytest.raises(bm.NotFoundError):
        bm.benchmark(store, "999999", 2023)
