#!/usr/bin/env bash
# Tests for spdf.lua.
#
#   test/run.sh                 run every case in test/cases/
#   test/run.sh 01-pages        run some cases
#   test/run.sh --update        rewrite test/expected/ from the current output
#                               (then read the diff before committing it)
#
# Each case is cases/NAME.md, with optional cases/NAME.args (extra pandoc
# arguments, one per line) and cases/NAME.exit (expected exit code, default 0).
# The shared booklets in integrations/fixtures are rebuilt by the website and
# their source_sha256 changes with every build, so cases write HASH_EN and
# HASH_ES for them and the outputs are compared with the hashes put back.
# For each case the runner checks three outputs against expected/:
#   NAME.txt     pandoc --lua-filter spdf.lua --citeproc -t plain --wrap=none
#   NAME.err     the warnings on stderr (the Lua source position is removed)
#   NAME.native  pandoc --lua-filter spdf.lua --lua-filter inspect.lua -t native,
#                the citations and references exactly as the filter left them
# Exit status: 0 when every case passes, 1 otherwise, 2 when a tool is missing.

here="$(cd "$(dirname "$0")" && pwd)"
filter="$(cd "$here/.." && pwd)/spdf.lua"
update=0
cases=()
for a in "$@"; do
  case "$a" in
    --update) update=1 ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) cases+=("${a%.md}") ;;
  esac
done

for tool in pandoc sqlite3 gzip; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "run.sh: $tool is required" >&2
    exit 2
  fi
done

cd "$here" || exit 2
tmp="$(mktemp -d "${TMPDIR:-/tmp}/spdf-lua-test.XXXXXX")" || exit 2
trap 'rm -rf "$tmp"' EXIT

# Fixtures generated from SQL (no binaries in the repository).
mkdir -p build
for sql in fixtures/*.sql; do
  out="build/$(basename "${sql%.sql}").spdf"
  rm -f "$out"
  if ! sqlite3 "$out" < "$sql"; then
    echo "run.sh: cannot build $out" >&2
    exit 2
  fi
done

# The current hashes of the shared booklets.
hash_of() {
  sqlite3 -readonly "$1" "SELECT source_sha256 FROM documents" 2> /dev/null
}
HASH_EN="$(hash_of ../../fixtures/spdf-in-five-pages.spdf)"
HASH_ES="$(hash_of ../../fixtures/spdf-en-cinco-paginas.spdf)"
if [ ${#HASH_EN} -ne 64 ] || [ ${#HASH_ES} -ne 64 ]; then
  echo "run.sh: cannot read the source_sha256 of the fixtures in integrations/fixtures" >&2
  exit 2
fi
fill_hashes() {
  sed -e "s/HASH_EN/$HASH_EN/g" -e "s/HASH_ES/$HASH_ES/g"
}
blank_hashes() {
  sed -e "s/$HASH_EN/HASH_EN/g" -e "s/$HASH_ES/HASH_ES/g" \
    -e "s/${HASH_EN:0:12}/HASH_EN_12/g" -e "s/${HASH_ES:0:12}/HASH_ES_12/g"
}
mkdir -p "$tmp/cases"

if [ ${#cases[@]} -eq 0 ]; then
  for f in cases/*.md; do
    cases+=("$(basename "${f%.md}")")
  done
fi

# Stable stderr: no Lua source positions, no stack traceback, no local paths.
normalize() {
  sed -E -e 's/Scripting warning at .* line [0-9]+ column [0-9]+: //' \
    -e '/^stack traceback:$/d' -e $'/^\t/d' \
    -e "s#$filter#spdf.lua#g" -e "s#$here/##g" -e "s#$tmp/##g" | blank_hashes
}

fail=0
passed=0

check() { # case kind actual expected
  if [ $update -eq 1 ]; then
    cp "$3" "$4"
    return 0
  fi
  if [ ! -f "$4" ]; then
    echo "FAIL $1 ($2): missing $4 (run with --update to create it)"
    return 1
  fi
  if ! diff -u "$4" "$3" > "$tmp/diff"; then
    echo "FAIL $1 ($2)"
    sed 's/^/    /' "$tmp/diff"
    return 1
  fi
  return 0
}

pandoc --version | head -n 1
sqlite3 -version | cut -d' ' -f1 | sed 's/^/sqlite3 /'

for name in "${cases[@]}"; do
  if [ ! -f "cases/$name.md" ]; then
    echo "FAIL $name: no such case"
    fail=1
    continue
  fi
  args=()
  if [ -f "cases/$name.args" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      [ -n "$line" ] && args+=("$line")
    done < "cases/$name.args"
  fi
  want_exit=0
  if [ -f "cases/$name.exit" ]; then
    want_exit="$(tr -d '[:space:]' < "cases/$name.exit")"
  fi
  ok=1
  input="$tmp/cases/$name.md"
  fill_hashes < "cases/$name.md" > "$input"

  pandoc "$input" ${args[@]+"${args[@]}"} --lua-filter "$filter" --citeproc \
    -t plain --wrap=none 2> "$tmp/$name.err.raw" | blank_hashes > "$tmp/$name.txt"
  code=${PIPESTATUS[0]}
  normalize < "$tmp/$name.err.raw" > "$tmp/$name.err"
  if [ "$code" != "$want_exit" ]; then
    echo "FAIL $name: exit code $code, expected $want_exit"
    sed 's/^/    /' "$tmp/$name.err"
    ok=0
  fi
  check "$name" plain "$tmp/$name.txt" "expected/$name.txt" || ok=0
  check "$name" stderr "$tmp/$name.err" "expected/$name.err" || ok=0

  if [ "$want_exit" = 0 ]; then
    pandoc "$input" ${args[@]+"${args[@]}"} --lua-filter "$filter" \
      --lua-filter inspect.lua -t native 2> /dev/null | blank_hashes > "$tmp/$name.native"
    check "$name" native "$tmp/$name.native" "expected/$name.native" || ok=0
  fi

  if [ $ok -eq 1 ]; then
    passed=$((passed + 1))
    echo "ok   $name"
  else
    fail=1
  fi
done

if [ $update -eq 1 ]; then
  echo "expected outputs rewritten; review them with git diff"
  exit 0
fi
echo "$passed of ${#cases[@]} cases passed"
exit $fail
