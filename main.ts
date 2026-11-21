// The driver the harness runs: `node /bot/main.ts` under node22. It loads the
// cases from /input/cases.json — a JSON array of {id, input} — answers each
// case on its own with run() from solve.js, and writes the answers, one per
// case in the cases' order, as a JSON array to /output/answers.json. Outside
// a container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input
// and /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// Switch V8's incremental marking off before solve.js is imported, so the
// whole parse runs under it: the house baseline runs this way, and the rules
// let an entry tune V8's flags the same way.
setFlagsFromString('--no-incremental-marking');

/** solve.js, imported by its URL (a .js module carries no types) and typed by its contract. */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as {
  id: string;
  input: unknown;
}[];
const answers: unknown[] = [];
for (const c of cases) answers.push(run(c.input));
writeFileSync(join(outputDir, 'answers.json'), JSON.stringify(answers));
