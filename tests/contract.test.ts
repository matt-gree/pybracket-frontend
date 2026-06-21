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

const Stats = z.record(z.record(z.number()));

const Game = z.object({
	number: z.number(),
	winner_id: z.number().nullable(),
	loser_id: z.number().nullable(),
	stats: Stats,
	metadata: z.record(z.unknown())
});

const Match = z.object({
	id: z.number(),
	round_number: z.number(),
	bracket_side: z.enum(['winners', 'losers', 'grand_final']),
	participant1_id: z.number().nullable(),
	participant2_id: z.number().nullable(),
	winner_id: z.number().nullable(),
	loser_id: z.number().nullable(),
	advancement_type: z.enum(['result', 'bye', 'forfeit', 'walkover', 'draw']).nullable(),
	next_winner_match_id: z.number().nullable(),
	next_loser_match_id: z.number().nullable(),
	status: z.enum(['pending', 'ready', 'bye', 'completed', 'pending_choice', 'not_needed']),
	best_of: z.number(),
	metadata: z.record(z.unknown()),
	games: z.array(Game),
	stats: Stats
});

const Round = z.object({
	number: z.number(),
	bracket_side: z.enum(['winners', 'losers', 'grand_final']),
	match_ids: z.array(z.number()),
	name: z.string(),
	best_of: z.number().nullable()
});

const Bracket = z.object({
	format: z.enum(['single_elim', 'double_elim', 'round_robin', 'swiss', 'gauntlet', 'league']),
	state: z.enum(['draft', 'published', 'complete']),
	participants: z.array(Participant),
	matches: z.array(Match),
	rounds: z.array(Round),
	config: z.record(z.unknown())
});

const Standing = z.object({
	participant_id: z.number(),
	rank: z.number(),
	wins: z.number(),
	losses: z.number(),
	draws: z.number(),
	points: z.number(),
	tiebreaker_scores: z.record(z.number())
});

const Ranked = z.object({ participant_id: z.number(), rank: z.number(), group: z.number() });

const BracketQuery = z.object({
	ready_match_ids: z.array(z.number()),
	standings: z.array(Standing),
	placements: z.array(z.unknown()),
	winner: Participant.nullable(),
	is_complete: z.boolean()
});

const SlotRef = z.object({ phase: z.string(), place: z.number(), group: z.number().nullable() });
const Qualification = z.object({ sources: z.array(SlotRef), seeding: z.enum(['snake', 'rank', 'manual']) });

const Phase = z.object({
	id: z.string(),
	format: z.string(),
	config: z.record(z.unknown()),
	entrants: Qualification.nullable(),
	groups: z.number(),
	group_assignment: z.string(),
	brackets: z.array(Bracket),
	state: z.enum(['draft', 'published', 'complete'])
});

const LeagueExtras = z.object({
	divisions: z.array(z.array(z.number())),
	division_standings: z.array(z.array(Standing)),
	schedule: z.array(
		z.object({
			number: z.number(),
			fixtures: z.array(
				z.object({ match_id: z.number(), home_id: z.number(), away_id: z.number(), division: z.number().nullable() })
			)
		})
	)
});

const PhaseQuery = z.object({
	id: z.string(),
	format: z.string(),
	state: z.enum(['draft', 'published', 'complete']),
	groups: z.number(),
	has_brackets: z.boolean(),
	is_complete: z.boolean(),
	is_draftable: z.boolean(),
	is_preview: z.boolean(),
	brackets: z.array(BracketQuery),
	group_results: z.array(z.array(Ranked)),
	league: LeagueExtras.optional()
});

const Tournament = z.object({
	participants: z.array(Participant),
	config: z.record(z.unknown()),
	phases: z.array(Phase)
});

const Envelope = z.object({
	ok: z.literal(true),
	tournament: Tournament,
	query: z.object({ phases: z.array(PhaseQuery) })
});

describe.each(loadFixtures().map((f) => [f.name, f] as const))('contract: %s', (_name, fix) => {
	it('matches the studio tournament serialization shape', () => {
		const parsed = Envelope.safeParse(fix.result);
		if (!parsed.success) throw new Error(parsed.error.toString());
		expect(parsed.success).toBe(true);
	});
});
