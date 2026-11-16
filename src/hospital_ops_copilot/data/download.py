"""Download CMS Hospital Provider Cost Report files from the data.cms.gov catalog.

The catalog (``https://data.cms.gov/data.json``) is a DCAT-US feed. Each yearly release of the
"Hospital Provider Cost Report" dataset is a separate entry whose distributions include a CSV
download URL. We resolve URLs from the catalog at run time instead of hard-coding them, because
CMS re-publishes files under new paths when it refreshes a year.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

import httpx

from ..config import Settings, get_settings

log = logging.getLogger(__name__)

CATALOG_URL = "https://data.cms.gov/data.json"
DATASET_TITLE = "Hospital Provider Cost Report"
DOC_URLS = {
    "cms_cost_report_data_dictionary.pdf": "https://data.cms.gov/sites/default/files/2024-03/9756088d-5280-4090-80b9-449d31ef25a3/Cost%20Report%20Data%20Dictionary%20Update.pdf",
    "cms_cost_report_methodology.pdf": "https://data.cms.gov/sites/default/files/2025-11/52f16e92-594a-4062-9661-2b80aed1f322/Hospital%20Provider%20Cost%20Report%20Methodology.pdf",
}

_CSV_RE = re.compile(r"CostReport_(\d{4})_Final\.csv$", re.IGNORECASE)


def resolve_csv_urls(client: httpx.Client) -> dict[int, str]:
    """Return {year: csv_url} for every yearly Hospital Provider Cost Report in the catalog."""
    resp = client.get(CATALOG_URL)
    resp.raise_for_status()
    urls: dict[int, str] = {}
    for ds in resp.json().get("dataset", []):
        if not ds.get("title", "").startswith(DATASET_TITLE):
            continue
        for dist in ds.get("distribution", []):
            url = dist.get("downloadURL") or dist.get("accessURL") or ""
            m = _CSV_RE.search(url)
            if m:
                urls[int(m.group(1))] = url
    return urls


def _fetch(client: httpx.Client, url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with client.stream("GET", url) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
    tmp.replace(dest)


def download(years: list[int] | None = None, settings: Settings | None = None, force: bool = False) -> list[Path]:
    settings = settings or get_settings()
    years = list(years or settings.years)
    out: list[Path] = []
    with httpx.Client(timeout=300, follow_redirects=True) as client:
        urls = resolve_csv_urls(client)
        missing = [y for y in years if y not in urls]
        if missing:
            raise RuntimeError(f"Years not found in CMS catalog: {missing}. Available: {sorted(urls)}")
        for year in years:
            dest = settings.raw_dir / f"CostReport_{year}_Final.csv"
            if dest.exists() and not force:
                log.info("exists: %s", dest)
            else:
                log.info("downloading %s -> %s", urls[year], dest)
                _fetch(client, urls[year], dest)
            out.append(dest)
        src_dir = settings.docs_dir / "sources"
        for name, url in DOC_URLS.items():
            dest = src_dir / name
            if not dest.exists() or force:
                log.info("downloading %s", name)
                _fetch(client, url, dest)
    return out
