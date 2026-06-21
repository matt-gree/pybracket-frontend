// Coordinate-based bracket layout (spec §6–§9). Elimination-style formats are laid out by
// walking the *rendered* tree the library already emits: sibling subtrees occupy contiguous
// id ranges with seeds 1/2 in opposite halves (the library's render-ready guarantee), so we
// place leaves by an in-order DFS and centre every later match on the matches that feed it.
//
// Byes never render. The library models them two ways and this layout handles both without
// special-casing: explicit `status='bye'` matches (default / protected_seeds) and implicit
// byes (`bye_rounds`, where a seed enters a later round with no feeder match). In both cases
// a bye contributes no node and no connector — only matches that actually render are laid out
// and only edges between two rendered matches become connector lines. Round-robin and Swiss
// are not laid out here — they keep the simple equal-spacing column flow.
//
// A match renders iff it will ever host a real two-player contest — i.e. its occupant count is
// 2. We deliberately key off occupant count, NOT the mutable `status`: in a byed double-elim the
// losers bracket contains "phantom" matches that only ever receive one real participant (the
// engine auto-advances them). Those start `pending` and empty, then flip to `bye` as losers drop
// in — so filtering on `status` made the bracket reshape itself on every reported result. Occupant
// count is structural and fixed at build, so the rendered shape is stable from the first draw.

import type { Bracket, BracketSide, Match } from './types';

// Sized to the compact match card (§5). Tweak together with MatchCard's classes.
export const CARD_WIDTH = 188;
export const CARD_HEIGHT = 46;
export const SLOT_HEIGHT = 66; // vertical space per leaf slot = CARD_HEIGHT + gap
export const ROUND_WIDTH = 224; // horizontal distance between round columns
const SIDE_PADDING_Y = 8;

export interface MatchPos {
	x: number; // left edge of the card
	y: number; // vertical centre of the card
}

export interface FeederLink {
	from: number; // feeder match id
	to: number; // downstream match id
}

export interface SideLayout {
	side: BracketSide;
	label: string;
	rounds: { number: number; name: string; x: number }[];
	positions: Map<number, MatchPos>;
	links: FeederLink[];
	width: number;
	height: number;
}

const SIDE_ORDER: BracketSide[] = ['winners', 'losers', 'grand_final'];
const SIDE_LABEL: Record<BracketSide, string> = {
	winners: 'Winners Bracket',
	losers: 'Losers Bracket',
	grand_final: 'Grand Final'
};

export function isScheduleFormat(format: Bracket['format']): boolean {
	return format === 'round_robin' || format === 'swiss';
}

function isResetMatch(m: Match): boolean {
	return m.bracket_side === 'grand_final' && m.round_number === 2;
}

/**
 * How many real participants will ever occupy each match (0, 1, or 2). A TS mirror of
 * pybracket's `compute_occupant_counts` (advancement/engine.py): the same feeder-graph walk over
 * the serialized bracket. A count of 2 means a real contest; 1 is a bye (its lone participant
 * auto-advances); 0 is a phantom slot that only exists to keep the structure a power of two.
 */
function occupantCounts(bracket: Bracket): Map<number, number> {
	const byId = new Map(bracket.matches.map((m) => [m.id, m]));
	const incoming = new Map<number, Array<[number, 'winner' | 'loser']>>();
	for (const m of bracket.matches) incoming.set(m.id, []);
	for (const m of bracket.matches) {
		if (m.next_winner_match_id != null && incoming.has(m.next_winner_match_id))
			incoming.get(m.next_winner_match_id)!.push([m.id, 'winner']);
		if (m.next_loser_match_id != null && incoming.has(m.next_loser_match_id))
			incoming.get(m.next_loser_match_id)!.push([m.id, 'loser']);
	}
	const memo = new Map<number, number>();
	const count = (id: number): number => {
		const cached = memo.get(id);
		if (cached !== undefined) return cached;
		memo.set(id, 0); // cycle guard (the graph is a DAG, but be safe)
		const m = byId.get(id)!;
		const feeders = incoming.get(id)!;
		let c: number;
		if (feeders.length === 0) {
			c = (m.participant1_id != null ? 1 : 0) + (m.participant2_id != null ? 1 : 0);
		} else {
			// A winner is delivered whenever the source has anyone; a loser only by a real (2-player) match.
			const baseConcrete = Math.max(0, 2 - feeders.length);
			c = baseConcrete + feeders.reduce((s, [src, kind]) => {
				const sc = count(src);
				return s + (kind === 'winner' ? (sc >= 1 ? 1 : 0) : sc >= 2 ? 1 : 0);
			}, 0);
		}
		c = Math.min(2, c);
		memo.set(id, c);
		return c;
	};
	const out = new Map<number, number>();
	for (const m of bracket.matches) out.set(m.id, count(m.id));
	return out;
}

/**
 * The ids of matches the canvas should draw: those that will host a real two-player contest
 * (occupant count 2), plus the grand-final reset (a feeder-less but real match that is activated
 * dynamically). Stable across the whole tournament, so the rendered shape never shifts as results
 * come in. Shared by the canvas, the layout, and the compliance tests so they always agree.
 */
