'use client';

import { useMemo } from 'react';
import { BracketLines } from '@/components/BracketLines';
import { MatchCard } from '@/components/MatchCard';
import {
	CARD_HEIGHT,
	CARD_WIDTH,
	ROUND_WIDTH,
	isScheduleFormat,
	layoutBracket
} from '@/lib/layout';
import type { Bracket, BracketSide, Match, Participant } from '@/lib/types';

interface Props {
	bracket: Bracket;
	readyIds: number[];
	onReport: (matchId: number, winnerId: number) => void;
	onChoice: (matchId: number, opponentId: number) => void;
	onOpenDetail: (matchId: number) => void;
}

const HEADER_HEIGHT = 28;

export function BracketCanvas({ bracket, readyIds, onReport, onChoice, onOpenDetail }: Props) {
	const byId = useMemo<Record<number, Participant>>(() => {
		const map: Record<number, Participant> = {};
		for (const p of bracket.participants) map[p.id] = p;
		return map;
	}, [bracket.participants]);

	const readySet = useMemo(() => new Set(readyIds), [readyIds]);
	const dimmed = useMemo(
		() => new Set(bracket.matches.filter((m) => m.status === 'not_needed').map((m) => m.id)),
		[bracket.matches]
	);

	const sides = useMemo(() => layoutBracket(bracket), [bracket]);

	const cardProps = { byId, readySet, onReport, onChoice, onOpenDetail };

	if (isScheduleFormat(bracket.format)) {
		return <ScheduleColumns bracket={bracket} {...cardProps} />;
	}

	const multi = sides.length > 1;

	return (
		<div className="overflow-auto pb-2">
			<div className="flex flex-col gap-6">
				{sides.map((side) => (
					<section key={side.side}>
						{multi && (
							<h3 className="mb-2 font-display text-xs font-bold uppercase tracking-[0.2em] text-fog-500">
								{side.label}
							</h3>
						)}
						<div style={{ width: side.width }}>
							{/* Round headers */}
							<div className="relative" style={{ height: HEADER_HEIGHT, width: side.width }}>
								{side.rounds.map((r) => (
									<div
										key={r.number}
										className="absolute truncate font-display text-[0.65rem] font-semibold uppercase tracking-widest text-court-400"
										style={{ left: r.x, width: CARD_WIDTH }}
									>
										{r.name}
									</div>
								))}
							</div>
							{/* Matches + connector lines */}
							<div className="relative" style={{ width: side.width, height: side.height }}>
								<BracketLines layout={side} dimmed={dimmed} />
								{bracket.matches
									.filter((m) => m.bracket_side === side.side && m.status !== 'bye')
									.map((m) => {
										const pos = side.positions.get(m.id);
										if (!pos) return null;
										return (
											<div
												key={m.id}
												className="absolute"
												style={{
													left: pos.x,
													top: pos.y - CARD_HEIGHT / 2,
													// The choice UI makes a card taller than its slot; lift it above neighbours.
													zIndex: m.status === 'pending_choice' ? 20 : undefined
												}}
											>
												<MatchCard
													match={m}
													byId={byId}
													ready={readySet.has(m.id)}
													onReport={onReport}
													onChoice={onChoice}
													onOpenDetail={onOpenDetail}
												/>
											</div>
										);
									})}
							</div>
						</div>
					</section>
				))}
			</div>
		</div>
	);
}

// Round-robin / Swiss keep the simple equal-spacing column flow (spec §9).
function ScheduleColumns({
	bracket,
	byId,
	readySet,
	onReport,
	onChoice,
	onOpenDetail
}: {
	bracket: Bracket;
	byId: Record<number, Participant>;
	readySet: Set<number>;
	onReport: (matchId: number, winnerId: number) => void;
	onChoice: (matchId: number, opponentId: number) => void;
	onOpenDetail: (matchId: number) => void;
}) {
	const roundName = useMemo(() => {
		const map = new Map<number, string>();
		for (const r of bracket.rounds) if (r.bracket_side === 'winners') map.set(r.number, r.name);
		return map;
	}, [bracket.rounds]);

	const columns = useMemo(() => groupByRound(bracket.matches), [bracket.matches]);

	return (
		<div className="overflow-x-auto pb-2">
			<div className="flex items-start gap-5" style={{ minWidth: columns.length * ROUND_WIDTH }}>
				{columns.map(({ round, matches }) => (
					<div key={round} className="flex shrink-0 flex-col" style={{ width: CARD_WIDTH }}>
						<div className="mb-2 font-display text-[0.65rem] font-semibold uppercase tracking-widest text-court-400">
							{roundName.get(round) ?? `Round ${round}`}
						</div>
						<div className="flex flex-col gap-3">
							{matches
								.filter((m) => m.status !== 'bye')
								.map((m) => (
									<MatchCard
										key={m.id}
										match={m}
										byId={byId}
										ready={readySet.has(m.id)}
										onReport={onReport}
										onChoice={onChoice}
										onOpenDetail={onOpenDetail}
									/>
								))}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function groupByRound(matches: Match[]): { round: number; matches: Match[] }[] {
	const winners = matches.filter((m) => (m.bracket_side as BracketSide) === 'winners');
	const byRound = new Map<number, Match[]>();
	for (const m of winners) {
		const list = byRound.get(m.round_number);
		if (list) list.push(m);
		else byRound.set(m.round_number, [m]);
	}
	return [...byRound.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([round, ms]) => ({ round, matches: ms.sort((a, b) => a.id - b.id) }));
}
