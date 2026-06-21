'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BuilderForm } from '@/components/BuilderForm';
import { MatchDetailModal } from '@/components/MatchDetailModal';
import { PhasePanel } from '@/components/PhasePanel';
import { PhaseTabs } from '@/components/PhaseTabs';
import { usePyodide } from '@/components/PyodideProvider';
import { EmptyState, Panel, Spinner } from '@/components/ui';
import { STAGE_LABEL } from '@/lib/pyodide';
import { buildCreateAction, defaultBuilderState, type BuilderState } from '@/lib/spec';
import {
	isTournamentResult,
	type Bracket,
	type DispatchResult,
	type Participant,
	type TournamentBundle
} from '@/lib/types';

export type Decide = 'seed' | 'random';
export type DetailRef = { phaseIndex: number; group: number; matchId: number };

export interface PhaseHandlers {
	onReport: (pi: number, group: number, matchId: number, winnerId: number, metadata?: Record<string, unknown>, stats?: unknown) => void;
	onChoice: (pi: number, group: number, matchId: number, opponentId: number) => void;
	onUnwind: (pi: number, group: number, matchId: number) => void;
	onUpdate: (pi: number, group: number, matchId: number, patch: { best_of?: number; metadata?: Record<string, unknown> }) => void;
	onReportGame: (pi: number, group: number, matchId: number, winnerId: number, opts?: { stats?: unknown }) => void;
	onUnwindGame: (pi: number, group: number, matchId: number) => void;
	onReportDraw: (pi: number, group: number, matchId: number, stats?: unknown) => void;
	onAdvanceSwiss: (pi: number, group: number) => void;
}

export interface PhaseLifecycle {
	publish: (pi: number) => void;
	draft: (pi: number, order?: number[]) => void;
	preview: (pi: number) => void;
	revert: (pi: number) => void;
}