export function renderableMatchIds(bracket: Bracket): Set<number> {
	const counts = occupantCounts(bracket);
	const ids = new Set<number>();
	for (const m of bracket.matches) if (counts.get(m.id) === 2 || isResetMatch(m)) ids.add(m.id);
	return ids;
}

/** Lay out one bracket side as a coordinate tree. Returns positions keyed by match id. */
function layoutSide(
	side: BracketSide,
	allMatches: Match[],
	renderable: Set<number>,
	roundName: Map<string, string>
): SideLayout {
	// Only matches that actually render — see renderableMatchIds (byes/phantoms are excluded).
	const matches = allMatches.filter((m) => renderable.has(m.id));
	const idSet = new Set(matches.map((m) => m.id));
	const byId = new Map<number, Match>();
	for (const m of matches) byId.set(m.id, m);
	const allById = new Map(allMatches.map((m) => [m.id, m]));

	// The rendered match a winner reaches, following its advancement *through* any hidden bye
	// matches in this side. The losers bracket of a byed double-elim threads winners through
	// single-occupant bye matches (the engine auto-advances them); without bridging those, a
	// rendered match whose direct target is a hidden bye would be drawn with no connector — the
	// disconnected fragments seen with heavy byes. Returns null if the winner leaves this side.
	const resolveTarget = (id: number): number | null => {
		let t = allById.get(id)!.next_winner_match_id;
		let guard = 0;
		while (t != null && allById.has(t) && !idSet.has(t) && guard++ < allMatches.length) {
			t = allById.get(t)!.next_winner_match_id;
		}
		return t != null && idSet.has(t) ? t : null;
	};

	// Winner-advancement feeders within this side (bye matches bridged), defining the tree spine.
	const feedersOf = new Map<number, number[]>();
	for (const m of matches) {
		const target = resolveTarget(m.id);
		if (target != null) {
			const list = feedersOf.get(target);
			if (list) list.push(m.id);
			else feedersOf.set(target, [m.id]);
		}
	}

	const rounds = [...new Set(matches.map((m) => m.round_number))].sort((a, b) => a - b);
	const minRound = rounds[0] ?? 0;

	const positions = new Map<number, MatchPos>();
	let nextLeafSlot = 0;

	// Place a match and everything that feeds it, depth-first. Feeders are sorted by id because
	// the library emits sibling subtrees as contiguous id ranges (lower id == upper subtree), so
	// an in-order walk assigns leaf slots top-to-bottom. A leaf (no rendered feeders — a round-1
	// match, or a seed that byes straight into a later round) takes the next vertical slot; an
	// internal match centres on the feeders it sits between (one feeder = it sits at that height,
	// the direct-entry side simply has no incoming line).
	const place = (id: number): number => {
		const existing = positions.get(id);
		if (existing) return existing.y;
		const m = byId.get(id)!;
		const x = (m.round_number - minRound) * ROUND_WIDTH;
		const feeders = (feedersOf.get(id) ?? []).slice().sort((a, b) => a - b);
		let y: number;
		if (feeders.length === 0) {
			y = SIDE_PADDING_Y + nextLeafSlot * SLOT_HEIGHT + SLOT_HEIGHT / 2;
			nextLeafSlot++;
		} else {
			const ys = feeders.map((f) => place(f));
			y = ys.reduce((a, b) => a + b, 0) / ys.length;
		}
		positions.set(id, { x, y });
		return y;
	};

	// Roots (the final, or any match whose winner-target leaves this side) first, in id order so
	// the leaf slots run top-to-bottom; then defensively place anything the walk didn't reach.
	const roots = matches
		.filter((m) => resolveTarget(m.id) == null)
		.map((m) => m.id)
		.sort((a, b) => a - b);
	for (const r of roots) place(r);
	for (const m of [...matches].sort((a, b) => a.id - b.id)) if (!positions.has(m.id)) place(m.id);

	const links: FeederLink[] = [];
	for (const [to, froms] of feedersOf) {
		if (!positions.has(to)) continue;
		for (const from of froms) if (positions.has(from)) links.push({ from, to });
	}

	let width = 0;
	let height = 0;
	for (const p of positions.values()) {
		width = Math.max(width, p.x + CARD_WIDTH);
		height = Math.max(height, p.y + CARD_HEIGHT / 2 + SIDE_PADDING_Y);
	}

	const roundCols = rounds.map((number) => ({
		number,
		name: roundName.get(`${side}:${number}`) ?? `Round ${number}`,
		x: (number - minRound) * ROUND_WIDTH
	}));

	return { side, label: SIDE_LABEL[side], rounds: roundCols, positions, links, width, height };
}

/** Lay out every elimination-style side of a bracket, in display order. */
export function layoutBracket(bracket: Bracket): SideLayout[] {
	const roundName = new Map<string, string>();
	for (const r of bracket.rounds) roundName.set(`${r.bracket_side}:${r.number}`, r.name);

	const renderable = renderableMatchIds(bracket);
	const out: SideLayout[] = [];
	for (const side of SIDE_ORDER) {
		const sideMatches = bracket.matches.filter((m) => m.bracket_side === side);
		// Skip a side that has no rendered matches (e.g. nothing but byes).
		if (!sideMatches.some((m) => renderable.has(m.id))) continue;
		out.push(layoutSide(side, sideMatches, renderable, roundName));
	}
	return out;
}
