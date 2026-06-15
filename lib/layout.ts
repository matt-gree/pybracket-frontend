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

/** Lay out one bracket side as a coordinate tree. Returns positions keyed by match id. */
function layoutSide(side: BracketSide, allMatches: Match[], roundName: Map<string, string>): SideLayout {
	// Only matches that actually render: byes are auto-advanced by the library and never shown.
	const matches = allMatches.filter((m) => m.status !== 'bye');
	const idSet = new Set(matches.map((m) => m.id));
	const byId = new Map<number, Match>();
	for (const m of matches) byId.set(m.id, m);

	// Winner-advancement feeders within this side, restricted to rendered matches, define the
	// tree spine. A bye (or a seed entering directly) feeds no edge — it just isn't here.
	const feedersOf = new Map<number, number[]>();
	for (const m of matches) {
		const target = m.next_winner_match_id;
		if (target != null && idSet.has(target)) {
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
		.filter((m) => m.next_winner_match_id == null || !idSet.has(m.next_winner_match_id))
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

	const out: SideLayout[] = [];
	for (const side of SIDE_ORDER) {
		const sideMatches = bracket.matches.filter((m) => m.bracket_side === side);
		// Skip a side that has no rendered matches (e.g. nothing but byes).
		if (!sideMatches.some((m) => m.status !== 'bye')) continue;
		out.push(layoutSide(side, sideMatches, roundName));
	}
	return out;
}
