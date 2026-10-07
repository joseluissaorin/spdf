#!/bin/zsh
# Final local builds (EmbeddingGemma 2 + Gemma 4 E4B + whisper), one after another; --offline everywhere.
cd "$(dirname "$0")/.."
C=~/Developer/spdf-corpus
export HF_HUB_OFFLINE=1
PD="https://creativecommons.org/publicdomain/mark/1.0/"
run() { name=$1; shift; echo "== $name $(date +%T)"; /usr/bin/time -l .venv/bin/spdf-build build "$@" -o bench/out/final-$name.spdf --json > bench/out/final-$name.json 2> bench/out/final-$name.log; tail -1 bench/out/final-$name.log; }
run antiguo-local $C/antiguo/b30359156.pdf --engine local --offline --no-labels --license $PD --reuse-reading bench/out/antiguo-local.reading.json
run librivox-local $C/librivox/cuentosnavidad_10_pardobazan_64kb.mp3 --engine local --offline --language es --license $PD
run gutenberg-local $C/gutenberg/pg44358-la-tia-tula.epub --engine local --offline --license $PD
run nist-local $C/moderno/NIST.SP.800-63B-4.pdf --engine local --offline
run antiguo2-local $C/antiguo2/gri_33125010872287.pdf --engine local --offline --no-labels --license $PD --save-reading bench/out/antiguo2-local.reading.json
echo "== e2b $(date +%T)"; bench/run_e2b.sh
echo "== done $(date +%T)"
