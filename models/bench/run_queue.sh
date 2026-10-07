#!/bin/zsh
# Runs bench engines one after another (never in parallel, so latencies are not contaminated).
# usage: ./run_queue.sh <file with one command per line>
cd "$(dirname "$0")"
source .venv/bin/activate
mkdir -p results/logs
while IFS= read -r cmd; do
  [[ -z "$cmd" || "$cmd" == \#* ]] && continue
  name=$(echo "$cmd" | tr -cs 'A-Za-z0-9_.-' '_' | cut -c1-80)
  echo "[$(date +%T)] start $cmd"
  eval "$cmd" > "results/logs/$name.log" 2>&1 && echo "[$(date +%T)] ok $cmd" || echo "[$(date +%T)] FAIL $cmd"
done < "$1"
echo "[$(date +%T)] QUEUE DONE"