export function BracketStudio() {
	const { engine, stage, error: loadError, retry } = usePyodide();
	const [state, setState] = useState<BuilderState>(defaultBuilderState);
	const [bundle, setBundle] = useState<TournamentBundle | null>(null);
	const [activePhase, setActivePhase] = useState(0);
	// The config lives in an all-DRAFT tournament that redrafts as options change. Once any result
	// is reported, a config change can't silently rebuild; `configChanged` surfaces a Reset prompt.
	const [redrafting, setRedrafting] = useState(false);
	const [configChanged, setConfigChanged] = useState(false);
	const [runtimeError, setRuntimeError] = useState<string | null>(null);
	const [detail, setDetail] = useState<DetailRef | null>(null);

	const apply = useCallback((result: DispatchResult): boolean => {
		if (!result.ok) {
			setRuntimeError(result.error);
			return false;
		}
		if (isTournamentResult(result)) {
			setRuntimeError(null);
			setBundle({ tournament: result.tournament, query: result.query });
			return true;
		}
		return false;
	}, []);

	// Build (or rebuild) the whole tournament from the current config, discarding play in progress.
	const regenerate = useCallback(() => {
		if (!engine) return;
		setRedrafting(false);
		setConfigChanged(false);
		setActivePhase(0);
		apply(engine.dispatch(buildCreateAction(state)));
	}, [engine, state, apply]);

	// Read the latest bundle through a ref so the debounced effect can check play-state without
	// re-firing whenever a result is reported (only a config change should trigger a redraft).
	const bundleRef = useRef(bundle);
	bundleRef.current = bundle;

	useEffect(() => {
		if (!engine) return;
		const pristine = isPristine(bundleRef.current);
		if (pristine && bundleRef.current) setRedrafting(true);
		const handle = setTimeout(() => {
			if (pristine) regenerate();
			else setConfigChanged(true);
		}, 350);
		return () => clearTimeout(handle);
	}, [state, engine, regenerate]);

	// Auto-draft a previewed downstream phase the moment its sources complete (the pools flow).
	useEffect(() => {
		if (!engine || !bundle) return;
		const idx = bundle.query.phases.findIndex((p) => p.is_preview && p.is_draftable);
		if (idx >= 0) {
			apply(engine.dispatch({ op: 'draft_phase', tournament: bundle.tournament, phase_id: bundle.tournament.phases[idx].id }));
		}
	}, [engine, bundle, apply]);

	const tournament = bundle?.tournament;
	const query = bundle?.query;
	// A shape change can shrink the phase list; keep the active tab in range.
	const activeIdx = query ? Math.min(activePhase, query.phases.length - 1) : 0;

	// --- phase-scoped op helpers -----------------------------------------------------------------
	const phaseOp = useCallback(
		(phaseIndex: number, action: Record<string, unknown>) => {
			if (!engine || !bundle) return;
			apply(engine.dispatch({ ...action, tournament: bundle.tournament, phase_id: bundle.tournament.phases[phaseIndex].id }));
		},
		[engine, bundle, apply]
	);

	const handlers = useMemo<PhaseHandlers>(
		() => ({
			onReport: (pi: number, group: number, matchId: number, winnerId: number, metadata?: Record<string, unknown>, stats?: unknown) =>
				phaseOp(pi, { op: 'report', group, match_id: matchId, winner_id: winnerId, metadata, stats }),
			onChoice: (pi: number, group: number, matchId: number, opponentId: number) =>
				phaseOp(pi, { op: 'report_choice', group, match_id: matchId, opponent_id: opponentId }),
			onUnwind: (pi: number, group: number, matchId: number) =>
				phaseOp(pi, { op: 'unwind', group, match_id: matchId }),
			onUpdate: (pi: number, group: number, matchId: number, patch: { best_of?: number; metadata?: Record<string, unknown> }) =>
				phaseOp(pi, { op: 'update_match', group, match_id: matchId, ...patch }),
			onReportGame: (pi: number, group: number, matchId: number, winnerId: number, opts?: { stats?: unknown }) =>
				phaseOp(pi, { op: 'report_game', group, match_id: matchId, winner_id: winnerId, stats: opts?.stats }),
			onUnwindGame: (pi: number, group: number, matchId: number) =>
				phaseOp(pi, { op: 'unwind_game', group, match_id: matchId }),
			onReportDraw: (pi: number, group: number, matchId: number, stats?: unknown) =>
				phaseOp(pi, { op: 'report_draw', group, match_id: matchId, stats }),
			onAdvanceSwiss: (pi: number, group: number) => phaseOp(pi, { op: 'advance_swiss', group })
		}),
		[phaseOp]
	);

	const lifecycle = useMemo<PhaseLifecycle>(
		() => ({
			publish: (pi: number) => phaseOp(pi, { op: 'publish_phase' }),
			draft: (pi: number, order?: number[]) => phaseOp(pi, { op: 'draft_phase', new_seed_order: order ?? null }),
			preview: (pi: number) => phaseOp(pi, { op: 'preview_phase' }),
			revert: (pi: number) => phaseOp(pi, { op: 'revert_phase' })
		}),
		[phaseOp]
	);

	// Autoplay the active phase to completion in one synchronous pass.
	const autoplay = useCallback(
		(decide: Decide) => {
			if (!engine || !bundle) return;
			const phaseId = bundle.tournament.phases[activePhase].id;
			let res: DispatchResult = { ok: true, tournament: bundle.tournament, query: bundle.query };
			let guard = 0;
			while (res.ok && isTournamentResult(res) && guard < 4000) {
				guard++;
				const t = res.tournament;
				const pq = res.query.phases[activePhase];
				let acted = false;
				for (let g = 0; g < pq.brackets.length && !acted; g++) {
					const bracket = t.phases[activePhase].brackets[g];
					const choice = bracket.matches.find((m) => m.status === 'pending_choice');
					if (choice) {
						const pool = (choice.metadata?.choice_pool as number[] | undefined) ?? [];
						if (pool.length === 0) continue;
						const pick = decide === 'random' ? pool[Math.floor(Math.random() * pool.length)] : pool[0];
						res = engine.dispatch({ op: 'report_choice', tournament: t, phase_id: phaseId, group: g, match_id: choice.id, opponent_id: pick });
						acted = true;
					} else if (pq.brackets[g].ready_match_ids.length > 0) {
						const mid = pq.brackets[g].ready_match_ids[0];
						const m = bracket.matches.find((x) => x.id === mid)!;
						const winner = pickWinner(bracket, m.participant1_id!, m.participant2_id!, decide);
						res = engine.dispatch({ op: 'report', tournament: t, phase_id: phaseId, group: g, match_id: mid, winner_id: winner });
						acted = true;
					} else if (bracket.format === 'swiss' && !pq.brackets[g].is_complete) {
						res = engine.dispatch({ op: 'advance_swiss', tournament: t, phase_id: phaseId, group: g });
						acted = true;
					}
				}
				if (!acted) break;
			}
			apply(res);
		},
		[engine, bundle, activePhase, apply]
	);

	const handleReset = useCallback(() => {
		setRuntimeError(null);
		regenerate();
	}, [regenerate]);

	const ready = engine !== null;

	// Resolve the detail-modal target (match + the bracket it lives in) from the ref.
	const detailCtx = useMemo(() => {
		if (!tournament || !detail) return null;
		const bracket: Bracket | undefined = tournament.phases[detail.phaseIndex]?.brackets[detail.group];
		const match = bracket?.matches.find((m) => m.id === detail.matchId);
		if (!bracket || !match) return null;
		const byId: Record<number, Participant> = {};
		for (const p of bracket.participants) byId[p.id] = p;
		const roundName = bracket.rounds.find((r) => r.match_ids.includes(match.id))?.name ?? '';
		const ps = tournament.phases[detail.phaseIndex].brackets[detail.group].config.points_system as
			| { draws_allowed?: boolean }
			| undefined;
		return { bracket, match, byId, roundName, drawsAllowed: !!ps?.draws_allowed };
	}, [tournament, detail]);

	return (
		<>
			<div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
				{/* Left: builder */}
				<div className="flex flex-col gap-4">
					<Panel className="p-4">
						<BuilderForm state={state} onChange={setState} />
					</Panel>
					<EngineStatus ready={ready} stage={stage} loadError={loadError} onRetry={retry} />
				</div>

				{/* Right: tournament */}
				<div className="flex min-w-0 flex-col gap-4">
					{runtimeError && (
						<div className="rounded-lg border border-rose-700 bg-rose-700/10 px-4 py-3 text-sm text-rose-300">
							{runtimeError}
						</div>
					)}

					{configChanged && bundle && (
						<div className="flex items-center justify-between gap-3 rounded-lg border border-amber-700/60 bg-amber-700/10 px-4 py-2.5 text-xs text-amber-200">
							<span>Configuration changed — reset to rebuild the tournament from the new settings.</span>
							<button type="button" onClick={handleReset} className="btn-primary shrink-0 px-3 py-1 text-xs">
								Reset
							</button>
						</div>
					)}

					{!bundle || !tournament || !query ? (
						<Panel>
							<EmptyState
								title={ready ? 'Building your tournament…' : 'Starting the engine'}
								detail={
									ready
										? 'Generating a live draft from your settings. Adjust the options to rebuild it.'
										: 'The Python runtime is loading. This happens once per visit.'
								}
							/>
						</Panel>
					) : (
						<>
							<PhaseTabs phases={query.phases} active={activeIdx} onChange={setActivePhase} onReset={handleReset} />

							<div className={`transition-opacity duration-300 ${redrafting ? 'opacity-40' : 'opacity-100'}`}>
								<PhasePanel
									tournament={tournament}
									phaseQuery={query.phases[activeIdx]}
									phaseIndex={activeIdx}
									handlers={handlers}
									lifecycle={lifecycle}
									onAutoplay={autoplay}
									onOpenDetail={(group, matchId) => setDetail({ phaseIndex: activeIdx, group, matchId })}
								/>
							</div>
						</>
					)}
				</div>
			</div>

			{detailCtx && detail && (
				<MatchDetailModal
					match={detailCtx.match}
					byId={detailCtx.byId}
					roundName={detailCtx.roundName}
					drawsAllowed={detailCtx.drawsAllowed}
					onReport={(matchId, winnerId, metadata, stats) => handlers.onReport(detail.phaseIndex, detail.group, matchId, winnerId, metadata, stats)}
					onUnwind={(matchId) => handlers.onUnwind(detail.phaseIndex, detail.group, matchId)}
					onUpdate={(matchId, patch) => handlers.onUpdate(detail.phaseIndex, detail.group, matchId, patch)}
					onReportGame={(matchId, winnerId, opts) => handlers.onReportGame(detail.phaseIndex, detail.group, matchId, winnerId, opts)}
					onUnwindGame={(matchId) => handlers.onUnwindGame(detail.phaseIndex, detail.group, matchId)}
					onReportDraw={(matchId, stats) => handlers.onReportDraw(detail.phaseIndex, detail.group, matchId, stats)}
					onClose={() => setDetail(null)}
				/>
			)}
		</>
	);
}

