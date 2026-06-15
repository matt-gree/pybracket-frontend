// Serialization-contract tests. Validate every library-produced fixture against a zod mirror of
// the shapes in lib/types.ts, so that if the library renames/retypes/drops a serialized field the
// studio depends on, a test fails loudly instead of the UI breaking at runtime. Schemas are
// non-strict (unknown new fields are allowed) — we guard the fields the studio actually reads.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadFixtures } from './_helpers';

const Participant = z.object({
	id: z.number(),
	seed: z.number(),
	name: z.string(),
	stats: z.record(z.unknown())
});

const Match = z.object({
	id: z.number(),
	round_number: z.number(),
	bracket_side: z.enum(['winners', 'losers', 'grand_final']),
	participant1_id: z.number().nullable(),
	participant2_id: z.number().nullable(),
	winner_id: z.number().nullable(),
	loser_id: z.number().nullable(),
	advancement_type: z.enum(['result', 'bye', 'forfeit', 'walkover']).nullable(),
	next_winner_match_id: z.number().nullable(),
	next_loser_match_id: z.number().nullable(),
	status: z.enum(['pending', 'ready', 'bye', 'completed', 'pending_choice', 'not_needed']),
	best_of: z.number(),
	metadata: z.record(z.unknown())
});

const Round = z.object({
	number: z.number(),
	bracket_side: z.enum(['winners', 'losers', 'grand_final']),
	match_ids: z.array(z.number()),
	name: z.string(),
	best_of: z.number().nullable()
});

const Bracket = z.object({
	format: z.enum(['single_elim', 'double_elim', 'round_robin', 'swiss', 'gauntlet', 'pools']),
	state: z.enum(['draft', 'published', 'complete']),
	participants: z.array(Participant),
	matches: z.array(Match),
	rounds: z.array(Round),
	config: z.record(z.unknown())
});

const Query = z.object({
	ready_match_ids: z.array(z.number()),
	standings: z.array(z.unknown()),
	placements: z.array(z.unknown()),
	winner: Participant.nullable(),
	is_complete: z.boolean()
});

const BracketResult = z.object({
	ok: z.literal(true),
	bracket: Bracket,
	query: Query,
	signals: z.array(z.unknown()).optional()
});

const PoolsResult = z.object({
	ok: z.literal(true),
	pools: z.object({
		pools: z.array(Bracket),
		elimination: Bracket,
		participants: z.array(Participant),
		config: z.record(z.unknown())
	}),
	pools_query: z.object({
		pools: z.array(Query),
		pools_complete: z.boolean(),
		elimination: Query,
		elimination_state: z.enum(['draft', 'published', 'complete']),
		advancing_ids: z.array(z.number())
	})
});

describe.each(loadFixtures().map((f) => [f.name, f] as const))('contract: %s', (_name, fix) => {
	it('matches the studio serialization shape', () => {
		const schema = fix.result.pools ? PoolsResult : BracketResult;
		const parsed = schema.safeParse(fix.result);
		if (!parsed.success) throw new Error(parsed.error.toString());
		expect(parsed.success).toBe(true);
	});
});
