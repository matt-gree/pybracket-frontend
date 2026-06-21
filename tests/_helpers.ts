// Shared fixture loader for the compliance tests. Fixtures are produced from the real library
// by scripts/gen-fixtures.mjs and committed under tests/fixtures/. Each fixture is the bridge's
// tournament dispatch envelope (a Tournament + query).

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Bracket, Tournament, TournamentQuery } from '@/lib/types';

export const FIX_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export interface Fixture {
	name: string;
	action: Record<string, unknown>;
	result: { ok: true; tournament: Tournament; query: TournamentQuery };
}

export function loadFixtures(): Fixture[] {
	return readdirSync(FIX_DIR)
		.filter((f) => f.endsWith('.json') && !f.startsWith('_'))
		.sort()
		.map((f) => JSON.parse(readFileSync(join(FIX_DIR, f), 'utf8')) as Fixture);
}

export interface LabelledBracket {
	label: string; // "<fixture>/<phase>[#group]"
	bracket: Bracket;
	preview: boolean;
}

/** Flatten every phase's sub-bracket(s) into labelled entries for per-bracket assertions. */
export function bracketsOf(fix: Fixture): LabelledBracket[] {
	const out: LabelledBracket[] = [];
	for (const ph of fix.result.tournament.phases) {
		ph.brackets.forEach((bracket, g) => {
			out.push({
				label: `${fix.name}/${ph.id}${ph.brackets.length > 1 ? `#${g}` : ''}`,
				bracket,
				preview: ph.brackets[g].config.preview === true
			});
		});
	}
	return out;
}

/** The field phase's first bracket of a named fixture. */
export function fieldBracket(name: string): Bracket {
	const fix = loadFixtures().find((f) => f.name === name);
	if (!fix) throw new Error(`fixture ${name} not found — run npm run gen-fixtures`);
	return fix.result.tournament.phases[0].brackets[0];
}
