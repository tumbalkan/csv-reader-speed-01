![make.fun bounty](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)
![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/tumbalkan/csv-reader-speed-01/rank.svg)
![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/tumbalkan/csv-reader-speed-01/reward.svg)

# Fast CSV reader — csv-reader-speed-01

A faster drop-in for csv-reader 1.0.0, for the [make.fun bounty](https://make.fun/bounty/csv-reader-speed-01-run-20261121): `solve.js` answers every case exactly as the reference does, in a fraction of its CPU time.

## How it works

- **Record fast path:** a record whose line holds no quote and no stray CR is split in one go with `String.split`.
- **Field fast path:** an unquoted field is sliced to the next comma (or the line break when one comes first); empty fields skip the slice and the scans entirely.
- **Quoted fields:** the closing quote is found with `indexOf`, doubled quotes (`""`) folded in, line breaks inside quotes counted and converted (CRLF/lone CR read as LF).
- **Exactness first:** a stray CR, junk after a closing quote, or a quote that never closes falls back to a character-by-character walk that mirrors the reference, so every error (`stray_cr`, `quote_junk`, `unterminated_quote`, `short_row`, `long_row`) lands in the same order with the same `{code, line, row}`.
- `main.ts` is a minimal driver: it turns V8's incremental marking off before importing `solve.js`, reads `/input/cases.json`, answers each case with `run`, and writes `/output/answers.json`.

## Practice results (local, this machine)

- Kit scorer: **passed = 1, 6/6 cases identical** to the oracle.
- `run()` on the practice set (10.2M chars, warmed): **~105 ms vs ~550 ms for csv-reader 1.0.0 — about 5.3x faster**.
- Full driver end to end (fresh process, incl. JSON parse/stringify): **~1.27 s vs ~2.35 s — about 1.85x faster**.
- Two runs produce byte-identical `answers.json`.
- Extra checks beyond the practice set: 66 hand-picked edge cases and 3,000 randomized differential cases, all identical to the reference.

## Layout

- `solve.js` — the parser (`run(input)`).
- `main.ts` — the harness driver.
- `package.json` — `{"type": "module"}`.
- `LICENSE` — MIT.
