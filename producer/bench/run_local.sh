#!/bin/zsh
# Local builds of the corpus, one after another (they share the GPU).
cd "$(dirname "$0")/.."
C=~/Developer/spdf-corpus
export HF_HUB_OFFLINE=1
PD="https://creativecommons.org/publicdomain/mark/1.0/"
run() { name=$1; shift; echo "== $name $(date +%T)"; /usr/bin/time -l .venv/bin/spdf-build build "$@" -o bench/out/$name.spdf --json > bench/out/$name.json 2> bench/out/$name.log; tail -1 bench/out/$name.log; }
run antiguo-local $C/antiguo/b30359156.pdf --engine local --offline --no-labels --license $PD --save-reading bench/out/antiguo-local.reading.json
run librivox-local $C/librivox/*.mp3 --engine local --offline --language es --license $PD
run gutenberg-local $C/gutenberg/pg44358-la-tia-tula.epub --engine local --offline --license $PD
run nist-local $C/moderno/NIST.SP.800-63B-4.pdf --engine local --offline --license "https://www.nist.gov/open/copyright-fair-use-and-licensing-statements-srd-data-software-and-technical-series-publications"
echo "== done $(date +%T)"
