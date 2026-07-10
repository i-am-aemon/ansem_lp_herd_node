#!/usr/bin/env bash
# Build Book of ANSEM Private Node PDF → reports/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEXDIR="$ROOT/docs/BOOK_OF_ANSEM_PRIVATE_NODE/latex"
OUTDIR="$ROOT/reports"
mkdir -p "$OUTDIR"
cd "$TEXDIR"

if command -v latexmk >/dev/null 2>&1; then
  latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex
elif command -v pdflatex >/dev/null 2>&1; then
  pdflatex -interaction=nonstopmode main.tex
  pdflatex -interaction=nonstopmode main.tex
else
  echo "pdflatex/latexmk not found" >&2
  exit 1
fi

cp -f main.pdf "$OUTDIR/book_of_ansem_private_node.pdf"
echo "Wrote $OUTDIR/book_of_ansem_private_node.pdf"

# cleanup aux in latex dir
latexmk -c >/dev/null 2>&1 || true
