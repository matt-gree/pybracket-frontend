'use client';

import { useMemo } from 'react';
import { MatchCard } from '@/components/MatchCard';
import type { Bracket, BracketSide, Match, Participant } from '@/lib/types';

interface Props {
	bracket: Bracket;
	readyIds: number[];
	onReport: (matchId: number, winnerId: number) => void;
	onUnwind: (matchId: number) => void;
	onChoice: (matchId: number, opponentId: number) => void;
}

const SIDE_ORDER: BracketSide[] = ['winners', 'losers', 'grand_final'];
const SIDE_LABEL: Record<BracketSide, string> = {
	winners: 'Winners Bracket',
	losers: 'Losers Bracket',
	grand_final: 'Grand Final'
};

export function BracketCanvas({ bracket, readyIds, onReport, onUnwind, onChoice }: Props) {
	const byId = useMemo<Record<number, Participant>>(() => {
		const map: Record<number, Participant> = {};
		for (const p of bracket.participants) map[p.id] = p;
		return map;
	}, [bracket.participants]);

	const readySet = useMemo(() => new Set(readyIds), [readyIds]);

	const roundName = useMemo(() => {
		const map = new Map<string, string>();
		for (const r of bracket.rounds) map.set(`${r.bracket_side}:${r.number}`, r.name);
		return map;
	}, [bracket.rounds]);

	const sides = useMemo(() => groupBySide(bracket.matches), [bracket.matches]);
	const isSchedule = bracket.format === 'round_robin' || bracket.format === 'swiss';

	return (
		<div className="flex flex-col gap-6 overflow-x-auto pb-2">
			{SIDE_ORDER.filter((s) => sides[s]).map((side) => {
				const rounds = sides[side]!;
				return (
					<section key={side}>
						{Object.keys(sides).length > 1 && (
							<h3 className="mb-2 font-display text-xs font-bold uppercase tracking-[0.2em] text-fog-500">
								{SIDE_LABEL[side]}
							</h3>
						)}
						<div className="flex items-stretch gap-5">
							{rounds.map(({ round, matches }) => (
								<div key={round} className="flex shrink-0 flex-col">
									<div className="mb-2 font-display text-[0.65rem] font-semibold uppercase tracking-widest text-court-400">
										{roundName.get(`${side}:${round}`) ?? `Round ${round}`}
									</div>
									<div
										className={`flex flex-1 flex-col gap-3 ${
											isSchedule ? 'justify-start' : 'justify-center'
										}`}
									>
										{matches.map((m) => (
											<MatchCard
												key={m.id}
												match={m}
												byId={byId}
												ready={readySet.has(m.id)}
												onReport={onReport}
												onUnwind={onUnwind}
												onChoice={onChoice}
											/>
										))}
									</div>
								</div>
							))}
						</div>
					</section>
				);
			})}
		</div>
	);
}

type SideGroups = Partial<Record<BracketSide, { round: number; matches: Match[] }[]>>;

function groupBySide(matches: Match[]): SideGroups {
	const out: SideGroups = {};
	for (const side of SIDE_ORDER) {
		const sideMatches = matches.filter((m) => m.bracket_side === side);
		if (sideMatches.length === 0) continue;
		const byRound = new Map<number, Match[]>();
		for (const m of sideMatches) {
			const list = byRound.get(m.round_number) ?? [];
			list.push(m);
			byRound.set(m.round_number, list);
		}
		out[side] = [...byRound.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([round, ms]) => ({ round, matches: ms.sort((a, b) => a.id - b.id) }));
	}
	return out;
}
