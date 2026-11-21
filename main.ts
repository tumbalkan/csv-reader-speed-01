// The harness driver for this entry: the harness runs `node /bot/main.ts`
// (node22) with the cases at /input/cases.json and expects the answers at
// /output/answers.json. Outside a container, MAKEFUN_INPUT_DIR and
// MAKEFUN_OUTPUT_DIR stand in for /input and /output.
//
// The driver itself does as little as possible — the clock is running while
// it works — and leaves every answer to run() from solve.js. V8's incremental
// marking goes off before solve.js is imported, as the house baseline does,
// so all of the parsing runs under that flag.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');

type Case = { id: string; input: unknown };
type Runner = { run: (input: unknown) => unknown };

async function main(): Promise<void> {
  const { run } = (await import('./solve.js')) as Runner;

  const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

  const list = JSON.parse(readFileSync(join(inDir, 'cases.json'), 'utf8')) as Case[];
  const out: unknown[] = new Array(list.length);
  for (let i = 0; i < list.length; i++) out[i] = run(list[i].input);
  writeFileSync(join(outDir, 'answers.json'), JSON.stringify(out));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
