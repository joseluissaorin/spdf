#!/bin/zsh
# Gemma 4 E2B on the scanned book: speed and quality against E4B. Reading only (vectors and context off).
cd "$(dirname "$0")/.."
export HF_HUB_OFFLINE=1
.venv/bin/spdf-build build ~/Developer/spdf-corpus/antiguo/b30359156.pdf -o bench/out/antiguo-e2b.spdf --engine none \
  --vision gemma-4-e2b --embed none --offline --no-labels --no-context --save-reading bench/out/antiguo-e2b.reading.json \
  --json > bench/out/antiguo-e2b.json 2> bench/out/antiguo-e2b.log
