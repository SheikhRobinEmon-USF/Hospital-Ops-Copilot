"""Build the retrieval corpus: KPI glossary, methodology, and CMS data dictionary entries."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path

from ..analytics.kpis import glossary_markdown
from ..config import Settings, get_settings
from ..data.build import COLUMNS

DICTIONARY_URL = "https://data.cms.gov/sites/default/files/2024-03/9756088d-5280-4090-80b9-449d31ef25a3/Cost%20Report%20Data%20Dictionary%20Update.pdf"


@dataclass(frozen=True)
class Chunk:
    id: str
    source: str
    title: str
    text: str
    url: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def _markdown_chunks(md: str, source: str, url: str, prefix: str) -> list[Chunk]:
    """Split Markdown on H2 headings; each section becomes one chunk."""
    chunks: list[Chunk] = []
    doc_title = ""
    sections = re.split(r"^## ", md, flags=re.M)
    head = sections[0].strip()
    m = re.match(r"# (.+)", head)
    if m:
        doc_title = m.group(1).strip()
    intro = re.sub(r"^# .+\n?", "", head).strip()
    if intro:
        chunks.append(Chunk(f"{prefix}-intro", source, doc_title, intro, url))
    for i, sec in enumerate(sections[1:], 1):
        title, _, body = sec.partition("\n")
        body = re.sub(r"\s+\n", "\n", body).strip()
        chunks.append(Chunk(f"{prefix}-{i:02d}", source, f"{doc_title}: {title.strip()}", body, url))
    return chunks


def _normalize_pdf_text(t: str) -> str:
    table = {"‐": "-", "‑": "-", "–": "-", "’": "'", "ﬁ": "fi", "ﬂ": "fl", "\xa0": " "}
    for a, b in table.items():
        t = t.replace(a, b)
    return t


def dictionary_chunks(text: str) -> list[Chunk]:
    """Split the CMS data dictionary into one chunk per variable, keyed by CSV column names."""
    text = _normalize_pdf_text(text)
    names = sorted({c for c in COLUMNS} | {"Rural versus Urban"}, key=len, reverse=True)
    pattern = re.compile(r"^(" + "|".join(re.escape(n) for n in names) + r")\s", re.M | re.I)
    starts = [(m.start(), m.group(1)) for m in pattern.finditer(text)]
    chunks: list[Chunk] = []
    seen: set[str] = set()
    for i, (pos, name) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(text)
        body = " ".join(text[pos:end].split())
        key = name.lower()
        if key in seen or len(body) < len(name) + 5:
            continue
        seen.add(key)
        slug = re.sub(r"[^a-z0-9]+", "-", key).strip("-")[:48]
        chunks.append(Chunk(f"dict-{slug}", "CMS Hospital Provider Cost Report Data Dictionary",
                            f"CMS data dictionary: {name}", body, DICTIONARY_URL))
    return chunks


def build_corpus(settings: Settings | None = None) -> list[Chunk]:
    settings = settings or get_settings()
    docs = settings.docs_dir
    chunks = _markdown_chunks(glossary_markdown(), "Hospital Ops Copilot KPI glossary", "docs/kpi_glossary.md", "kpi")
    method = docs / "methodology.md"
    if method.exists():
        chunks += _markdown_chunks(method.read_text(), "Hospital Ops Copilot methodology", "docs/methodology.md", "method")
    src = docs / "sources"
    dict_pdf = src / "cms_cost_report_data_dictionary.pdf"
    meth_pdf = src / "cms_cost_report_methodology.pdf"
    if dict_pdf.exists():
        chunks += dictionary_chunks(_pdf_text(dict_pdf))
    if meth_pdf.exists():
        body = " ".join(_normalize_pdf_text(_pdf_text(meth_pdf)).split())
        chunks.append(Chunk("cms-methodology", "CMS Hospital Provider Cost Report Methodology",
                            "CMS methodology: data source and variables", body,
                            "https://data.cms.gov/provider-compliance/cost-report/hospital-provider-cost-report"))
    return chunks


def _pdf_text(path: Path) -> str:
    cache = path.with_suffix(".txt")
    if cache.exists() and cache.stat().st_mtime >= path.stat().st_mtime:
        return cache.read_text()
    from pypdf import PdfReader

    text = "\n".join(p.extract_text() or "" for p in PdfReader(str(path)).pages)
    cache.write_text(text)
    return text


def corpus_hash(chunks: list[Chunk]) -> str:
    h = hashlib.sha256()
    for c in chunks:
        h.update(json.dumps(c.to_dict(), sort_keys=True).encode())
    return h.hexdigest()[:16]
