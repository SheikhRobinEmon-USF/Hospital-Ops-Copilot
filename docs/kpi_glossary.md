# KPI glossary

Every metric in Hospital Ops Copilot, with its formula and source fields from the CMS Hospital Provider Cost Report (form CMS-2552-10).

## Operating margin (patient services) (operating_margin)

Category: Profitability. Unit: pct. Higher is better.

Share of net patient revenue left after paying operating expenses. Shows whether patient care covers its cost. Cost reports put other operating revenue (grants, cafeteria, retail pharmacy, appropriations) in Total Other Income, so this margin is often negative even for profitable hospitals; read it with the total margin.

Formula: (Net Patient Revenue - Total Operating Expense) / Net Patient Revenue.

CMS source fields: Net Patient Revenue; Less Total Operating Expense.

## Total margin (total_margin)

Category: Profitability. Unit: pct. Higher is better.

Bottom-line margin including non-operating income such as investments, grants, and appropriations.

Formula: Net Income / (Net Patient Revenue + Total Other Income).

CMS source fields: Net Income; Net Patient Revenue; Total Other Income.

## Operating expense per adjusted discharge (opex_per_adj_discharge)

Category: Cost efficiency. Unit: usd. Lower is better.

Cost of one unit of patient care, scaled up to include outpatient volume. The standard unit-cost benchmark for hospitals.

Formula: Total Operating Expense / Adjusted Discharges, where Adjusted Discharges = Discharges x (Total Charges / Inpatient Charges).

CMS source fields: Less Total Operating Expense; Total Discharges (V + XVIII + XIX + Unknown); Combined Outpatient + Inpatient Total Charges; Inpatient Total Charges.

## Net patient revenue per adjusted discharge (npr_per_adj_discharge)

Category: Revenue. Unit: usd. Higher is better.

Revenue collected per unit of patient care. Reflects payer mix, case mix, and pricing.

Formula: Net Patient Revenue / Adjusted Discharges.

CMS source fields: Net Patient Revenue; Total Discharges (V + XVIII + XIX + Unknown); Combined Outpatient + Inpatient Total Charges; Inpatient Total Charges.

## Salary cost share (labor_cost_share)

Category: Cost efficiency. Unit: pct. Neither direction is better by default; interpret in context.

Share of total costs that is salaries. Interpreted with staffing productivity, since a high share can mean employed staff instead of contract labor.

Formula: Total Salaries From Worksheet A / Total Costs.

CMS source fields: Total Salaries From Worksheet A; Total Costs.

## Contract labor to salaries (contract_labor_ratio)

Category: Workforce. Unit: pct. Lower is better.

Reliance on agency or contract staff for direct patient care. Contract labor usually costs more per hour than employed staff.

Formula: Contract Labor: Direct Patient Care / Total Salaries From Worksheet A.

CMS source fields: Contract Labor: Direct Patient Care; Total Salaries From Worksheet A.

## FTEs per adjusted occupied bed (fte_per_adj_occupied_bed)

Category: Workforce. Unit: ratio. Lower is better.

Staffing intensity: payroll FTEs per occupied bed, adjusted for outpatient work. Lower means more productive staffing, but very low values can signal under-staffing.

Formula: FTE Employees on Payroll / (Adjusted Patient Days / Days in Period), where Adjusted Patient Days = Total Days x (Total Charges / Inpatient Charges).

CMS source fields: FTE - Employees on Payroll; Total Days (V + XVIII + XIX + Unknown); Combined Outpatient + Inpatient Total Charges; Inpatient Total Charges.

## Occupancy rate (occupancy_rate)

Category: Capacity. Unit: pct. Higher is better.

Share of staffed adult and pediatric bed capacity in use. Low occupancy spreads fixed costs over fewer patients; above about 85% signals capacity strain.

Formula: Hospital Total Days For Adults & Peds / Hospital Total Bed Days Available For Adults & Peds.

CMS source fields: Hospital Total Days (V + XVIII + XIX + Unknown) For Adults & Peds; Hospital Total Bed Days Available For Adults & Peds.

## Average length of stay (alos)

Category: Capacity. Unit: days. Lower is better.

