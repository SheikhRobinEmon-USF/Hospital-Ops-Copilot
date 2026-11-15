# Benchmarking methodology

This page explains how Hospital Ops Copilot turns public CMS cost reports into benchmarks. The
copilot's retrieval layer indexes this page, so the assistant can cite it when it explains a result.

## Data source

All financial and operating data comes from the CMS Hospital Provider Cost Report public use file.
CMS builds it from the Healthcare Provider Cost Reporting Information System (HCRIS). Every
Medicare-certified hospital files a cost report each year on form CMS-2552-10. The file includes
facility characteristics, utilization, costs and charges, and financial statement data. CMS
publishes the data unedited, as hospitals submitted it. Cost reports are not audited financial
statements, and some fields are blank or misreported.

Each yearly file is labeled with a cost report year. Most reports in a file have fiscal years that
begin in that year. Hospitals use different fiscal year ends (for example June 30, September 30, or
December 31), so a "2023" report can cover different months for different hospitals.

## Hospital identity

Hospitals are identified by their six-digit CMS Certification Number (CCN). The CCN encodes the
state (first two digits) and the facility type (last four digits). CMS converts the facility type
to acronyms: STH is a short-term acute care hospital, CAH a critical access hospital, PH
psychiatric, RH rehabilitation, LTCH long-term care, and CH children's.

## Urban and rural indicator

The urban/rural field is the hospital's Medicare indicator from the cost report, not a geographic
classification. Some hospitals in metropolitan areas reclassify as rural for Medicare payment
purposes (42 CFR 412.103), so a large city hospital can show as rural. Treat the urban/rural peer
dimension with that in mind.

## Cleaning rules

1. One report per hospital per year. If a hospital filed more than one report for a year (for
   example after a change of ownership), the copilot keeps the report with the longest reporting
   period, then the latest end date.
2. Reports covering fewer than 300 days are flagged `partial_year`. They are shown for the
   hospital itself but excluded from every peer group.
3. KPI values outside a plausible range (for example an operating margin below -200% or an
   occupancy rate above 150%) are treated as reporting errors. The value is set to missing and the
   KPI name is recorded in the report's data quality flags.
4. Volume is adjusted for outpatient work. Adjusted discharges equal discharges times the ratio of
   total charges to inpatient charges. Adjusted patient days use the same factor. This is the
   standard industry approach to comparing hospitals with different outpatient mixes.

## Peer groups

A benchmark compares a hospital with peers from the same cost report year. By default, peers share
the hospital's facility type and bed size band (1-25, 26-99, 100-299, 300-499, or 500+ beds). Users
can add state, ownership (nonprofit, for-profit, government), and urban or rural location.

If a peer group has fewer than 10 hospitals, the copilot relaxes it, dropping dimensions in this
order: state, ownership, urban/rural, bed size. The benchmark output always states the final peer
definition, the number of peers, and any dimensions that were relaxed.

## Percentiles and status

For each KPI the copilot reports the peer 25th percentile, median, and 75th percentile, and the
hospital's percentile rank (the share of peers with a lower value). Status labels:

- "in line with peers": inside the interquartile range (25th to 75th percentile).
- "better than peers" or "worse than peers": outside the range, for KPIs with a clear favorable
  direction (for example lower cost per adjusted discharge is better).
- "above peer range" or "below peer range": outside the range for KPIs where neither direction is
  better, such as payer mix or uncompensated care.

Percentiles are descriptive. A 75th percentile cost does not prove inefficiency; it tells you where
to look.

## Opportunity sizing

Opportunity sizing converts a gap to the peer median (or to the top quartile) into dollars:

- Unit cost: (current - target operating expense per adjusted discharge) x adjusted discharges.
- Staffing productivity: FTEs above the target FTEs per adjusted occupied bed, times the average
  salary per FTE (total salaries divided by FTEs). Benefits are excluded.
- Contract labor: the contract labor spend above the target ratio, times an assumed 25% premium
  for contract over employed staff.
- Revenue cycle: (current - target days in accounts receivable) x daily net patient revenue. This
  is a one-time cash release, not recurring savings.
- Length of stay: bed days freed by reaching the target average length of stay. Reported as
  capacity, not dollars, because the value depends on whether freed beds are refilled.
- Revenue yield: (target - current net patient revenue per adjusted discharge) x adjusted
  discharges. Largely driven by payer mix and contracts, so treat it as an upper bound.

Staffing and contract labor gaps are part of the unit-cost gap, so they are not added to it. The
headline recurring savings figure is the larger of the unit-cost gap and the combined labor gaps.

None of these estimates adjust for case mix, teaching status, or service lines. Academic medical
centers, trauma centers, and transplant programs have structurally higher costs per case than
community peers.

## What-if scenarios

The scenario tool projects the operating margin from five levers:

- revenue = net patient revenue x (1 + volume change) x (1 + rate change)
- expense = operating expense x (1 + variable cost share x volume change + operating expense
  change) + salaries x labor cost change

The default variable cost share is 35%: when volume rises 10%, operating expense rises 3.5%. This is
a planning approximation; hospitals with detailed cost accounting should replace it with their own
figure.

## Trends

Trends show each KPI for every available year next to that year's peer median, plus the change
from the first to the last year. Percentage KPIs change in percentage points; other KPIs change in
percent.

## Limitations

- Cost reports lag. The most recent file has incomplete coverage, because hospitals file five
  months after fiscal year end and CMS processes them later.
- Cost reports are filed by individual hospitals. Health systems that share costs across
  facilities can show distorted single-hospital results.
- There is no case mix index in this file, so cost per case cannot be adjusted for acuity.
- Balance sheet fields (cash, receivables, liabilities) are often blank or reported at the system
  level, so liquidity KPIs have lower coverage.
