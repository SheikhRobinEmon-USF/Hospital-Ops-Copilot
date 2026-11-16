"""Turn raw CMS cost report CSVs into a clean, analysis-ready hospital-year KPI table.

Steps:
1. Read each yearly CSV and rename the fields we use to snake_case.
2. Parse numbers and dates, and decode CMS codes (provider type, control, facility type).
3. Keep one report per hospital per year (the longest reporting period, then the latest end date).
4. Derive volume adjustments and every KPI in ``analytics.kpis.KPIS``.
5. Null out KPI values outside plausible bounds and record each such case in ``dq_flags``.
6. Write a Parquet file and a DuckDB database.
"""

from __future__ import annotations

import logging
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from ..analytics.kpis import KPI_BY_KEY, KPIS
from ..config import Settings, get_settings
from .codes import FACILITY_TYPE, PROVIDER_TYPE, TYPE_OF_CONTROL, bed_band, ownership_group

log = logging.getLogger(__name__)

COLUMNS: dict[str, str] = {
    "rpt_rec_num": "report_id",
    "Provider CCN": "ccn",
    "Hospital Name": "name",
    "Street Address": "street",
    "City": "city",
    "State Code": "state",
    "Zip Code": "zip",
    "County": "county",
    "Medicare CBSA Number": "cbsa",
    "Rural Versus Urban": "urban_rural",
    "CCN Facility Type": "facility_type",
    "Provider Type": "provider_type",
    "Type of Control": "control",
    "Fiscal Year Begin Date": "fy_begin",
    "Fiscal Year End Date": "fy_end",
    "FTE - Employees on Payroll": "fte",
    "Number of Interns and Residents (FTE)": "residents_fte",
    "Total Days Title XVIII": "medicare_days",
    "Total Days Title XIX": "medicaid_days",
    "Total Days (V + XVIII + XIX + Unknown)": "total_days",
    "Number of Beds": "beds",
    "Total Bed Days Available": "bed_days_available",
    "Total Discharges (V + XVIII + XIX + Unknown)": "discharges",
    "Total Discharges Title XVIII": "medicare_discharges",
    "Hospital Total Days (V + XVIII + XIX + Unknown) For Adults & Peds": "ap_days",
    "Hospital Total Bed Days Available For Adults & Peds": "ap_bed_days_available",
    "Hospital Total Discharges (V + XVIII + XIX + Unknown) For Adults & Peds": "ap_discharges",
    "Cost of Charity Care": "charity_care_cost",
    "Total Bad Debt Expense": "bad_debt",
    "Cost of Uncompensated Care": "uncompensated_care_cost",
    "Total Salaries From Worksheet A": "salaries",
    "Overhead Non-Salary Costs": "overhead_nonsalary",
    "Depreciation Cost": "depreciation",
    "Total Costs": "total_costs",
    "Inpatient Total Charges": "inpatient_charges",
    "Outpatient Total Charges": "outpatient_charges",
    "Combined Outpatient + Inpatient Total Charges": "total_charges",
    "Contract Labor: Direct Patient Care": "contract_labor",
    "Cash on Hand and in Banks": "cash",
    "Temporary Investments": "temp_investments",
    "Accounts Receivable": "accounts_receivable",
    "Less: Allowances for Uncollectible Notes and Accounts Receivable": "ar_allowance",
    "Total Current Assets": "current_assets",
    "Total Fixed Assets": "fixed_assets",
    "Total Assets": "total_assets",
    "Total Current Liabilities": "current_liabilities",
    "Total Long Term Liabilities": "long_term_liabilities",
    "Total Liabilities": "total_liabilities",
    "Total Fund Balances": "fund_balance",
    "Disproportionate Share Adjustment": "dsh_payments",
    "Total IME Payment": "ime_payments",
    "Inpatient Revenue": "inpatient_revenue",
    "Outpatient Revenue": "outpatient_revenue",
    "Total Patient Revenue": "total_patient_revenue",
    "Less Contractual Allowance and Discounts on Patients' Accounts": "contractual_allowances",
    "Net Patient Revenue": "net_patient_revenue",
    "Less Total Operating Expense": "operating_expense",
    "Net Income from Service to Patients": "net_patient_income",
    "Total Other Income": "other_income",
    "Total Income": "total_income",
    "Total Other Expenses": "other_expenses",
    "Net Income": "net_income",
    "Cost To Charge Ratio": "reported_ccr",
}

