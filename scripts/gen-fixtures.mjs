#!/usr/bin/env node
// Regenerates tests/fixtures/*.json from the real pybracket library (via the studio bridge),
// using the sibling repo's venv python — the same source the wheel is built from.
//
//   node scripts/gen-fixtures.mjs
//
// Env overrides mirror sync-pybracket.mjs:
//   PYBRACKET_DIR   path to the pybracket source repo (default: ../pybracket)
//   PYBRACKET_PY    python interpreter to use (default: <repo>/.venv/bin/python, else python3)

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '..');
const pybracketDir = resolve(process.env.PYBRACKET_DIR ?? join(frontendRoot, '..', 'pybracket'));

const venvPy = join(pybracketDir, '.venv', 'bin', 'python');
const python = process.env.PYBRACKET_PY ?? (existsSync(venvPy) ? venvPy : 'python3');

execFileSync(python, [join(here, 'gen_fixtures.py')], { stdio: 'inherit', cwd: frontendRoot });
