# Run the spdf.lua tests (needs pandoc, sqlite3 and gzip on PATH).
.PHONY: test update

test:
	test/run.sh

# Rewrite test/expected/ from the current output; review the diff afterwards.
update:
	test/run.sh --update