TEXT_COLS = {"report_id", "ccn", "name", "street", "city", "state", "zip", "county", "cbsa",
             "urban_rural", "facility_type", "fy_begin", "fy_end"}
MIN_FULL_YEAR_DAYS = 300  # reports shorter than this are excluded from peer statistics


def _div(a: pd.Series, b: pd.Series) -> pd.Series:
    b = b.where(b != 0)
    return a / b


def load_year(path: Path, year: int) -> pd.DataFrame:
    raw = pd.read_csv(path, dtype=str, keep_default_na=False, na_values=[""])
    missing = [c for c in COLUMNS if c not in raw.columns]
    if missing:
        raise ValueError(f"{path.name}: missing expected columns {missing}")
    df = raw[list(COLUMNS)].rename(columns=COLUMNS)
    for col in df.columns:
        if col not in TEXT_COLS:
            df[col] = pd.to_numeric(df[col].str.replace(",", "", regex=False), errors="coerce")
    df["fy_begin"] = pd.to_datetime(df["fy_begin"], errors="coerce")
    df["fy_end"] = pd.to_datetime(df["fy_end"], errors="coerce")
    df["year"] = year
    return df


def dedupe(df: pd.DataFrame) -> pd.DataFrame:
    """Keep one report per (ccn, year): the longest period, then the latest end date."""
    df = df.copy()
    df["period_days"] = (df["fy_end"] - df["fy_begin"]).dt.days + 1
    df = df.sort_values(["ccn", "year", "period_days", "fy_end"], ascending=[True, True, False, False])
    return df.drop_duplicates(["ccn", "year"], keep="first").reset_index(drop=True)


