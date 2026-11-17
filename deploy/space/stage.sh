#!/usr/bin/env bash
# Assemble the Hugging Face Space build context in $1 (only what the API needs).
set -euo pipefail
out="${1:?usage: stage.sh <output-dir>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
rm -rf "$out" && mkdir -p "$out/data/processed" "$out/docs/sources"
cp "$root/deploy/space/Dockerfile" "$root/deploy/space/README.md" "$out/"
cp "$root/pyproject.toml" "$root/LICENSE" "$out/"
cp -r "$root/src" "$out/src"
find "$out/src" -name '__pycache__' -prune -exec rm -rf {} +
cp "$root/data/processed/hospital_kpis.parquet" "$out/data/processed/"
cp "$root/docs/methodology.md" "$root/docs/kpi_glossary.md" "$out/docs/"
cp "$root/docs/sources/"*.pdf "$out/docs/sources/"
echo "staged $(du -sh "$out" | cut -f1) in $out"