Average inpatient days per stay. Shorter stays free capacity and lower cost per case, within the limits of patient acuity.

Formula: Hospital Total Days For Adults & Peds / Hospital Total Discharges For Adults & Peds.

CMS source fields: Hospital Total Days (V + XVIII + XIX + Unknown) For Adults & Peds; Hospital Total Discharges (V + XVIII + XIX + Unknown) For Adults & Peds.

## Cost-to-charge ratio (cost_to_charge_ratio)

Category: Revenue. Unit: ratio. Neither direction is better by default; interpret in context.

Cost per dollar of gross charges. A low ratio means list prices are set far above cost.

Formula: Cost To Charge Ratio as reported; if blank, Total Costs / Combined Total Charges.

CMS source fields: Cost To Charge Ratio; Total Costs; Combined Outpatient + Inpatient Total Charges.

## Contractual allowance rate (contractual_allowance_pct)

Category: Revenue. Unit: pct. Neither direction is better by default; interpret in context.

Share of gross charges written off for payer contracts and discounts. Mostly driven by chargemaster pricing and payer mix.

Formula: Contractual Allowance and Discounts / Total Patient Revenue.

CMS source fields: Less Contractual Allowance and Discounts on Patients' Accounts; Total Patient Revenue.

## Uncompensated care burden (uncompensated_care_pct)

Category: Community benefit. Unit: pct. Neither direction is better by default; interpret in context.

Cost of charity care and bad debt relative to operating expense. A mission measure, not an efficiency target.

Formula: Cost of Uncompensated Care / Total Operating Expense.

CMS source fields: Cost of Uncompensated Care; Less Total Operating Expense.

## Medicare share of days (medicare_day_share)

Category: Payer mix. Unit: pct. Neither direction is better by default; interpret in context.

Share of inpatient days paid by Medicare (Title XVIII).

Formula: Total Days Title XVIII / Total Days.

CMS source fields: Total Days Title XVIII; Total Days (V + XVIII + XIX + Unknown).

## Medicaid share of days (medicaid_day_share)

Category: Payer mix. Unit: pct. Neither direction is better by default; interpret in context.

Share of inpatient days paid by Medicaid (Title XIX). High shares usually pressure margins.

Formula: Total Days Title XIX / Total Days.

CMS source fields: Total Days Title XIX; Total Days (V + XVIII + XIX + Unknown).

## Outpatient share of charges (outpatient_revenue_share)

Category: Payer mix. Unit: pct. Neither direction is better by default; interpret in context.

How much of the hospital's business is outpatient.

Formula: Outpatient Total Charges / Combined Outpatient + Inpatient Total Charges.

CMS source fields: Outpatient Total Charges; Combined Outpatient + Inpatient Total Charges.

## Days cash on hand (days_cash_on_hand)

Category: Liquidity. Unit: days. Higher is better.

How many days the hospital could pay its cash operating expenses from cash and short-term investments. Rating agencies watch this closely.

Formula: (Cash on Hand and in Banks + Temporary Investments) / ((Total Operating Expense - Depreciation Cost) / Days in Period).

CMS source fields: Cash on Hand and in Banks; Temporary Investments; Less Total Operating Expense; Depreciation Cost.

## Current ratio (current_ratio)

Category: Liquidity. Unit: ratio. Higher is better.

Short-term assets available per dollar of short-term obligations.

Formula: Total Current Assets / Total Current Liabilities.

CMS source fields: Total Current Assets; Total Current Liabilities.

## Days in accounts receivable (days_in_ar)

Category: Revenue cycle. Unit: days. Lower is better.

How long it takes to collect patient revenue. Fewer days means a faster revenue cycle and more cash.

Formula: (Accounts Receivable + Allowances for Uncollectible Accounts) / (Net Patient Revenue / Days in Period).

CMS source fields: Accounts Receivable; Less: Allowances for Uncollectible Notes and Accounts Receivable; Net Patient Revenue.

## Liabilities to assets (debt_to_assets)

Category: Solvency. Unit: ratio. Lower is better.

Leverage: share of assets financed by liabilities.

Formula: Total Liabilities / Total Assets.

CMS source fields: Total Liabilities; Total Assets.
