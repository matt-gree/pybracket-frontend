'use client';

// Renders the active phase, routing by lifecycle then format:
//   • no brackets  → Locked (waiting on sources) or Ready-to-draft.
//   • DRAFT        → a preview (placeholder names), the field phase awaiting Start, or a drafted
//                    downstream phase awaiting seeding-confirm.
//   • live/complete→ the interactive runner for the format (elim canvas / schedule / pools / league).

import { useMemo } from 'react';
import { BracketCanvas } from '@/components/BracketCanvas';
import type { Decide, PhaseHandlers, PhaseLifecycle } from '@/components/BracketStudio';
import { GroupedPhaseView } from '@/components/GroupedPhaseView';
import { InspectorPanel } from '@/components/InspectorPanel';
import { LeagueView } from '@/components/LeagueView';
import { SeedingPanel } from '@/components/SeedingPanel';
import { StandingsPanel } from '@/components/StandingsPanel';
import { Badge, Panel, PanelHeader } from '@/components/ui';
import type { Bracket, BracketQuery, Participant, PhaseQuery, Tournament } from '@/lib/types';

interface Props {
	tournament: Tournament;
	phaseQuery: PhaseQuery;
	phaseIndex: number;
	handlers: PhaseHandlers;
	lifecycle: PhaseLifecycle;
	onAutoplay: (d: Decide) => void;
	onOpenDetail: (group: number, matchId: number) => void;
}

export function PhasePanel({ tournament, phaseQuery: pq, phaseIndex, handlers, lifecycle, onAutoplay, onOpenDetail }: Props) {
	const phase = tournament.phases[phaseIndex];
	const isFieldPhase = phase.entrants == null;

	// --- locked / ready-to-draft (no brackets built yet) ---------------------------------------
	if (!pq.has_brackets) {
		const sources = phase.entrants ? [...new Set(phase.entrants.sources.map((s) => s.phase))] : [];
		return (
			<Panel className="p-8">
				<div className="flex flex-col items-center gap-3 text-center">
					<Badge color={pq.is_draftable ? 'gold' : 'gray'}>{pq.is_draftable ? 'Ready to draft' : 'Locked'}</Badge>
					<p className="max-w-md text-sm text-fog-400">
						{pq.is_draftable
							? 'Its source phases are complete. Draft the bracket to review seeding, then start it.'
							: `Waiting for ${sources.join(', ') || 'earlier phases'} to finish before this phase can be built.`}
					</p>
					<div className="flex gap-2">
						{pq.is_draftable && (
							<button type="button" onClick={() => lifecycle.draft(phaseIndex)} className="btn-primary px-4 py-1.5 text-xs">
								Draft phase →
							</button>
						)}
						<button type="button" onClick={() => lifecycle.preview(phaseIndex)} className="btn-secondary px-3 py-1.5 text-xs">
							Preview bracket
						</button>
					</div>
				</div>
			</Panel>
		);
	}

	const live = phase.state === 'published' || phase.state === 'complete';

	// --- DRAFT lifecycle states ----------------------------------------------------------------
	if (!live) {
		if (pq.is_preview) {
			return (
				<div className="flex flex-col gap-4">
					<p className="rounded-lg border border-night-700 bg-night-850 px-4 py-2.5 text-xs text-fog-400">
						Preliminary seeding — every slot shows the finish that will fill it. Real names drop in as the
						source phases complete, then this bracket is drafted automatically.
					</p>
					<PhaseBody phase={phase} pq={pq} phaseIndex={phaseIndex} interactive={false} handlers={handlers} onOpenDetail={onOpenDetail} />
				</div>
			);
		}

		if (isFieldPhase) {
			return (
				<div className="flex flex-col gap-4">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<Badge color="gray">Draft — not started</Badge>
						<button type="button" onClick={() => lifecycle.publish(phaseIndex)} className="btn-primary px-4 py-1.5 text-xs">
							Start tournament →
						</button>
					</div>
					<PhaseBody phase={phase} pq={pq} phaseIndex={phaseIndex} interactive={false} handlers={handlers} onOpenDetail={onOpenDetail} />
				</div>
			);
		}

		// Drafted downstream phase: confirm seeding (single bracket) then publish.
		return (
			<div className="flex flex-col gap-4">
				{phase.brackets.length === 1 ? (
					<SeedingPanel
						bracket={phase.brackets[0]}
						onReorder={(order) => lifecycle.draft(phaseIndex, order)}
						onPublish={() => lifecycle.publish(phaseIndex)}
					/>
				) : (
					<div className="flex items-center justify-between gap-3 rounded-lg border border-star-500/40 bg-star-500/5 px-4 py-2.5">
						<p className="text-xs text-fog-400">Drafted into {phase.brackets.length} groups — confirm to start.</p>
						<button type="button" onClick={() => lifecycle.publish(phaseIndex)} className="btn-primary px-3 py-1.5 text-xs">
							Start phase →
						</button>
					</div>
				)}
				<PhaseBody phase={phase} pq={pq} phaseIndex={phaseIndex} interactive={false} handlers={handlers} onOpenDetail={onOpenDetail} />
			</div>
		);
	}

	// --- live / complete -----------------------------------------------------------------------
	const winner = pq.brackets.find((b) => b.winner)?.winner;
	const needsSwiss = phase.format === 'swiss' && pq.brackets.some((b, g) => !b.is_complete && b.ready_match_ids.length === 0 && phase.brackets[g]);
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex flex-wrap items-center gap-2">
					<Badge color={pq.is_complete ? 'green' : 'court'}>{phase.state}</Badge>
					{pq.is_complete && winner && <Badge color="gold">🏆 {winner.name}</Badge>}
					{needsSwiss && (
						<button type="button" onClick={() => handlers.onAdvanceSwiss(phaseIndex, 0)} className="btn-primary px-3 py-1 text-xs">
							Advance round →
						</button>
					)}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<button type="button" onClick={() => onAutoplay('seed')} disabled={pq.is_complete} className="btn-secondary px-3 py-1 text-xs" title="Play the higher seed in every match">
						Auto · seeds
					</button>
					<button type="button" onClick={() => onAutoplay('random')} disabled={pq.is_complete} className="btn-secondary px-3 py-1 text-xs" title="Play random winners">
						Auto · random
					</button>
				</div>
			</div>
			<PhaseBody phase={phase} pq={pq} phaseIndex={phaseIndex} interactive handlers={handlers} onOpenDetail={onOpenDetail} />
		</div>
	);
}