def derive(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["ccn"] = df["ccn"].str.strip().str.zfill(6)
    df["name"] = df["name"].str.strip()
    df["city"] = df["city"].str.strip().str.title()
    df["provider_type_desc"] = df["provider_type"].map(PROVIDER_TYPE).fillna("Unknown")
    df["control_desc"] = df["control"].map(TYPE_OF_CONTROL).fillna("Unknown")
    df["ownership"] = df["control"].map(lambda c: ownership_group(int(c)) if c == c else "Unknown")
    df["facility_type_desc"] = df["facility_type"].map(FACILITY_TYPE).fillna("Other")
    df["urban_rural"] = df["urban_rural"].map({"U": "Urban", "R": "Rural"}).fillna("Unknown")
    df["bed_band"] = df["beds"].map(bed_band)
    df["full_year"] = df["period_days"] >= MIN_FULL_YEAR_DAYS
    days = df["period_days"].where(df["period_days"] > 0)

    # Volume adjustment factor: scales inpatient volume up to account for outpatient work.
    adj = _div(df["total_charges"], df["inpatient_charges"])
    adj = adj.where((adj >= 1) & (adj <= 50))
    df["adjustment_factor"] = adj
    df["adj_discharges"] = df["discharges"] * adj
    df["adj_patient_days"] = df["total_days"] * adj

    k: dict[str, pd.Series] = {}
    npr, opex = df["net_patient_revenue"], df["operating_expense"]
    k["operating_margin"] = _div(npr - opex, npr)
    k["total_margin"] = _div(df["net_income"], npr + df["other_income"].fillna(0))
    k["opex_per_adj_discharge"] = _div(opex, df["adj_discharges"])
    k["npr_per_adj_discharge"] = _div(npr, df["adj_discharges"])
    k["labor_cost_share"] = _div(df["salaries"], df["total_costs"])
    k["contract_labor_ratio"] = _div(df["contract_labor"], df["salaries"])
    k["fte_per_adj_occupied_bed"] = _div(df["fte"], _div(df["adj_patient_days"], days))
    k["occupancy_rate"] = _div(df["ap_days"], df["ap_bed_days_available"])
    k["alos"] = _div(df["ap_days"], df["ap_discharges"])
    k["cost_to_charge_ratio"] = df["reported_ccr"].where(
        df["reported_ccr"] > 0, _div(df["total_costs"], df["total_charges"]))
    k["contractual_allowance_pct"] = _div(df["contractual_allowances"], df["total_patient_revenue"])
    k["uncompensated_care_pct"] = _div(df["uncompensated_care_cost"], opex)
    k["medicare_day_share"] = _div(df["medicare_days"], df["total_days"])
    k["medicaid_day_share"] = _div(df["medicaid_days"], df["total_days"])
    k["outpatient_revenue_share"] = _div(df["outpatient_charges"], df["total_charges"])
    cash = df["cash"].fillna(0) + df["temp_investments"].fillna(0)
    cash = cash.where(df["cash"].notna() | df["temp_investments"].notna())
    k["days_cash_on_hand"] = _div(cash, _div(opex - df["depreciation"].fillna(0), days))
    k["current_ratio"] = _div(df["current_assets"], df["current_liabilities"])
    net_ar = df["accounts_receivable"] + df["ar_allowance"].fillna(0)
    k["days_in_ar"] = _div(net_ar, _div(npr, days))
    k["debt_to_assets"] = _div(df["total_liabilities"], df["total_assets"])

    flags: list[list[str]] = [[] for _ in range(len(df))]
    for key, series in k.items():
        lo, hi = KPI_BY_KEY[key].bounds
        series = series.replace([np.inf, -np.inf], np.nan)
        bad = series.notna() & ((series < lo) | (series > hi))
        for i in np.flatnonzero(bad.to_numpy()):
            flags[i].append(key)
        df[key] = series.where(~bad)
    if not df["full_year"].all():
        for i in np.flatnonzero((~df["full_year"]).to_numpy()):
            flags[i].insert(0, "partial_year")
    df["dq_flags"] = [",".join(f) for f in flags]
    return df


def build(settings: Settings | None = None, years: list[int] | None = None) -> pd.DataFrame:
    settings = settings or get_settings()
    years = list(years or settings.years)
    frames = []
    for year in years:
        path = settings.raw_dir / f"CostReport_{year}_Final.csv"
        if not path.exists():
            raise FileNotFoundError(f"{path} not found. Run `hoc download` first.")
        frames.append(load_year(path, year))
    df = derive(dedupe(pd.concat(frames, ignore_index=True)))
    order = ["ccn", "year", "name", "city", "state", "zip", "county", "cbsa", "urban_rural",
             "facility_type", "facility_type_desc", "provider_type", "provider_type_desc", "control",
             "control_desc", "ownership", "beds", "bed_band", "fy_begin", "fy_end", "period_days",
             "full_year", "report_id"]
    kpi_cols = [k.key for k in KPIS]
    rest = [c for c in df.columns if c not in order and c not in kpi_cols and c != "dq_flags"]
    df = df[order + kpi_cols + rest + ["dq_flags"]].sort_values(["ccn", "year"]).reset_index(drop=True)

    settings.processed_dir.mkdir(parents=True, exist_ok=True)
    df.to_parquet(settings.kpi_path, index=False, compression="zstd")
    settings.duckdb_path.unlink(missing_ok=True)
    with duckdb.connect(str(settings.duckdb_path)) as con:
        con.execute("CREATE OR REPLACE TABLE hospital_year AS SELECT * FROM read_parquet(?)",
                    [str(settings.kpi_path)])
    log.info("built %d hospital-years (%d hospitals) -> %s", len(df), df["ccn"].nunique(), settings.kpi_path)
    return df