function EngineStatus({
	ready,
	stage,
	loadError,
	onRetry
}: {
	ready: boolean;
	stage: string | null;
	loadError: string | null;
	onRetry: () => void;
}) {
	if (loadError) {
		return (
			<Panel className="p-4">
				<p className="text-sm text-rose-300">Failed to load the Python runtime.</p>
				<p className="mt-1 text-xs text-fog-500">{loadError}</p>
				<button type="button" onClick={onRetry} className="btn-secondary mt-3 px-3 py-1 text-xs">
					Retry
				</button>
			</Panel>
		);
	}
	if (ready) {
		return (
			<div className="flex items-center gap-2 px-1 text-xs text-fog-500">
				<span className="h-2 w-2 rounded-full bg-emerald-400" />
				pybracket loaded · running in-browser
			</div>
		);
	}
	return (
		<Panel className="p-4">
			<Spinner label={stage ? STAGE_LABEL[stage as keyof typeof STAGE_LABEL] : 'Loading…'} />
		</Panel>
	);
}

// Pristine = no real result reported anywhere (byes auto-advance to 'bye', never 'completed').
function isPristine(bundle: TournamentBundle | null): boolean {
	if (!bundle) return true;
	return !bundle.tournament.phases.some((ph) =>
		ph.brackets.some((b) => b.matches.some((m) => m.status === 'completed'))
	);
}

function pickWinner(bracket: Bracket, p1: number, p2: number, decide: Decide): number {
	if (decide === 'random') return Math.random() < 0.5 ? p1 : p2;
	const s1 = bracket.participants.find((p) => p.id === p1)?.seed ?? 999;
	const s2 = bracket.participants.find((p) => p.id === p2)?.seed ?? 999;
	return s1 <= s2 ? p1 : p2;
}
