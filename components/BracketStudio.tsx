'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BracketCanvas } from '@/components/BracketCanvas';
import { BuilderForm } from '@/components/BuilderForm';
import { InspectorPanel } from '@/components/InspectorPanel';
import { MatchDetailModal } from '@/components/MatchDetailModal';
import { PoolsView } from '@/components/PoolsView';
import { StandingsPanel } from '@/components/StandingsPanel';
import { usePyodide } from '@/components/PyodideProvider';
import { Badge, EmptyState, Panel, PanelHeader, Spinner } from '@/components/ui';
import { STAGE_LABEL } from '@/lib/pyodide';
import { buildCreateAction, defaultBuilderState, type BuilderState } from '@/lib/spec';
import {
	isPoolsResult,
	type AnyDispatchResult,
	type BracketBundle,
	type Participant,
	type PoolsBundle
} from '@/lib/types';

type Decide = 'seed' | 'random';

export function BracketStudio() {
	const { engine, stage, error: loadError, retry } = usePyodide();
	const [state, setState] = useState<BuilderState>(defaultBuilderState);
	const [bundle, setBundle] = useState<BracketBundle | null>(null);
	const [poolsBundle, setPoolsBundle] = useState<PoolsBundle | null>(null);
	// The config lives in a DRAFT bracket that redrafts as options change — `redrafting` drives a
	// clean dim/dissolve while the new draft is built. Once the tournament is started (published),
	// a config change can't silently rebuild; `configChanged` surfaces a Reset prompt instead.
	const [redrafting, setRedrafting] = useState(false);
	const [configChanged, setConfigChanged] = useState(false);
	const [runtimeError, setRuntimeError] = useState<string | null>(null);
	const [detailId, setDetailId] = useState<number | null>(null);

	const byId = useMemo<Record<number, Participant>>(() => {
		const map: Record<number, Participant> = {};
		if (bundle) for (const p of bundle.bracket.participants) map[p.id] = p;
		return map;
	}, [bundle]);

	const apply = useCallback((result: AnyDispatchResult): boolean => {
		if (!result.ok) {
			setRuntimeError(result.error);
			return false;
		}
		setRuntimeError(null);
		if ('bracket' in result) setBundle({ bracket: result.bracket, query: result.query });
		return true;
	}, []);

	// Build (or rebuild) the bracket from the current config, discarding any results in progress.
	const regenerate = useCallback(() => {
		if (!engine) return;
		setRedrafting(false);
		setConfigChanged(false);
		const result = engine.dispatch(buildCreateAction(state));
		// Pools return a composite shape; everything else is a single bracket.
		if (isPoolsResult(result)) {
			setRuntimeError(null);
			setBundle(null);
			setPoolsBundle({ pools: result.pools, query: result.pools_query });
			return;
		}
		setPoolsBundle(null);
		apply(result);
	}, [engine, state, apply]);

	// Latest bundles read through refs so the debounced effect can check play-state without
	// re-firing whenever a result is reported (only a config change should trigger a redraft).
	const bundleRef = useRef(bundle);
	bundleRef.current = bundle;
	const poolsBundleRef = useRef(poolsBundle);
	poolsBundleRef.current = poolsBundle;

	// Debounced draft: ~350ms after the config settles, rebuild the DRAFT bracket (dimming the old
	// one for a clean dissolve). Once the tournament is published, a config change must not nuke
	// live results — flag it for an explicit Reset instead. Pools keep their own multi-stage flow.
	useEffect(() => {
		if (!engine) return;
		const pools = poolsBundleRef.current;
		const inDraftPhase = !pools && (!bundleRef.current || bundleRef.current.bracket.state === 'draft');
		// Only dim when there's an existing draft to dissolve into the new one.
		if (inDraftPhase && bundleRef.current) setRedrafting(true);
		const handle = setTimeout(() => {
			if (pools) {
				if (isDraftPristine(null, pools)) regenerate();
				else setConfigChanged(true);
				return;
			}
			if (!bundleRef.current || bundleRef.current.bracket.state === 'draft') {
				regenerate();
			} else {
				setConfigChanged(true);
			}
		}, 350);
		return () => clearTimeout(handle);
	}, [state, engine, regenerate]);

	const handleReport = useCallback(
		(matchId: number, winnerId: number, metadata?: Record<string, unknown>) => {
			if (!engine || !bundle) return;
			apply(
				engine.dispatch({
					op: 'report',
					bracket: bundle.bracket,
					match_id: matchId,
					winner_id: winnerId,
					metadata
				})
			);
		},
		[engine, bundle, apply]
	);

	const handleUpdate = useCallback(
		(matchId: number, patch: { best_of?: number; metadata?: Record<string, unknown> }) => {
			if (!engine || !bundle) return;
			apply(engine.dispatch({ op: 'update_match', bracket: bundle.bracket, match_id: matchId, ...patch }));
		},
		[engine, bundle, apply]
	);

	const handleUnwind = useCallback(
		(matchId: number) => {
			if (!engine || !bundle) return;
			apply(engine.dispatch({ op: 'unwind', bracket: bundle.bracket, match_id: matchId }));
		},
		[engine, bundle, apply]
	);

	const handleChoice = useCallback(
		(matchId: number, opponentId: number) => {
			if (!engine || !bundle) return;
			apply(
				engine.dispatch({
					op: 'report_choice',
					bracket: bundle.bracket,
					match_id: matchId,
					opponent_id: opponentId
				})
			);
		},
		[engine, bundle, apply]
	);

	const handleAdvanceSwiss = useCallback(() => {
		if (!engine || !bundle) return;
		apply(engine.dispatch({ op: 'advance_swiss', bracket: bundle.bracket }));
	}, [engine, bundle, apply]);

	// Runs the whole simulation in one synchronous pass, committing a single state update.
	const autoplay = useCallback(
		(decide: Decide) => {
			if (!engine || !bundle) return;
			let bracket = bundle.bracket;
			let query = bundle.query;
			let guard = 0;
			while (!query.is_complete && guard < 1000) {
				guard++;
				const choice = bracket.matches.find((m) => m.status === 'pending_choice');
				if (choice) {
					const pool = (choice.metadata?.choice_pool as number[] | undefined) ?? [];
					if (pool.length === 0) break;
					const pick = decide === 'random' ? pool[Math.floor(Math.random() * pool.length)] : pool[0];
					const res = engine.dispatch({
						op: 'report_choice',
						bracket,
						match_id: choice.id,
						opponent_id: pick
					});
					if (!res.ok || !('bracket' in res)) return apply(res);
					bracket = res.bracket;
					query = res.query;
					continue;
				}
				if (query.ready_match_ids.length === 0) {
					if (bracket.format === 'swiss') {
						const res = engine.dispatch({ op: 'advance_swiss', bracket });
						if (!res.ok || !('bracket' in res)) return apply(res);
						bracket = res.bracket;
						query = res.query;
						continue;
					}
					break;
				}
				const mid = query.ready_match_ids[0];
				const m = bracket.matches.find((x) => x.id === mid)!;
				const winner = pickWinner(bracket, m.participant1_id!, m.participant2_id!, decide);
				const res = engine.dispatch({ op: 'report', bracket, match_id: mid, winner_id: winner });
				if (!res.ok || !('bracket' in res)) return apply(res);
				bracket = res.bracket;
				query = res.query;
			}
			setRuntimeError(null);
			setBundle({ bracket, query });
		},
		[engine, bundle, apply]
	);

	// Start the tournament: publish the DRAFT bracket so results can be reported.
	const handleStart = useCallback(() => {
		if (!engine || !bundle) return;
		apply(engine.dispatch({ op: 'publish', bracket: bundle.bracket }));
	}, [engine, bundle, apply]);

	// Reset = rebuild a fresh draft from the current config, discarding results in progress.
	const handleReset = useCallback(() => {
		setRuntimeError(null);
		regenerate();
	}, [regenerate]);

	const ready = engine !== null;
	const q = bundle?.query;
	const needsSwissAdvance =
		bundle?.bracket.format === 'swiss' && q && !q.is_complete && q.ready_match_ids.length === 0;

	const detailMatch = bundle && detailId != null ? bundle.bracket.matches.find((m) => m.id === detailId) : undefined;
	const detailRound = detailMatch
		? (bundle!.bracket.rounds.find((r) => r.match_ids.includes(detailMatch.id))?.name ?? '')
		: '';

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

			{/* Right: result */}
			<div className="flex min-w-0 flex-col gap-4">
				{runtimeError && (
					<div className="rounded-lg border border-rose-700 bg-rose-700/10 px-4 py-3 text-sm text-rose-300">
						{runtimeError}
					</div>
				)}

				{configChanged && (bundle || poolsBundle) && (
					<div className="flex items-center justify-between gap-3 rounded-lg border border-amber-700/60 bg-amber-700/10 px-4 py-2.5 text-xs text-amber-200">
						<span>Configuration changed — reset to rebuild the bracket from the new settings.</span>
						<button type="button" onClick={handleReset} className="btn-primary shrink-0 px-3 py-1 text-xs">
							Reset
						</button>
					</div>
				)}

				{poolsBundle && engine ? (
					<>
						<div className="flex items-center justify-end">
							<button type="button" onClick={handleReset} className="btn-secondary px-3 py-1 text-xs">
								Reset
							</button>
						</div>
						<PoolsView
							engine={engine}
							bundle={poolsBundle}
							onChange={setPoolsBundle}
							onError={setRuntimeError}
						/>
					</>
				) : !bundle ? (
					<Panel>
						<EmptyState
							title={ready ? 'Building your bracket…' : 'Starting the engine'}
							detail={
								ready
									? 'Generating a live draft from your settings. Adjust the options to rebuild it.'
									: 'The Python runtime is loading. This happens once per visit.'
							}
						/>
					</Panel>
				) : (
					<>
						<ResultToolbar
							bundle={bundle}
							onAutoplay={autoplay}
							onAdvanceSwiss={handleAdvanceSwiss}
							onReset={handleReset}
							onStart={handleStart}
							draft={bundle.bracket.state === 'draft'}
							needsSwissAdvance={!!needsSwissAdvance}
							byId={byId}
						/>

						<ByesAddedNote config={bundle.bracket.config} />

						<div className={`transition-opacity duration-300 ${redrafting ? 'opacity-40' : 'opacity-100'}`}>
							<Panel className="p-4">
								<BracketCanvas
									bracket={bundle.bracket}
									readyIds={bundle.query.ready_match_ids}
									onReport={handleReport}
									onChoice={handleChoice}
									onOpenDetail={setDetailId}
									readOnly={bundle.bracket.state === 'draft'}
								/>
							</Panel>
						</div>

						<div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
							<Panel>
								<PanelHeader title={bundle.query.placements.length ? 'Placements' : 'Standings'} />
								<StandingsPanel query={bundle.query} byId={byId} />
							</Panel>
							<Panel>
								<InspectorPanel bracket={bundle.bracket} />
							</Panel>
						</div>
					</>
				)}
			</div>
		</div>
		{detailMatch && (
			<MatchDetailModal
				match={detailMatch}
				byId={byId}
				roundName={detailRound}
				onReport={handleReport}
				onUnwind={handleUnwind}
				onUpdate={handleUpdate}
				onClose={() => setDetailId(null)}
			/>
		)}
		</>
	);
}

