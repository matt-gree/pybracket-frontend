// Coordinate-based bracket layout (spec §6–§9). Elimination-style formats are laid out as a
// tree: round-1 matches sit at evenly spaced Y positions and every later match is centred on
// the matches that feed it. Byes are kept in the layout (so spacing and connectors are
// undisturbed) even though their cards are not rendered. Round-robin and Swiss are not laid
// out here — they keep the simple equal-spacing column flow.

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
function layoutSide(side: BracketSide, matches: Match[], roundName: Map<string, string>): SideLayout {
	const idSet = new Set(matches.map((m) => m.id));

	// Winner-advancement feeders within this side define the tree spine.
	const feedersOf = new Map<number, number[]>();
	for (const m of matches) {
		const target = m.next_winner_match_id;
		if (target != null && idSet.has(target)) {
			const list = feedersOf.get(target);
			if (list) list.push(m.id);
			else feedersOf.set(target, [m.id]);
		}
	}

	const byRound = new Map<number, Match[]>();
	for (const m of matches) {
		const list = byRound.get(m.round_number);
		if (list) list.push(m);
		else byRound.set(m.round_number, [m]);
	}
	const rounds = [...byRound.keys()].sort((a, b) => a - b);
	const minRound = rounds[0];

	const positions = new Map<number, MatchPos>();
	let nextLeafSlot = 0;

	for (const r of rounds) {
		const roundMatches = byRound.get(r)!.sort((a, b) => a.id - b.id);
		for (const m of roundMatches) {
			const feeders = (feedersOf.get(m.id) ?? []).filter((id) => positions.has(id));
			const x = (r - minRound) * ROUND_WIDTH;
			let y: number;
			if (feeders.length === 0) {
				// A leaf (round 1, or a match entered only by direct seeds): take the next slot.
				y = SIDE_PADDING_Y + nextLeafSlot * SLOT_HEIGHT + SLOT_HEIGHT / 2;
				nextLeafSlot++;
			} else {
				// Centre on the feeders — phantom (bye) feeders contribute their slot too.
				const ys = feeders.map((id) => positions.get(id)!.y);
				y = ys.reduce((a, b) => a + b, 0) / ys.length;
			}
			positions.set(m.id, { x, y });
		}
	}

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
		if (sideMatches.length === 0) continue;
		out.push(layoutSide(side, sideMatches, roundName));
	}
	return out;
}
