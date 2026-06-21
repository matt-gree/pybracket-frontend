'use client';

// A grouped phase (groups > 1): one column per sub-bracket — pools (round-robin), grouped Swiss
// pods, or wave brackets. Each column has Games | Results tabs (the matches as a compact
// round-grouped list, and the group's standings/placements). Generalized from the old pools view.

import { useMemo, useState } from 'react';
import type { PhaseHandlers } from '@/components/BracketStudio';
import { MatchCard } from '@/components/MatchCard';
import { StandingsPanel } from '@/components/StandingsPanel';
import { Badge, Tabs } from '@/components/ui';
import type { Bracket, BracketQuery, Match, Participant } from '@/lib/types';

export function groupLabel(i: number): string {
	let label = '';
	let n = i;
	do {
		label = String.fromCharCode(65 + (n % 26)) + label;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return label;
}

const emptyQuery: BracketQuery = {
	ready_match_ids: [],
	standings: [],
	placements: [],
	winner: null,
	is_complete: false
};

export function GroupedPhaseView({
	brackets,
	queries,
	phaseIndex,
	interactive,
	handlers,
	onOpenDetail
}: {
	brackets: Bracket[];
	queries: BracketQuery[];
	phaseIndex: number;
	interactive: boolean;
	handlers: PhaseHandlers;
	onOpenDetail: (group: number, matchId: number) => void;
}) {
	return (
		<div className="overflow-x-auto pb-2">
			<div className="flex items-start gap-4">
				{brackets.map((bracket, g) => (
					<GroupColumn
						key={g}
						index={g}
						bracket={bracket}
						query={queries[g] ?? emptyQuery}
						interactive={interactive}
						onReport={(mid, wid) => handlers.onReport(phaseIndex, g, mid, wid)}
						onChoice={(mid, oid) => handlers.onChoice(phaseIndex, g, mid, oid)}
						onOpenDetail={(mid) => onOpenDetail(g, mid)}
					/>
				))}
			</div>
		</div>
	);
}

function GroupColumn({
	index,
	bracket,
	query,
	interactive,
	onReport,
	onChoice,
	onOpenDetail
}: {
	index: number;
	bracket: Bracket;
	query: BracketQuery;
	interactive: boolean;
	onReport: (matchId: number, winnerId: number) => void;
	onChoice: (matchId: number, opponentId: number) => void;
	onOpenDetail: (matchId: number) => void;
}) {
	const [tab, setTab] = useState<'games' | 'results'>('games');
	const byId = useMemo<Record<number, Participant>>(() => {
		const map: Record<number, Participant> = {};
		for (const p of bracket.participants) map[p.id] = p;
		return map;
	}, [bracket.participants]);

	return (
		<div className="flex w-[300px] shrink-0 flex-col rounded-lg border border-night-700 bg-night-900/40">
			<div className="flex items-center justify-between border-b border-night-800 px-3 py-2">
				<h3 className="font-display text-sm font-bold uppercase tracking-[0.2em] text-fog-200">
					Group {groupLabel(index)}
				</h3>
				<Badge color={query.is_complete ? 'green' : 'court'}>{query.is_complete ? 'Complete' : 'In progress'}</Badge>
			</div>
			<div className="px-2 pt-1.5">
				<Tabs
					tabs={[
						{ id: 'games', label: 'Games' },
						{ id: 'results', label: 'Results' }
					]}
					active={tab}
					onChange={setTab}
				/>
			</div>
			<div className="p-2.5">
				{tab === 'games' ? (
					<GroupGames
						bracket={bracket}
						readyIds={interactive ? query.ready_match_ids : []}
						byId={byId}
						interactive={interactive}
						onReport={onReport}
						onChoice={onChoice}
						onOpenDetail={onOpenDetail}
					/>
				) : (
					<StandingsPanel query={query} byId={byId} />
				)}
			</div>
		</div>
	);
}

// A group's matches as a compact vertical list grouped by round — fits a single column.
function GroupGames({
	bracket,
	readyIds,
	byId,
	interactive,
	onReport,
	onChoice,
	onOpenDetail
}: {
	bracket: Bracket;
	readyIds: number[];
	byId: Record<number, Participant>;
	interactive: boolean;
	onReport: (matchId: number, winnerId: number) => void;
	onChoice: (matchId: number, opponentId: number) => void;
	onOpenDetail: (matchId: number) => void;
}) {
	const readySet = useMemo(() => new Set(readyIds), [readyIds]);
	const rounds = useMemo(() => {
		const byRound = new Map<number, Match[]>();
		for (const m of bracket.matches) {
			if (m.status === 'bye') continue;
			const list = byRound.get(m.round_number);
			if (list) list.push(m);
			else byRound.set(m.round_number, [m]);
		}
		return [...byRound.entries()].sort((a, b) => a[0] - b[0]);
	}, [bracket.matches]);

	const roundName = useMemo(() => {
		const map = new Map<number, string>();
		for (const r of bracket.rounds) map.set(r.number, r.name);
		return map;
	}, [bracket.rounds]);

	return (
		<div className="flex flex-col gap-3">
			{rounds.map(([round, matches]) => (
				<div key={round} className="flex flex-col gap-1.5">
					<span className="font-display text-[0.6rem] font-semibold uppercase tracking-widest text-court-400">
						{roundName.get(round) ?? `Round ${round}`}
					</span>
					{matches
						.sort((a, b) => a.id - b.id)
						.map((m) => (
							<MatchCard
								key={m.id}
								match={m}
								byId={byId}
								ready={readySet.has(m.id)}
								onReport={onReport}
								onChoice={onChoice}
								onOpenDetail={onOpenDetail}
								readOnly={!interactive}
							/>
						))}
				</div>
			))}
		</div>
	);
}
