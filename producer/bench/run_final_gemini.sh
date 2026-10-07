#!/bin/zsh
# Final builds with the Gemini engines (keys only from the environment).
cd "$(dirname "$0")/.."
C=~/Developer/spdf-corpus
PD="https://creativecommons.org/publicdomain/mark/1.0/"
run() { name=$1; shift; echo "== $name $(date +%T)"; .venv/bin/spdf-build build "$@" -o bench/out/final-$name.spdf --json > bench/out/final-$name.json 2> bench/out/final-$name.log; tail -1 bench/out/final-$name.log; }
run antiguo-gemini $C/antiguo/b30359156.pdf --engine gemini --no-labels --license $PD --reuse-reading bench/out/antiguo-gemini.reading.json
run librivox-gemini $C/librivox/cuentosnavidad_10_pardobazan_64kb.mp3 --engine gemini --language es --license $PD
run gutenberg-gemini $C/gutenberg/pg44358-la-tia-tula.epub --engine gemini --license $PD
run nist-gemini $C/moderno/NIST.SP.800-63B-4.pdf --engine gemini
run antiguo2-gemini $C/antiguo2/gri_33125010872287.pdf --engine gemini --no-labels --license $PD --save-reading bench/out/antiguo2-gemini.reading.json
echo "== done $(date +%T)"
