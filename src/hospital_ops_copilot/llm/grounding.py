"""Numeric grounding check: every number in an answer must trace back to a tool output.

LLMs, especially small ones, misstate numbers. This verifier extracts each number from the final
answer (percentages, dollar amounts with K/M/B suffixes, plain figures) and searches for it in the
data the tools returned. It accepts unit conversions (a ratio 0.084 shown as 8.4%), display
rounding, and simple differences between sibling values (for example "2.1 points above the median").
Numbers it cannot trace are reported as ungrounded and highlighted in the UI.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

_NUM = re.compile(
    r"(?P<neg>[-−])?(?P<cur>\$)?(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
    r"\s?(?P<suf>%|percent(?:age points?)?|pp\b|points?\b|[kKmMbB]\b|million\b|billion\b|thousand\b)?"
)
_SCALE = {"k": 1e3, "thousand": 1e3, "m": 1e6, "million": 1e6, "b": 1e9, "billion": 1e9}
_STR_NUM = re.compile(r"-?\$?\d[\d,]*(?:\.\d+)?\s?(?:%|[KMB]\b| days)?")


@dataclass
class NumberClaim:
    text: str
    value: float
    grounded: bool


@dataclass
class GroundingReport:
    claims: list[NumberClaim] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.claims)

    @property
    def grounded(self) -> int:
        return sum(c.grounded for c in self.claims)

    @property
    def score(self) -> float:
        return 1.0 if not self.claims else self.grounded / self.total

    @property
    def ungrounded(self) -> list[str]:
        return [c.text for c in self.claims if not c.grounded]

    def to_dict(self) -> dict:
        return {"numbers_checked": self.total, "numbers_grounded": self.grounded, "score": round(self.score, 3),
                "ungrounded": self.ungrounded}


def _parse_str_number(s: str) -> float | None:
    m = _NUM.search(s)
    if not m:
        return None
    v = float(m.group("num").replace(",", ""))
    if m.group("neg"):
        v = -v
    suf = (m.group("suf") or "").lower()
    if suf in _SCALE:
        v *= _SCALE[suf]
    if suf == "%":
        v /= 100
    return v


def _collect(obj: Any, out: list[float]) -> None:
    """Gather evidence numbers from tool data, plus differences between sibling numbers."""
    if isinstance(obj, bool):
        return
    if isinstance(obj, (int, float)):
        out.append(float(obj))
        return
    if isinstance(obj, str):
        for m in _STR_NUM.finditer(obj):
            v = _parse_str_number(m.group(0))
            if v is not None:
                out.append(v)
        return
    if isinstance(obj, dict):
        siblings = []
        for v in obj.values():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                siblings.append(float(v))
            elif isinstance(v, str) and len(v) < 40:
                p = _parse_str_number(v)
                if p is not None:
                    siblings.append(p)
        if 1 < len(siblings) <= 12:
            for i, a in enumerate(siblings):
                for b in siblings[i + 1:]:
                    out.append(a - b)
                    out.append(b - a)
        for v in obj.values():
            _collect(v, out)
        return
    if isinstance(obj, (list, tuple)):
        for v in obj:
            _collect(v, out)


def evidence_numbers(tool_data: list[Any]) -> list[float]:
    out: list[float] = []
    for d in tool_data:
        if isinstance(d, str):
            try:
                d = json.loads(d)
            except json.JSONDecodeError:
                pass
        _collect(d, out)
    return out


_MONTHS = r"(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)"
_DATE_BEFORE = re.compile(_MONTHS + r"\.?\s+$", re.I)
_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def is_date_context(answer: str, start: int, end: int) -> bool:
    """True when the number at answer[start:end] is part of a date (September 30, 2023-09-30)."""
    if _DATE_BEFORE.search(answer[max(0, start - 12):start]):
        return True
    return any(m.start() <= start < m.end() for m in _ISO_DATE.finditer(answer))


def _skip(text: str, value: float, start: int, answer: str) -> bool:
    """Ignore numbers that are not quantitative claims."""
    if is_date_context(answer, start, start + len(text)):
        return True
    raw = text.strip().lstrip("$-−")
    if re.fullmatch(r"(19|20)\d\d", raw):  # years
        return True
    if re.fullmatch(r"\d{6}", raw):  # CCNs
        return True
    line_start = answer.rfind("\n", 0, start) + 1
    prefix = answer[line_start:start].strip()
    if prefix in ("", "-", "*") and re.match(r"\d+[.)]", answer[start:start + 4]):  # list numbering
        return True
    if "." not in raw and "," not in raw and abs(value) <= 12 and "%" not in text and "$" not in text:
        return True  # small counts such as "3 areas"; low risk and noisy to verify
    return False


def check(answer: str, tool_data: list[Any], rel_tol: float = 0.001) -> GroundingReport:
    ev = evidence_numbers(tool_data)
    # Pre-compute representations: raw, as percent, and per-thousand/million/billion.
    reps = set()
    for e in ev:
        for f in (1, 100, 1e-3, 1e-6, 1e-9):
            reps.add(round(e * f, 6))
    reps_list = sorted(reps)
    report = GroundingReport()
    for m in _NUM.finditer(answer):
        text = m.group(0)
        num = m.group("num").replace(",", "")
        v = float(num)
        if m.group("neg"):
            v = -v
        if _skip(text, v, m.start(), answer):
            continue
        suf = (m.group("suf") or "").lower()
        scale = _SCALE.get(suf, 1)
        decimals = len(num.split(".")[1]) if "." in num else 0
        display_tol = 0.5 * 10 ** (-decimals) + 1e-9
        target = v * scale
        tol_abs = display_tol * scale
        ok = any(next(_near(reps_list, cand, max(tol_abs, abs(cand) * rel_tol)), None) is not None
                 for cand in (target, abs(target)))
        report.claims.append(NumberClaim(text.strip(), target, ok))
    return report


def _near(sorted_vals: list[float], x: float, tol: float):
    import bisect
    i = bisect.bisect_left(sorted_vals, x - tol)
    while i < len(sorted_vals) and sorted_vals[i] <= x + tol:
        yield sorted_vals[i]
        i += 1
