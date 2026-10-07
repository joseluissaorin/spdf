#!/bin/zsh
# Builds of the corpus with the Gemini engines (GEMINI_API_KEY in the environment, never in the repo).
cd "$(dirname "$0")/.."
C=~/Developer/spdf-corpus
PD="https://creativecommons.org/publicdomain/mark/1.0/"
run() { name=$1; shift; echo "== $name $(date +%T)"; .venv/bin/spdf-build build "$@" -o bench/out/$name.spdf --json > bench/out/$name.json 2> bench/out/$name.log; tail -1 bench/out/$name.log; }
run antiguo-gemini $C/antiguo/b30359156.pdf --engine gemini --no-labels --license $PD
run librivox-gemini $C/librivox/*.mp3 --engine gemini --language es --license $PD
run gutenberg-gemini $C/gutenberg/pg44358-la-tia-tula.epub --engine gemini --license $PD
run nist-gemini $C/moderno/NIST.SP.800-63B-4.pdf --engine gemini
echo "== done $(date +%T)"
