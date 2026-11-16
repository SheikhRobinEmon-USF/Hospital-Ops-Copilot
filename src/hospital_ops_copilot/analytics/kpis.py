"""KPI catalogue: the single source of truth for every metric the copilot computes.

Each KPI records its formula, unit, the CMS cost report fields it uses, and which direction is
favourable. The pipeline, the benchmark engine, the UI, the LLM tools, and the RAG glossary are
all generated from this table, so a definition only ever lives in one place.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class KPI:
    key: str
    label: str
    category: str
    unit: str  # pct | usd | ratio | days | count
    direction: str | None  # "higher", "lower", or None when neither direction is clearly better
    formula: str
    fields: tuple[str, ...]
    description: str
    bounds: tuple[float, float]  # plausible range; values outside are treated as data errors

    def favorable(self, value: float, reference: float) -> bool | None:
        if self.direction is None or value is None or reference is None:
            return None
        return value >= reference if self.direction == "higher" else value <= reference


KPIS: list[KPI] = [
    KPI(
        "operating_margin", "Operating margin (patient services)", "Profitability", "pct", "higher",
        "(Net Patient Revenue - Total Operating Expense) / Net Patient Revenue",
        ("Net Patient Revenue", "Less Total Operating Expense"),
        "Share of net patient revenue left after paying operating expenses. Shows whether patient care "
        "covers its cost. Cost reports put other operating revenue (grants, cafeteria, retail pharmacy, "
        "appropriations) in Total Other Income, so this margin is often negative even for profitable "
        "hospitals; read it with the total margin.",
        (-2.0, 1.0),
    ),
    KPI(
        "total_margin", "Total margin", "Profitability", "pct", "higher",
        "Net Income / (Net Patient Revenue + Total Other Income)",
        ("Net Income", "Net Patient Revenue", "Total Other Income"),
        "Bottom-line margin including non-operating income such as investments, grants, and "
        "appropriations.",
        (-2.0, 1.0),
    ),
    KPI(
        "opex_per_adj_discharge", "Operating expense per adjusted discharge", "Cost efficiency", "usd", "lower",
        "Total Operating Expense / Adjusted Discharges, where Adjusted Discharges = Discharges x "
        "(Total Charges / Inpatient Charges)",
        ("Less Total Operating Expense", "Total Discharges (V + XVIII + XIX + Unknown)",
         "Combined Outpatient + Inpatient Total Charges", "Inpatient Total Charges"),
        "Cost of one unit of patient care, scaled up to include outpatient volume. The standard "
        "unit-cost benchmark for hospitals.",
        (100.0, 1_000_000.0),
    ),
    KPI(
        "npr_per_adj_discharge", "Net patient revenue per adjusted discharge", "Revenue", "usd", "higher",
        "Net Patient Revenue / Adjusted Discharges",
        ("Net Patient Revenue", "Total Discharges (V + XVIII + XIX + Unknown)",
         "Combined Outpatient + Inpatient Total Charges", "Inpatient Total Charges"),
        "Revenue collected per unit of patient care. Reflects payer mix, case mix, and pricing.",
        (100.0, 1_000_000.0),
    ),
    KPI(
        "labor_cost_share", "Salary cost share", "Cost efficiency", "pct", None,
        "Total Salaries From Worksheet A / Total Costs",
        ("Total Salaries From Worksheet A", "Total Costs"),
        "Share of total costs that is salaries. Interpreted with staffing productivity, since a high "
        "share can mean employed staff instead of contract labor.",
        (0.0, 1.0),
    ),
    KPI(
        "contract_labor_ratio", "Contract labor to salaries", "Workforce", "pct", "lower",
        "Contract Labor: Direct Patient Care / Total Salaries From Worksheet A",
        ("Contract Labor: Direct Patient Care", "Total Salaries From Worksheet A"),
        "Reliance on agency or contract staff for direct patient care. Contract labor usually costs "
        "more per hour than employed staff.",
        (0.0, 5.0),
    ),
    KPI(
        "fte_per_adj_occupied_bed", "FTEs per adjusted occupied bed", "Workforce", "ratio", "lower",
        "FTE Employees on Payroll / (Adjusted Patient Days / Days in Period), where Adjusted Patient "
        "Days = Total Days x (Total Charges / Inpatient Charges)",
        ("FTE - Employees on Payroll", "Total Days (V + XVIII + XIX + Unknown)",
         "Combined Outpatient + Inpatient Total Charges", "Inpatient Total Charges"),
        "Staffing intensity: payroll FTEs per occupied bed, adjusted for outpatient work. Lower "
        "means more productive staffing, but very low values can signal under-staffing.",
        (0.1, 100.0),
    ),
    KPI(
        "occupancy_rate", "Occupancy rate", "Capacity", "pct", "higher",
        "Hospital Total Days For Adults & Peds / Hospital Total Bed Days Available For Adults & Peds",
        ("Hospital Total Days (V + XVIII + XIX + Unknown) For Adults & Peds",
         "Hospital Total Bed Days Available For Adults & Peds"),
        "Share of staffed adult and pediatric bed capacity in use. Low occupancy spreads fixed costs "
        "over fewer patients; above about 85% signals capacity strain.",
        (0.0, 1.5),
    ),
    KPI(
        "alos", "Average length of stay", "Capacity", "days", "lower",
        "Hospital Total Days For Adults & Peds / Hospital Total Discharges For Adults & Peds",
        ("Hospital Total Days (V + XVIII + XIX + Unknown) For Adults & Peds",
         "Hospital Total Discharges (V + XVIII + XIX + Unknown) For Adults & Peds"),
        "Average inpatient days per stay. Shorter stays free capacity and lower cost per case, "
        "within the limits of patient acuity.",
        (0.5, 365.0),
    ),
    KPI(
        "cost_to_charge_ratio", "Cost-to-charge ratio", "Revenue", "ratio", None,
        "Cost To Charge Ratio as reported; if blank, Total Costs / Combined Total Charges",
        ("Cost To Charge Ratio", "Total Costs", "Combined Outpatient + Inpatient Total Charges"),
        "Cost per dollar of gross charges. A low ratio means list prices are set far above cost.",
        (0.01, 5.0),
    ),
    KPI(
        "contractual_allowance_pct", "Contractual allowance rate", "Revenue", "pct", None,
        "Contractual Allowance and Discounts / Total Patient Revenue",
        ("Less Contractual Allowance and Discounts on Patients' Accounts", "Total Patient Revenue"),
        "Share of gross charges written off for payer contracts and discounts. Mostly driven by "
        "chargemaster pricing and payer mix.",
        (0.0, 1.0),
    ),
    KPI(
        "uncompensated_care_pct", "Uncompensated care burden", "Community benefit", "pct", None,
        "Cost of Uncompensated Care / Total Operating Expense",
        ("Cost of Uncompensated Care", "Less Total Operating Expense"),
        "Cost of charity care and bad debt relative to operating expense. A mission measure, not an "
        "efficiency target.",
        (0.0, 1.0),
    ),
    KPI(
        "medicare_day_share", "Medicare share of days", "Payer mix", "pct", None,
        "Total Days Title XVIII / Total Days",
        ("Total Days Title XVIII", "Total Days (V + XVIII + XIX + Unknown)"),
        "Share of inpatient days paid by Medicare (Title XVIII).",
        (0.0, 1.0),
    ),
    KPI(
        "medicaid_day_share", "Medicaid share of days", "Payer mix", "pct", None,
        "Total Days Title XIX / Total Days",
        ("Total Days Title XIX", "Total Days (V + XVIII + XIX + Unknown)"),
        "Share of inpatient days paid by Medicaid (Title XIX). High shares usually pressure margins.",
        (0.0, 1.0),
    ),
    KPI(
        "outpatient_revenue_share", "Outpatient share of charges", "Payer mix", "pct", None,
        "Outpatient Total Charges / Combined Outpatient + Inpatient Total Charges",
        ("Outpatient Total Charges", "Combined Outpatient + Inpatient Total Charges"),
        "How much of the hospital's business is outpatient.",
        (0.0, 1.0),
    ),
    KPI(
        "days_cash_on_hand", "Days cash on hand", "Liquidity", "days", "higher",
        "(Cash on Hand and in Banks + Temporary Investments) / ((Total Operating Expense - "
        "Depreciation Cost) / Days in Period)",
        ("Cash on Hand and in Banks", "Temporary Investments", "Less Total Operating Expense",
         "Depreciation Cost"),
        "How many days the hospital could pay its cash operating expenses from cash and short-term "
        "investments. Rating agencies watch this closely.",
        (0.0, 2000.0),
    ),
    KPI(
        "current_ratio", "Current ratio", "Liquidity", "ratio", "higher",
        "Total Current Assets / Total Current Liabilities",
        ("Total Current Assets", "Total Current Liabilities"),
        "Short-term assets available per dollar of short-term obligations.",
        (0.0, 100.0),
    ),
    KPI(
        "days_in_ar", "Days in accounts receivable", "Revenue cycle", "days", "lower",
        "(Accounts Receivable + Allowances for Uncollectible Accounts) / (Net Patient Revenue / Days "
        "in Period)",
        ("Accounts Receivable", "Less: Allowances for Uncollectible Notes and Accounts Receivable",
         "Net Patient Revenue"),
        "How long it takes to collect patient revenue. Fewer days means a faster revenue cycle and "
        "more cash.",
        (0.0, 365.0),
    ),
    KPI(
        "debt_to_assets", "Liabilities to assets", "Solvency", "ratio", "lower",
        "Total Liabilities / Total Assets",
        ("Total Liabilities", "Total Assets"),
        "Leverage: share of assets financed by liabilities.",
        (0.0, 10.0),
    ),
]

KPI_BY_KEY: dict[str, KPI] = {k.key: k for k in KPIS}
KPI_KEYS: list[str] = [k.key for k in KPIS]


def format_value(key: str, value: float | None) -> str:
    """Human-readable formatting for a KPI value (used by UI, narrator, and tools)."""
    if value is None or value != value:
        return "n/a"
    unit = KPI_BY_KEY[key].unit if key in KPI_BY_KEY else "ratio"
    if unit == "pct":
        return f"{value * 100:.1f}%"
    if unit == "usd":
        return f"${value:,.0f}"
    if unit == "days":
        return f"{value:.1f} days"
    if unit == "count":
        return f"{value:,.0f}"
    return f"{value:.2f}"


def format_usd(value: float | None) -> str:
    if value is None or value != value:
        return "n/a"
    sign = "-" if value < 0 else ""
    v = abs(value)
    if v >= 1e9:
        return f"{sign}${v / 1e9:.2f}B"
    if v >= 1e6:
        return f"{sign}${v / 1e6:.1f}M"
    if v >= 1e3:
        return f"{sign}${v / 1e3:.0f}K"
    return f"{sign}${v:,.0f}"


def glossary_markdown() -> str:
    """Render the KPI catalogue as Markdown. Indexed by the RAG layer and shipped in docs/."""
    lines = ["# KPI glossary", "",
             "Every metric in Hospital Ops Copilot, with its formula and source fields from the CMS "
             "Hospital Provider Cost Report (form CMS-2552-10).", ""]
    for k in KPIS:
        better = {"higher": "Higher is better.", "lower": "Lower is better."}.get(
            k.direction or "", "Neither direction is better by default; interpret in context.")
        lines += [
            f"## {k.label} ({k.key})",
            "",
            f"Category: {k.category}. Unit: {k.unit}. {better}",
            "",
            k.description,
            "",
            f"Formula: {k.formula}.",
            "",
            "CMS source fields: " + "; ".join(k.fields) + ".",
            "",
        ]
    return "\n".join(lines)
