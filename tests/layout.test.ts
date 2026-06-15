// Layout-invariant compliance tests. These assert that the studio's coordinate layout renders
// every library-emitted bracket faithfully: no overlapping cards, no connectors to byes, every
// rendered match placed, and the tree centred correctly. The single_elim_24_custom fixture is
// the regression lock for the reported "melded lines / missing quarterfinal" screenshot.

import { describe, expect, it } from 'vitest';
import { CARD_HEIGHT, isScheduleFormat, layoutBracket } from '@/lib/layout';
import type { Bracket } from '@/lib/types';
import { loadFixtures } from './_helpers';

const EPS = 0.5;
const bracketFixtures = loadFixtures().filter((f) => f.result.bracket);

describe.each(bracketFixtures.map((f) => [f.name, f.result.bracket!] as const))(
	'layout: %s',
	(_name, bracket: Bracket) => {
		const rendered = bracket.matches.filter((m) => m.status !== 'bye');
		const byId = new Map(bracket.matches.map((m) => [m.id, m]));

		// Round-robin / Swiss use the schedule-column flow, not the coordinate tree.
		if (isScheduleFormat(bracket.format)) {
			it('schedule formats lay out without throwing', () => {
				expect(() => layoutBracket(bracket)).not.toThrow();
			});
			return;
		}

		const sides = layoutBracket(bracket);
		const positioned = new Map<number, { x: number; y: number }>();
		for (const s of sides) for (const [id, p] of s.positions) positioned.set(id, p);

		it('positions every rendered match exactly once', () => {
			expect(positioned.size).toBe(rendered.length);
			for (const m of rendered) expect(positioned.has(m.id), `match ${m.id} unplaced`).toBe(true);
		});

		it('never positions a bye match', () => {
			for (const m of bracket.matches) {
				if (m.status === 'bye') expect(positioned.has(m.id), `bye ${m.id} placed`).toBe(false);
			}
		});

		it('no two cards in the same column overlap vertically', () => {
			for (const s of sides) {
				const byX = new Map<number, number[]>();
				for (const p of s.positions.values()) {
					const arr = byX.get(p.x) ?? [];
					arr.push(p.y);
					byX.set(p.x, arr);
				}
				for (const [x, ys] of byX) {
					ys.sort((a, b) => a - b);
					for (let i = 1; i < ys.length; i++) {
						expect(ys[i] - ys[i - 1], `column x=${x} overlap`).toBeGreaterThanOrEqual(CARD_HEIGHT - EPS);
					}
				}
			}
		});

		it('only links two rendered matches — never a bye or a direct seed', () => {
			for (const s of sides) {
				for (const { from, to } of s.links) {
					expect(byId.get(from)?.status, `link from bye ${from}`).not.toBe('bye');
					expect(byId.get(to)?.status, `link to bye ${to}`).not.toBe('bye');
					expect(s.positions.has(from) && s.positions.has(to)).toBe(true);
				}
			}
		});

		it('centres each downstream match within its feeders span', () => {
			for (const s of sides) {
				const feeders = new Map<number, number[]>();
				for (const { from, to } of s.links) {
					const arr = feeders.get(to) ?? [];
					arr.push(from);
					feeders.set(to, arr);
				}
				for (const [to, froms] of feeders) {
					const ys = froms.map((f) => s.positions.get(f)!.y);
					const y = s.positions.get(to)!.y;
					expect(y).toBeGreaterThanOrEqual(Math.min(...ys) - EPS);
					expect(y).toBeLessThanOrEqual(Math.max(...ys) + EPS);
				}
			}
		});

		it('feeds flow left to right (each feeder sits in an earlier column than its target)', () => {
			for (const s of sides) {
				for (const { from, to } of s.links) {
					expect(s.positions.get(from)!.x, `feeder ${from} not left of ${to}`).toBeLessThan(
						s.positions.get(to)!.x
					);
				}
			}
		});
	}
);

describe('regression: 24-player custom byes (screenshot case)', () => {
	const fix = loadFixtures().find((f) => f.name === 'single_elim_24_custom')!;
	const bracket = fix.result.bracket!;
	const side = layoutBracket(bracket)[0];

	it('renders all four quarterfinals without overlap or omission', () => {
		// Quarterfinals here are round 4 (rounds 1-3 then QF/SF/final).
		const qf = bracket.matches.filter((m) => m.round_number === 4 && m.status !== 'bye');
		expect(qf.length).toBe(4);
		const ys = qf.map((m) => side.positions.get(m.id)!.y).sort((a, b) => a - b);
		for (let i = 1; i < ys.length; i++) {
			expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(CARD_HEIGHT);
		}
	});

	it('puts seed 1 and seed 2 in opposite halves', () => {
		const all = [...side.positions.values()];
		const mid = (Math.min(...all.map((p) => p.y)) + Math.max(...all.map((p) => p.y))) / 2;
		const matchOfSeed = (seed: number) =>
			bracket.matches.find((m) => m.participant1_id === seed || m.participant2_id === seed)!;
		const y1 = side.positions.get(matchOfSeed(1).id)!.y;
		const y2 = side.positions.get(matchOfSeed(2).id)!.y;
		expect(y1 < mid).not.toBe(y2 < mid);
	});
});

// The pools "preliminary bracket" (preview) is a real elimination bracket of origin placeholders,
// rendered by the same canvas — so it must satisfy the same layout invariants.
describe.each(
	loadFixtures()
		.filter((f) => f.result.pools)
		.map((f) => [f.name, f.result.pools!.elimination] as const)
)('layout: %s (pools preview elimination)', (_name, elim: Bracket) => {
	const rendered = elim.matches.filter((m) => m.status !== 'bye');
	const sides = layoutBracket(elim);
	const positioned = new Map<number, { x: number; y: number }>();
	for (const s of sides) for (const [id, p] of s.positions) positioned.set(id, p);

	it('positions every rendered match and never overlaps', () => {
		expect(positioned.size).toBe(rendered.length);
		for (const s of sides) {
			const byX = new Map<number, number[]>();
			for (const p of s.positions.values()) {
				const arr = byX.get(p.x) ?? [];
				arr.push(p.y);
				byX.set(p.x, arr);
			}
			for (const ys of byX.values()) {
				ys.sort((a, b) => a - b);
				for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(CARD_HEIGHT - EPS);
			}
		}
	});

	it('fills slots with origin placeholders (negative id + origin stats)', () => {
		const placeholders = elim.participants.filter((p) => p.id < 0);
		expect(placeholders.length).toBeGreaterThan(0);
		for (const p of placeholders) expect(p.stats).toHaveProperty('origin_pool');
	});
});
