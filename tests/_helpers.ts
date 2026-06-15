// Shared fixture loader for the compliance tests. Fixtures are produced from the real library
// by scripts/gen-fixtures.mjs and committed under tests/fixtures/.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Bracket } from '@/lib/types';

export const FIX_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export interface Fixture {
	name: string;
	action: Record<string, unknown>;
	// The dispatch envelope: single-bracket fixtures carry `bracket`/`query`, pools carry `pools`.
	result: {
		ok: true;
		bracket?: Bracket;
		query?: unknown;
		pools?: { pools: Bracket[]; elimination: Bracket; participants: unknown[]; config: unknown };
		pools_query?: unknown;
	};
}

export function loadFixtures(): Fixture[] {
	return readdirSync(FIX_DIR)
		.filter((f) => f.endsWith('.json') && !f.startsWith('_'))
		.sort()
		.map((f) => JSON.parse(readFileSync(join(FIX_DIR, f), 'utf8')) as Fixture);
}
