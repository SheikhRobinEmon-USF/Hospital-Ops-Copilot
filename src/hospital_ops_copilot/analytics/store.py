"""Data access: loads the processed hospital-year table once and serves lookups and SQL."""

from __future__ import annotations

import re
import threading
from functools import cached_property

import duckdb
import pandas as pd

from ..config import Settings, get_settings

SOURCE_NAME = "CMS Hospital Provider Cost Report (HCRIS, form CMS-2552-10)"
SOURCE_URL = "https://data.cms.gov/provider-compliance/cost-report/hospital-provider-cost-report"

_STOP = {"hospital", "medical", "center", "the", "of", "and", "health", "regional", "memorial", "inc"}


def _bigrams(text: str) -> list[str]:
    t = re.sub(r"\s+", " ", text.strip())
    return [t[i:i + 2] for i in range(len(t) - 1)]


def _similarity(a: str, b: str) -> float:
    """Dice coefficient over character bigrams (multiset), in [0, 1]."""
    x, y = _bigrams(a), _bigrams(b)
    if not x or not y:
        return 0.0
    pool: dict[str, int] = {}
    for g in y:
        pool[g] = pool.get(g, 0) + 1
    common = 0
    for g in x:
        if pool.get(g, 0) > 0:
            pool[g] -= 1
            common += 1
    return 2.0 * common / (len(x) + len(y))


def _tokens(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t]


class DataStore:
    def __init__(self, df: pd.DataFrame | None = None, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self._df = df
        self._lock = threading.Lock()

    @cached_property
    def df(self) -> pd.DataFrame:
        if self._df is not None:
            return self._df
        path = self.settings.kpi_path
        if not path.exists():
            raise FileNotFoundError(f"{path} not found. Run `hoc download` and `hoc build` first.")
        return pd.read_parquet(path)

    @cached_property
    def con(self) -> duckdb.DuckDBPyConnection:
        con = duckdb.connect(":memory:")
        con.register("hospital_year", self.df)
        return con

    def sql(self, query: str, params: list | None = None) -> pd.DataFrame:
        with self._lock:
            return self.con.execute(query, params or []).df()

    @cached_property
    def years(self) -> list[int]:
        return sorted(int(y) for y in self.df["year"].unique())

    @property
    def latest_year(self) -> int:
        return self.years[-1]

    @cached_property
    def _directory(self) -> pd.DataFrame:
        """One row per hospital: its most recent report."""
        d = self.df.sort_values(["ccn", "year"], kind="mergesort").groupby("ccn", as_index=False).tail(1)
        d = d[["ccn", "name", "city", "state", "facility_type", "facility_type_desc", "beds", "year"]]
        d = d.rename(columns={"year": "latest_year"}).reset_index(drop=True)
        d["_tokens"] = d["name"].map(lambda n: set(_tokens(n)))
        return d

    def get(self, ccn: str, year: int | None = None) -> pd.Series | None:
        ccn = str(ccn).strip().zfill(6)
        rows = self.df[self.df["ccn"] == ccn]
        if rows.empty:
            return None
        if year is None:
            return rows.sort_values("year").iloc[-1]
        rows = rows[rows["year"] == int(year)]
        return None if rows.empty else rows.iloc[0]

    def history(self, ccn: str) -> pd.DataFrame:
        ccn = str(ccn).strip().zfill(6)
        return self.df[self.df["ccn"] == ccn].sort_values("year")

    def search(self, query: str, state: str | None = None, limit: int = 10) -> list[dict]:
        """Find hospitals by CCN, name, or city. Token overlap first, then fuzzy matching."""
        d = self._directory
        if state:
            d = d[d["state"] == state.strip().upper()]
        q = query.strip()
        if re.fullmatch(r"\d{5,6}", q):
            hit = d[d["ccn"] == q.zfill(6)]
            if not hit.empty:
                return _records(hit)
        q_tokens = [t for t in _tokens(q) if t not in _STOP] or _tokens(q)
        if not q_tokens:
            return []
        city = d["city"].str.lower()

        def score(row_tokens: set[str], row_city: str) -> float:
            s = 0.0
            for t in q_tokens:
                if t in row_tokens:
                    s += 2.0
                elif any(rt.startswith(t) for rt in row_tokens if len(t) >= 3):
                    s += 1.0
                elif t in row_city:
                    s += 0.75
            return s

        scores = [score(toks, c) for toks, c in zip(d["_tokens"], city, strict=True)]
        d = d.assign(_score=scores)
        best = max(scores) if scores else 0
        hits = d[(d["_score"] > 0) & (d["_score"] >= best * 0.6)]
        hits = hits.sort_values(["_score", "beds", "ccn"], ascending=[False, False, True], kind="mergesort",
                                na_position="last")
        if hits.empty:
            # Typo-tolerant fallback: character-bigram similarity (Dice coefficient) with the full query.
            sims = [_similarity(q.upper(), n) for n in d["name"]]
            d = d.assign(_sim=sims)
            hits = d[d["_sim"] >= 0.6].sort_values(["_sim", "ccn"], ascending=[False, True], kind="mergesort")
        return _records(hits.head(limit))


def _records(d: pd.DataFrame) -> list[dict]:
    cols = ["ccn", "name", "city", "state", "facility_type", "facility_type_desc", "beds", "latest_year"]
    out = d[cols].to_dict("records")
    for r in out:
        r["beds"] = None if r["beds"] != r["beds"] else int(r["beds"])
        r["latest_year"] = int(r["latest_year"])
    return out


_store: DataStore | None = None


def get_store() -> DataStore:
    global _store
    if _store is None:
        _store = DataStore()
    return _store
