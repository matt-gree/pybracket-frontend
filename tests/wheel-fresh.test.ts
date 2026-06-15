// Wheel-freshness guard. The studio runs the pybracket library in-browser from a bundled wheel
// (public/*.whl). This test catches the "frontend wheel out of date with the library" drift the
// user worries about: when the sibling source repo is available it byte-compares the modules most
// likely to change rendering/contract behaviour; otherwise it falls back to a presence check.
//
// If this fails after a library change, run: npm run sync-pybracket && npm run gen-fixtures

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wheel = join(root, 'public', 'pybracket-0.1.0-py3-none-any.whl');
const sibling = resolve(process.env.PYBRACKET_DIR ?? join(root, '..', 'pybracket'));
const haveSibling = existsSync(join(sibling, 'pyproject.toml'));

// Modules whose drift most directly affects the studio's rendering and serialization contract.
const MODULES = ['pybracket/seeding/byes.py', 'pybracket/formats/single_elim.py'];

function fromWheel(member: string): string | null {
	try {
		return execFileSync('unzip', ['-p', wheel, member], { encoding: 'utf8' });
	} catch {
		return null;
	}
}

describe('bundled wheel is current with the library', () => {
	it('exists and contains the render-ready byes module', () => {
		expect(existsSync(wheel), 'wheel missing from public/').toBe(true);
		expect(fromWheel('pybracket/seeding/byes.py')).toContain('def complete_bye_rounds');
	});

	it.runIf(haveSibling)('matches the sibling source byte-for-byte', () => {
		for (const mod of MODULES) {
			const inWheel = fromWheel(mod);
			const inSource = readFileSync(join(sibling, mod), 'utf8');
			expect(inWheel, `${mod} missing from wheel`).not.toBeNull();
			expect(inWheel, `${mod} differs from source — run npm run sync-pybracket`).toBe(inSource);
		}
	});

	it.skipIf(haveSibling)('(sibling repo not found — byte-compare skipped)', () => {});
});