function ResultToolbar({
	bundle,
	onAutoplay,
	onAdvanceSwiss,
	onReset,
	onStart,
	draft,
	needsSwissAdvance,
	byId
}: {
	bundle: BracketBundle;
	onAutoplay: (d: Decide) => void;
	onAdvanceSwiss: () => void;
	onReset: () => void;
	onStart: () => void;
	draft: boolean;
	needsSwissAdvance: boolean;
	byId: Record<number, Participant>;
}) {
	const { bracket, query } = bundle;
	const stateColor = bracket.state === 'complete' ? 'green' : bracket.state === 'published' ? 'court' : 'gray';
	return (
		<div className="flex flex-wrap items-center justify-between gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<Badge color={stateColor}>{bracket.state}</Badge>
				{query.is_complete && query.winner && (
					<Badge color="gold">🏆 {query.winner.name}</Badge>
				)}
				{!draft && needsSwissAdvance && (
					<button type="button" onClick={onAdvanceSwiss} className="btn-primary px-3 py-1 text-xs">
						Advance round →
					</button>
				)}
			</div>
			<div className="flex flex-wrap items-center gap-2">
				{draft ? (
					<button
						type="button"
						onClick={onStart}
						className="btn-primary px-4 py-1.5 text-xs"
						title="Lock in this configuration and begin reporting results"
					>
						Start tournament →
					</button>
				) : (
					<>
						<button
							type="button"
							onClick={() => onAutoplay('seed')}
							disabled={query.is_complete}
							className="btn-secondary px-3 py-1 text-xs"
							title="Play to completion with the higher seed winning every match"
						>
							Auto · seeds
						</button>
						<button
							type="button"
							onClick={() => onAutoplay('random')}
							disabled={query.is_complete}
							className="btn-secondary px-3 py-1 text-xs"
							title="Play to completion with random winners"
						>
							Auto · random
						</button>
						<button
							type="button"
							onClick={onReset}
							className="btn-secondary px-3 py-1 text-xs"
							title="Discard results and rebuild a fresh draft from the current settings"
						>
							Reset
						</button>
					</>
				)}
			</div>
		</div>
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

function ByesAddedNote({ config }: { config: Record<string, unknown> }) {
	const added = config.bye_rounds_added as Record<string, number> | undefined;
	if (!added || Object.keys(added).length === 0) return null;
	const seeds = Object.keys(added)
		.map(Number)
		.sort((a, b) => a - b);
	const detail = seeds.map((s) => `seed ${s} +${added[String(s)]}`).join(', ');
	return (
		<div className="rounded-lg border border-amber-700/60 bg-amber-700/10 px-4 py-2.5 text-xs text-amber-200">
			The engine added byes to complete the bracket: {detail}.
		</div>
	);
}

// A draft is "pristine" until a real result is reported (a match becomes completed). Byes are
// auto-advanced by the library (status 'bye', never 'completed'), so they don't count as play.
function isDraftPristine(bundle: BracketBundle | null, poolsBundle: PoolsBundle | null): boolean {
	if (poolsBundle) {
		const played =
			poolsBundle.pools.pools.some((p) => p.matches.some((m) => m.status === 'completed')) ||
			poolsBundle.pools.elimination.matches.some((m) => m.status === 'completed');
		return !played;
	}
	if (bundle) return !bundle.bracket.matches.some((m) => m.status === 'completed');
	return true;
}

function pickWinner(
	bracket: BracketBundle['bracket'],
	p1: number,
	p2: number,
	decide: Decide
): number {
	if (decide === 'random') return Math.random() < 0.5 ? p1 : p2;
	const s1 = bracket.participants.find((p) => p.id === p1)?.seed ?? 999;
	const s2 = bracket.participants.find((p) => p.id === p2)?.seed ?? 999;
	return s1 <= s2 ? p1 : p2;
}
