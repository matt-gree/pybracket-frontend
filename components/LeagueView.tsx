'use client';

// A league phase: a Schedule tab (matchweeks of fixtures, home vs away, with a division/cross tag)
// and a Standings tab (per-division tables plus the overall table). The schedule comes from the
// bridge's league read-model (pb.league_schedule); standings from division_standings + overall.

import { useMemo, useState } from 'react';
import type { PhaseHandlers } from '@/components/BracketStudio';
import { MatchCard } from '@/components/MatchCard';
import { StandingsPanel } from '@/components/StandingsPanel';
import { Badge, Panel, PanelHeader, Tabs } from '@/components/ui';
import type { Bracket, BracketQuery, LeagueExtras, Match, Participant, Standing } from '@/lib/types';

export function LeagueView({
	bracket,
	query,
	extras,
	phaseIndex,
	interactive,
	handlers,
	onOpenDetail
}: {
	bracket: Bracket;
	query: BracketQuery;
	extras: LeagueExtras;
	phaseIndex: number;
	interactive: boolean;
	handlers: PhaseHandlers;
	onOpenDetail: (group: number, matchId: number) => void;
}) {
	const [tab, setTab] = useState<'schedule' | 'standings'>('schedule');
	const byId = useMemo<Record<number, Participant>>(() => {
		const map: Record<number, Participant> = {};
		for (const p of bracket.participants) map[p.id] = p;
		return map;
	}, [bracket.participants]);
	const matchById = useMemo<Record<number, Match>>(() => {
		const map: Record<number, Match> = {};
		for (const m of bracket.matches) map[m.id] = m;
		return map;
	}, [bracket.matches]);
	const readySet = useMemo(() => new Set(interactive ? query.ready_match_ids : []), [interactive, query.ready_match_ids]);
	const multiDivision = extras.divisions.length > 1;

	return (
		<div className="flex flex-col gap-4">
			<Tabs
				tabs={[
					{ id: 'schedule', label: 'Schedule' },
					{ id: 'standings', label: 'Standings' }
				]}
				active={tab}
				onChange={setTab}
			/>

			{tab === 'schedule' ? (
				<div className="flex flex-col gap-4">
					{extras.schedule.map((week) => (
						<div key={week.number} className="flex flex-col gap-1.5">
							<span className="font-display text-[0.65rem] font-semibold uppercase tracking-widest text-court-400">
								Matchweek {week.number}
							</span>
							<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
								{week.fixtures.map((f) => {
									const m = matchById[f.match_id];
									if (!m) return null;
									return (
										<div key={f.match_id} className="flex flex-col gap-0.5">
											<MatchCard
												match={m}
												byId={byId}
												ready={readySet.has(m.id)}
												onReport={(mid, wid) => handlers.onReport(phaseIndex, 0, mid, wid)}
												onChoice={(mid, oid) => handlers.onChoice(phaseIndex, 0, mid, oid)}
												onOpenDetail={(mid) => onOpenDetail(0, mid)}
												readOnly={!interactive}
											/>
											<span className="pl-1 font-display text-[0.55rem] uppercase tracking-widest text-fog-600">
												{f.division == null ? 'Cross-division' : multiDivision ? `Division ${f.division + 1}` : 'League'}
												{' · '}
												{byId[f.home_id]?.name ?? `#${f.home_id}`} hosts
											</span>
										</div>
									);
								})}
							</div>
						</div>
					))}
				</div>
			) : (
				<div className="flex flex-col gap-4">
					{multiDivision && (
						<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
							{extras.division_standings.map((standings, d) => (
								<Panel key={d}>
									<PanelHeader title={`Division ${d + 1}`} />
									<StandingsTable standings={standings} byId={byId} />
								</Panel>
							))}
						</div>
					)}
					<Panel>
						<PanelHeader title={multiDivision ? 'Overall table' : 'League table'} />
						{/* Always the points/record table — never elimination-style placements, even once complete. */}
						<StandingsTable standings={query.standings} byId={byId} />
					</Panel>
				</div>
			)}
		</div>
	);
}

// A division table reuses StandingsPanel by wrapping the raw standings in a minimal query.
function StandingsTable({ standings, byId }: { standings: Standing[]; byId: Record<number, Participant> }) {
	const query: BracketQuery = {
		ready_match_ids: [],
		standings,
		placements: [],
		winner: null,
		is_complete: false
	};
	return <StandingsPanel query={query} byId={byId} />;
}