// The format-specific body, shared by the draft/preview (non-interactive) and live views.
function PhaseBody({
	phase,
	pq,
	phaseIndex,
	interactive,
	handlers,
	onOpenDetail
}: {
	phase: { format: Bracket['format']; brackets: Bracket[] };
	pq: PhaseQuery;
	phaseIndex: number;
	interactive: boolean;
	handlers: PhaseHandlers;
	onOpenDetail: (group: number, matchId: number) => void;
}) {
	if (phase.brackets.length > 1) {
		return (
			<GroupedPhaseView
				brackets={phase.brackets}
				queries={pq.brackets}
				phaseIndex={phaseIndex}
				interactive={interactive}
				handlers={handlers}
				onOpenDetail={onOpenDetail}
			/>
		);
	}

	const bracket = phase.brackets[0];
	const bq = pq.brackets[0];

	if (phase.format === 'league' && pq.league) {
		return (
			<LeagueView
				bracket={bracket}
				query={bq}
				extras={pq.league}
				phaseIndex={phaseIndex}
				interactive={interactive}
				handlers={handlers}
				onOpenDetail={onOpenDetail}
			/>
		);
	}

	return <SingleBracket bracket={bracket} query={bq} phaseIndex={phaseIndex} group={0} interactive={interactive} handlers={handlers} onOpenDetail={onOpenDetail} />;
}

// Elimination / round-robin / Swiss single bracket: canvas + a standings/placements table.
export function SingleBracket({
	bracket,
	query,
	phaseIndex,
	group,
	interactive,
	handlers,
	onOpenDetail
}: {
	bracket: Bracket;
	query: BracketQuery;
	phaseIndex: number;
	group: number;
	interactive: boolean;
	handlers: PhaseHandlers;
	onOpenDetail: (group: number, matchId: number) => void;
}) {
	const byId = useMemo<Record<number, Participant>>(() => {
		const map: Record<number, Participant> = {};
		for (const p of bracket.participants) map[p.id] = p;
		return map;
	}, [bracket.participants]);

	return (
		<>
			<Panel className="p-4">
				<BracketCanvas
					bracket={bracket}
					readyIds={interactive ? query.ready_match_ids : []}
					onReport={(mid, wid) => handlers.onReport(phaseIndex, group, mid, wid)}
					onChoice={(mid, oid) => handlers.onChoice(phaseIndex, group, mid, oid)}
					onOpenDetail={(mid) => onOpenDetail(group, mid)}
					readOnly={!interactive}
				/>
			</Panel>
			<div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
				<Panel>
					<PanelHeader title={query.placements.length ? 'Placements' : 'Standings'} />
					<StandingsPanel query={query} byId={byId} />
				</Panel>
				<Panel>
					<InspectorPanel bracket={bracket} />
				</Panel>
			</div>
		</>
	);
}
