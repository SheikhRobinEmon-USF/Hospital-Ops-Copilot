"""Code lookups from the CMS Hospital Provider Cost Report data dictionary (form CMS-2552-10)."""

PROVIDER_TYPE = {
    1: "General Short Term (includes CAHs)",
    2: "General Long Term",
    3: "Cancer",
    4: "Psychiatric",
    5: "Rehabilitation",
    6: "Religious Non-Medical Health Care Institution",
    7: "Children",
    8: "Reserved for Future Use",
    9: "Other",
    10: "Extended Neoplastic Disease Care",
    11: "Indian Health Services",
    12: "Rural Emergency Hospital",
}

TYPE_OF_CONTROL = {
    1: "Voluntary Non-Profit, Church",
    2: "Voluntary Non-Profit, Other",
    3: "Proprietary, Individual",
    4: "Proprietary, Corporation",
    5: "Proprietary, Partnership",
    6: "Proprietary, Other",
    7: "Governmental, Federal",
    8: "Governmental, City-County",
    9: "Governmental, County",
    10: "Governmental, State",
    11: "Governmental, Hospital District",
    12: "Governmental, City",
    13: "Governmental, Other",
}


def ownership_group(control_code: int | None) -> str:
    """Collapse the 13 CMS control codes into three ownership groups used for peering."""
    if control_code is None:
        return "Unknown"
    if control_code in (1, 2):
        return "Nonprofit"
    if 3 <= control_code <= 6:
        return "For-profit"
    if 7 <= control_code <= 13:
        return "Government"
    return "Unknown"


FACILITY_TYPE = {
    "STH": "Short-Term (Acute Care) Hospital",
    "CAH": "Critical Access Hospital",
    "PH": "Psychiatric Hospital",
    "RH": "Rehabilitation Hospital",
    "LTCH": "Long-Term Care Hospital",
    "CH": "Children's Hospital",
    "RNMHC": "Religious Non-Medical Health Care Institution",
    "ORD": "Other / Reserved",
    "TC": "Transplant Center",
    "REH": "Rural Emergency Hospital",
}

# Bed-size bands used for peer grouping.
BED_BANDS: list[tuple[int, int, str]] = [
    (0, 25, "1-25 beds"),
    (26, 99, "26-99 beds"),
    (100, 299, "100-299 beds"),
    (300, 499, "300-499 beds"),
    (500, 100_000, "500+ beds"),
]


def bed_band(beds: float | None) -> str:
    if beds is None or beds != beds or beds <= 0:  # NaN check without numpy
        return "Unknown"
    for lo, hi, label in BED_BANDS:
        if lo <= beds <= hi:
            return label
    return "Unknown"
