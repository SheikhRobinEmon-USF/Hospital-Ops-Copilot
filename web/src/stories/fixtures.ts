import type { KpiDef, KpiRow } from "@/lib/api";

/** Realistic fixtures (Tampa General Hospital, cost report 2023) for component stories. */

export const marginRow: KpiRow = {
  kpi: "operating_margin",
  label: "Operating margin (patient services)",
  category: "Profitability",
  value: -0.1,
  value_fmt: "-10.0%",
  peer_median: -0.021,
  peer_median_fmt: "-2.1%",
  peer_p25: -0.114,
  peer_p75: 0.066,
  peer_range_fmt: "-11.4% to 6.6%",
  percentile: 27.1,
  peers_with_data: 258,
  direction: "higher",
  status: "in line with peers",
};

export const occupancyRow: KpiRow = {
  ...marginRow,
  kpi: "occupancy_rate",
  label: "Occupancy rate",
  category: "Capacity",
  value: 0.848,
  value_fmt: "84.8%",
  peer_median: 0.764,
  peer_median_fmt: "76.4%",
  peer_range_fmt: "67.5% to 84.8%",
  percentile: 75,
  status: "better than peers",
};

export const arRow: KpiRow = {
  ...marginRow,
  kpi: "days_in_ar",
  label: "Days in accounts receivable",
  category: "Revenue cycle",
  value: 66.5,
  value_fmt: "66.5 days",
  peer_median: 51.5,
  peer_median_fmt: "51.5 days",
  peer_range_fmt: "45.6 days to 60.1 days",
  percentile: 84,
  direction: "lower",
  status: "worse than peers",
};

export const marginDef: KpiDef = {
  key: "operating_margin",
  label: "Operating margin (patient services)",
  category: "Profitability",
  unit: "pct",
  direction: "higher",
  formula: "(Net Patient Revenue - Total Operating Expense) / Net Patient Revenue",
  fields: ["Net Patient Revenue", "Less Total Operating Expense"],
  description: "Share of net patient revenue left after paying operating expenses.",
};

export const arDef: KpiDef = { ...marginDef, key: "days_in_ar", label: "Days in accounts receivable", unit: "days", direction: "lower", formula: "(AR + allowance) / (NPR / days)", description: "How long it takes to collect patient revenue." };
