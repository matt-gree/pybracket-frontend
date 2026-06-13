#!/usr/bin/env node
// Rebuilds the pybracket wheel from the sibling Python repo and copies it into public/, so the
// in-browser library stays in lockstep with the source. pybracket has zero runtime deps, so the
// resulting wheel is pure-Python (py3-none-any) and installs cleanly under Pyodide's micropip.
//
//   node scripts/sync-pybracket.mjs
//
// Env overrides:
//   PYBRACKET_DIR   path to the pybracket source repo (default: ../pybracket)
//   PYBRACKET_PY    python interpreter to build with (default: <repo>/.venv/bin/python, else python3)

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '..');
const pybracketDir = resolve(process.env.PYBRACKET_DIR ?? join(frontendRoot, '..', 'pybracket'));

if (!existsSync(join(pybracketDir, 'pyproject.toml'))) {
	console.error(`pybracket source not found at ${pybracketDir}. Set PYBRACKET_DIR.`);
	process.exit(1);
}

const venvPy = join(pybracketDir, '.venv', 'bin', 'python');
const python = process.env.PYBRACKET_PY ?? (existsSync(venvPy) ? venvPy : 'python3');

const outDir = mkdtempSync(join(tmpdir(), 'pyb-wheel-'));
console.log(`Building wheel from ${pybracketDir} with ${python}…`);
execFileSync(python, ['-m', 'pip', 'wheel', '.', '--no-deps', '-w', outDir], {
	cwd: pybracketDir,
	stdio: 'inherit'
});

const wheel = readdirSync(outDir).find((f) => f.endsWith('.whl'));
if (!wheel) {
	console.error('No wheel produced.');
	process.exit(1);
}

const dest = join(frontendRoot, 'public', wheel);
copyFileSync(join(outDir, wheel), dest);
console.log(`Copied ${wheel} -> public/${wheel}`);

const EXPECTED = 'pybracket-0.1.0-py3-none-any.whl';
if (wheel !== EXPECTED) {
	console.warn(
		`\n⚠  Wheel name changed to ${wheel}. Update WHEEL_PATH in lib/pyodide.ts to match.`
	);
}
