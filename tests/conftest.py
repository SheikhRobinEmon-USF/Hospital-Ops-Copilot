"""Synthetic fixtures: a small fake cost report dataset that runs through the real pipeline."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from hospital_ops_copilot.analytics.store import DataStore
from hospital_ops_copilot.data.build import COLUMNS, dedupe, derive
from hospital_ops_copilot.rag.corpus import build_corpus
from hospital_ops_copilot.rag.index import Retriever

STATES = ["FL", "GA", "TX"]


def _raw_row(i: int, year: int, rng: np.random.Generator, **over) -> dict:
    beds = over.pop("beds", int(rng.integers(120, 290)))
    discharges = beds * rng.uniform(40, 60)
    days = discharges * rng.uniform(3.5, 5.5)
    inpatient_charges = discharges * rng.uniform(40_000, 60_000)
    total_charges = inpatient_charges * rng.uniform(1.4, 2.2)
    npr = total_charges * rng.uniform(0.25, 0.35)
    opex = npr * rng.uniform(0.9, 1.1)
    salaries = opex * rng.uniform(0.35, 0.45)
    fte = beds * rng.uniform(3.5, 6.0)
    row = {
        "rpt_rec_num": str(10_000 + i * 10 + year % 10),
        "Provider CCN": f"{10 + STATES.index(over.get('state', STATES[i % 3])):02d}{i:04d}",
        "Hospital Name": over.pop("name", f"TEST HOSPITAL {i}"),
        "Street Address": "1 MAIN ST", "City": "SPRINGFIELD", "State Code": over.pop("state", STATES[i % 3]),
        "Zip Code": "00000", "County": "TEST", "Medicare CBSA Number": "00000",
        "Rural Versus Urban": "U" if i % 2 else "R", "CCN Facility Type": "STH", "Provider Type": "1",
        "Type of Control": str([2, 4, 9][i % 3]),
        "Fiscal Year Begin Date": f"01/01/{year}", "Fiscal Year End Date": f"12/31/{year}",
        "FTE - Employees on Payroll": fte, "Number of Interns and Residents (FTE)": "",
        "Total Days Title XVIII": days * 0.4, "Total Days Title XIX": days * 0.15,
        "Total Days (V + XVIII + XIX + Unknown)": days, "Number of Beds": beds,
        "Total Bed Days Available": beds * 365, "Total Discharges (V + XVIII + XIX + Unknown)": discharges,
        "Total Discharges Title XVIII": discharges * 0.4,
        "Hospital Total Days (V + XVIII + XIX + Unknown) For Adults & Peds": days,
        "Hospital Total Bed Days Available For Adults & Peds": beds * 365,
        "Hospital Total Discharges (V + XVIII + XIX + Unknown) For Adults & Peds": discharges,
        "Cost of Charity Care": opex * 0.01, "Total Bad Debt Expense": opex * 0.02,
        "Cost of Uncompensated Care": opex * 0.03, "Total Salaries From Worksheet A": salaries,
        "Overhead Non-Salary Costs": opex * 0.3, "Depreciation Cost": opex * 0.05, "Total Costs": opex * 0.98,
        "Inpatient Total Charges": inpatient_charges, "Outpatient Total Charges": total_charges - inpatient_charges,
        "Combined Outpatient + Inpatient Total Charges": total_charges,
        "Contract Labor: Direct Patient Care": salaries * rng.uniform(0.02, 0.12),
        "Cash on Hand and in Banks": opex * rng.uniform(0.05, 0.3), "Temporary Investments": "",
        "Accounts Receivable": npr * rng.uniform(0.15, 0.25), "Less: Allowances for Uncollectible Notes and Accounts Receivable": -npr * 0.03,
        "Total Current Assets": npr * 0.4, "Total Fixed Assets": npr * 0.8, "Total Assets": npr * 1.5,
        "Total Current Liabilities": npr * 0.2, "Total Long Term Liabilities": npr * 0.5, "Total Liabilities": npr * 0.7,
        "Total Fund Balances": npr * 0.8, "Disproportionate Share Adjustment": "", "Total IME Payment": "",
        "Inpatient Revenue": inpatient_charges, "Outpatient Revenue": total_charges - inpatient_charges,
        "Total Patient Revenue": total_charges, "Less Contractual Allowance and Discounts on Patients' Accounts": total_charges - npr,
        "Net Patient Revenue": npr, "Less Total Operating Expense": opex, "Net Income from Service to Patients": npr - opex,
        "Total Other Income": npr * 0.05, "Total Income": npr - opex + npr * 0.05, "Total Other Expenses": "",
        "Net Income": npr - opex + npr * 0.05, "Cost To Charge Ratio": "",
    }
    row.update(over)
    return row


def make_raw(n: int = 45, years=(2022, 2023), seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for year in years:
        for i in range(n):
            name = "SAMPLE GENERAL HOSPITAL" if i == 0 else None
            extra = {"name": name} if name else {}
            rows.append(_raw_row(i, year, rng, **extra))
    raw = pd.DataFrame(rows).astype(str).replace({"nan": ""})
    return raw


def frame_from_raw(raw: pd.DataFrame, years=(2022, 2023)) -> pd.DataFrame:
    from hospital_ops_copilot.data.build import TEXT_COLS
    frames = []
    for y in years:
        part = raw[raw["Fiscal Year Begin Date"].str.endswith(str(y))]
        df = part[list(COLUMNS)].rename(columns=COLUMNS)
        for col in df.columns:
            if col not in TEXT_COLS:
                df[col] = pd.to_numeric(df[col].replace("", np.nan), errors="coerce")
        df["fy_begin"] = pd.to_datetime(df["fy_begin"])
        df["fy_end"] = pd.to_datetime(df["fy_end"])
        df["year"] = y
        frames.append(df)
    return derive(dedupe(pd.concat(frames, ignore_index=True)))


@pytest.fixture(scope="session")
def kpi_frame() -> pd.DataFrame:
    return frame_from_raw(make_raw())


@pytest.fixture(scope="session")
def store(kpi_frame) -> DataStore:
    return DataStore(df=kpi_frame)


@pytest.fixture(scope="session")
def retriever() -> Retriever:
    return Retriever(chunks=build_corpus(), mode="bm25")


@pytest.fixture(scope="session")
def sample_ccn(kpi_frame) -> str:
    return kpi_frame.loc[kpi_frame["name"] == "SAMPLE GENERAL HOSPITAL", "ccn"].iloc[0]
