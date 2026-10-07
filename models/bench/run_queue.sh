#!/bin/zsh
# Runs bench engines one after another (never in parallel, so latencies are not contaminated).
# usage: ./run_queue.sh "python -I ort_py.py --dtype q4" "python -I llama_srv.py --quant Q8_0" ...
cd "$(dirname "$0")"
source .venv/bin/activate
mkdir -p results/logs
for cmd in "$@"; do
  name=$(echo "$cmd" | tr -cs 'A-Za-z0-9_.-' '_' | cut -c1-80)
  echo "[$(date +%T)] start $cmd"
  eval "$cmd" > "results/logs/$name.log" 2>&1 && echo "[$(date +%T)] ok $cmd" || echo "[$(date +%T)] FAIL $cmd"
done
echo "[$(date +%T)] QUEUE DONE"
