'use client';

// Pools format view. A global two-tab layout (Pools | Bracket) lets the organizer flip between
// running the pools and watching the elimination bracket fill in:
//   • Pools tab — one column per pool, each with its own Games | Results tabs.
//   • Bracket tab — a PRELIMINARY bracket from the start (library `preview_pools_bracket`, slots
//     labelled "Pool A #1"); real names drop in as pools finish; once every pool is complete the
//     bracket is drafted for real (SeedingPanel reorder) and then published for play.
// The pool→slot mapping and the bracket structure come entirely from the library — the frontend
// only swaps placeholder labels for the real qualifier names it already has.

import { useEffect, useMemo, useState } from 'react';
import { BracketCanvas } from '@/components/BracketCanvas';
import { MatchCard } from '@/components/MatchCard';
import { MatchDetailModal } from '@/components/MatchDetailModal';
import { SeedingPanel } from '@/components/SeedingPanel';
import { StandingsPanel } from '@/components/StandingsPanel';
import { Badge, Panel, Tabs } from '@/components/ui';
import type { Engine } from '@/lib/pyodide';
import {
	isPoolsResult,
	type Bracket,
	type BracketQuery,
	type Participant,
	type PoolsBundle
} from '@/lib/types';

interface Props {
	engine: Engine;
	bundle: PoolsBundle;
	onChange: (next: PoolsBundle) => void;
	onError: (message: string | null) => void;
}

type DetailRef = { src: 'elim' | number; matchId: number } | null;

function poolLabel(i: number): string {
	let label = '';
	let n = i;
	do {
		label = String.fromCharCode(65 + (n % 26)) + label;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return label;
}

/** Swap preview placeholder names ("Pool A #1") for the real qualifier once that pool is done. */
function resolvePreviewNames(
	elim: Bracket,
	poolQueries: BracketQuery[],
	byId: Record<number, Participant>
): Bracket {
	let changed = false;
	const participants = elim.participants.map((p) => {
		const pool = p.stats?.origin_pool as number | undefined;
		const place = p.stats?.origin_place as number | undefined;
		if (!p.stats?.placeholder || typeof pool !== 'number' || typeof place !== 'number') return p;
		const pq = poolQueries[pool];
		if (!pq?.is_complete) return p;
		const ranked = [...pq.standings].sort((a, b) => a.rank - b.rank)[place - 1];
		const real = ranked && byId[ranked.participant_id];
		if (!real) return p;
		changed = true;
		return { ...p, name: real.name };
	});
	return changed ? { ...elim, participants } : elim;
}

export function PoolsView({ engine, bundle, onChange, onError }: Props) {
	const [globalTab, setGlobalTab] = useState<'pools' | 'bracket'>('pools');
	const [detail, setDetail] = useState<DetailRef>(null);

	const byId = useMemo<Record<number, Participant>>(() => {
		const map: Record<number, Participant> = {};
		for (const p of bundle.pools.participants) map[p.id] = p;
		return map;
	}, [bundle.pools.participants]);

	const { pools, elimination, config } = bundle.pools;
	const q = bundle.query;
	const isPreview = config.preview === true;
	const phase: 'preview' | 'draft' | 'live' = isPreview
		? 'preview'
		: q.elimination_state === 'draft'
			? 'draft'
			: 'live';

	// --- mutations -------------------------------------------------------------------------
	function updatePool(index: number, bracket: Bracket, query: BracketQuery) {
		const nextPools = pools.slice();
		nextPools[index] = bracket;
		const nextPoolQueries = q.pools.slice();
		nextPoolQueries[index] = query;
		onChange({
			pools: { ...bundle.pools, pools: nextPools },
			query: { ...q, pools: nextPoolQueries, pools_complete: nextPoolQueries.every((x) => x.is_complete) }
		});
	}

	function updateElim(bracket: Bracket, query: BracketQuery) {
		onChange({
			pools: { ...bundle.pools, elimination: bracket },
			query: { ...q, elimination: query, elimination_state: bracket.state }
		});
	}

	function runOnSub(
		bracket: Bracket,
		action: Record<string, unknown>,
		commit: (b: Bracket, query: BracketQuery) => void
	) {
		const result = engine.dispatch({ ...action, bracket });
		if (!result.ok) return onError(result.error);
		if ('bracket' in result) {
			onError(null);
			commit(result.bracket, result.query);
		}
	}

	const poolHandlers = (index: number) => ({
		onReport: (matchId: number, winnerId: number, metadata?: Record<string, unknown>) =>
			runOnSub(pools[index], { op: 'report', match_id: matchId, winner_id: winnerId, metadata }, (b, query) =>
				updatePool(index, b, query)
			),
		onChoice: (matchId: number, opponentId: number) =>
			runOnSub(pools[index], { op: 'report_choice', match_id: matchId, opponent_id: opponentId }, (b, query) =>
				updatePool(index, b, query)
			),
		onUnwind: (matchId: number) =>
			runOnSub(pools[index], { op: 'unwind', match_id: matchId }, (b, query) => updatePool(index, b, query)),
		onUpdate: (matchId: number, patch: { best_of?: number; metadata?: Record<string, unknown> }) =>
			runOnSub(pools[index], { op: 'update_match', match_id: matchId, ...patch }, (b, query) =>
				updatePool(index, b, query)
			)
	});

	const elimHandlers = {
		onReport: (matchId: number, winnerId: number, metadata?: Record<string, unknown>) =>
			runOnSub(elimination, { op: 'report', match_id: matchId, winner_id: winnerId, metadata }, updateElim),
		onChoice: (matchId: number, opponentId: number) =>
			runOnSub(elimination, { op: 'report_choice', match_id: matchId, opponent_id: opponentId }, updateElim),
		onUnwind: (matchId: number) => runOnSub(elimination, { op: 'unwind', match_id: matchId }, updateElim),
		onUpdate: (matchId: number, patch: { best_of?: number; metadata?: Record<string, unknown> }) =>
			runOnSub(elimination, { op: 'update_match', match_id: matchId, ...patch }, updateElim)
	};

	function applyPools(result: ReturnType<Engine['dispatch']>) {
		if (!result.ok) return onError(result.error);
		if (isPoolsResult(result)) {
			onError(null);
			onChange({ pools: result.pools, query: result.pools_query });
		}
	}

	const reseed = (order: number[]) =>
		applyPools(engine.dispatch({ op: 'reseed_pools', pools_bracket: bundle.pools, new_seed_order: order }));
	const publish = () => applyPools(engine.dispatch({ op: 'publish_bracket', pools_bracket: bundle.pools }));

	// When the pools finish, replace the placeholder preview with the real drafted bracket.
	useEffect(() => {
		if (engine && isPreview && q.pools_complete) {
			applyPools(engine.dispatch({ op: 'draft_pools', pools_bracket: bundle.pools }));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [engine, isPreview, q.pools_complete]);

	// Preview slots show real names for the pools that have already finished.
	const elimForDisplay = useMemo(
		() => (isPreview ? resolvePreviewNames(elimination, q.pools, byId) : elimination),
		[isPreview, elimination, q.pools, byId]
	);
	const elimById = useMemo<Record<number, Participant>>(() => {
		const map: Record<number, Participant> = {};
		for (const p of elimForDisplay.participants) map[p.id] = p;
		return map;
	}, [elimForDisplay.participants]);

	// --- detail modal ----------------------------------------------------------------------
	const detailSub: Bracket | null = detail ? (detail.src === 'elim' ? elimination : pools[detail.src]) : null;
	const detailMatch = detailSub?.matches.find((m) => m.id === detail?.matchId);
	const detailHandlers = detail?.src === 'elim' ? elimHandlers : detail ? poolHandlers(detail.src) : null;
	const detailRound = detailMatch
		? (detailSub!.rounds.find((r) => r.match_ids.includes(detailMatch.id))?.name ?? '')
		: '';

	return (
		<div className="flex flex-col gap-4">
			<Tabs
				tabs={[
					{
						id: 'pools',
						label: 'Pools',
						badge: <Badge color={q.pools_complete ? 'green' : 'court'}>{pools.length}</Badge>
					},
					{ id: 'bracket', label: 'Bracket', badge: <PhaseBadge phase={phase} q={q} /> }
				]}
				active={globalTab}
				onChange={setGlobalTab}
			/>

			{globalTab === 'pools' ? (
				<div className="overflow-x-auto pb-2">
					<div className="flex items-start gap-4">
						{pools.map((pool, i) => (
							<PoolColumn
								key={i}
								index={i}
								pool={pool}
								query={q.pools[i]}
								byId={byId}
								handlers={poolHandlers(i)}
								onOpenDetail={(matchId) => setDetail({ src: i, matchId })}
								advanceCount={Number(config.advancement_count) || 0}
							/>
						))}
					</div>
				</div>
			) : (
				<div className="flex flex-col gap-4">
					{phase === 'preview' && (
						<p className="rounded-lg border border-night-700 bg-night-850 px-4 py-2.5 text-xs text-fog-400">
							Preliminary seeding — every slot shows the pool finish that will fill it. Real names drop
							in as pools complete, then you can confirm the bracket.
						</p>
					)}
					{phase === 'draft' && (
						<SeedingPanel elimination={elimination} byId={elimById} onReorder={reseed} onPublish={publish} busy={false} />
					)}
					{phase === 'live' && (
						<div className="flex items-center gap-2">
							<Badge color={q.elimination.is_complete ? 'green' : 'court'}>
								Elimination · {q.elimination_state}
							</Badge>
							{q.elimination.is_complete && q.elimination.winner && (
								<Badge color="gold">🏆 {q.elimination.winner.name}</Badge>
							)}
						</div>
					)}
					<Panel className="p-4">
						<BracketCanvas
							bracket={elimForDisplay}
							readyIds={phase === 'live' ? q.elimination.ready_match_ids : []}
							onReport={phase === 'live' ? elimHandlers.onReport : () => {}}
							onChoice={phase === 'live' ? elimHandlers.onChoice : () => {}}
							onOpenDetail={phase === 'live' ? (matchId) => setDetail({ src: 'elim', matchId }) : () => {}}
						/>
					</Panel>
				</div>
			)}

			{detailMatch && detailHandlers && (
				<MatchDetailModal
					match={detailMatch}
					byId={byId}
					roundName={detailRound}
					onReport={detailHandlers.onReport}
					onUnwind={detailHandlers.onUnwind}
					onUpdate={detailHandlers.onUpdate}
					onClose={() => setDetail(null)}
				/>
			)}
		</div>
	);
}

function PhaseBadge({ phase, q }: { phase: 'preview' | 'draft' | 'live'; q: PoolsBundle['query'] }) {
	if (phase === 'preview') return <Badge color="gray">Preview</Badge>;
	if (phase === 'draft') return <Badge color="court">Draft</Badge>;
	return <Badge color={q.elimination.is_complete ? 'green' : 'court'}>Live</Badge>;
}

function PoolColumn({
	index,
	pool,
	query,
	byId,
	handlers,
	onOpenDetail,
	advanceCount
}: {
	index: number;
	pool: Bracket;
	query: BracketQuery | undefined;
	byId: Record<number, Participant>;
	handlers: { onReport: (matchId: number, winnerId: number) => void; onChoice: (matchId: number, opponentId: number) => void };
	onOpenDetail: (matchId: number) => void;
	advanceCount: number;
}) {
	const [tab, setTab] = useState<'games' | 'results'>('games');
	const complete = query?.is_complete ?? false;

	return (
		<div className="flex w-[300px] shrink-0 flex-col rounded-lg border border-night-700 bg-night-900/40">
			<div className="flex items-center justify-between border-b border-night-800 px-3 py-2">
				<h3 className="font-display text-sm font-bold uppercase tracking-[0.2em] text-fog-200">
					Pool {poolLabel(index)}
				</h3>
				<Badge color={complete ? 'green' : 'court'}>{complete ? 'Complete' : 'In progress'}</Badge>
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
					<PoolGames
						pool={pool}
						readyIds={query?.ready_match_ids ?? []}
						byId={byId}
						onReport={handlers.onReport}
						onChoice={handlers.onChoice}
						onOpenDetail={onOpenDetail}
					/>
				) : (
					<>
						{advanceCount > 0 && (
							<p className="mb-2 text-[0.7rem] text-fog-500">Top {advanceCount} advance.</p>
						)}
						<StandingsPanel query={query ?? emptyQuery} byId={byId} />
					</>
				)}
			</div>
		</div>
	);
}

// A pool round-robin shown as a compact vertical list grouped by round — fits a single column,
// unlike the wide schedule view used on the standalone round-robin canvas.
function PoolGames({
	pool,
	readyIds,
	byId,
	onReport,
	onChoice,
	onOpenDetail
}: {
	pool: Bracket;
	readyIds: number[];
	byId: Record<number, Participant>;
	onReport: (matchId: number, winnerId: number) => void;
	onChoice: (matchId: number, opponentId: number) => void;
	onOpenDetail: (matchId: number) => void;
}) {
	const readySet = useMemo(() => new Set(readyIds), [readyIds]);
	const rounds = useMemo(() => {
		const byRound = new Map<number, typeof pool.matches>();
		for (const m of pool.matches) {
			if (m.status === 'bye') continue;
			const list = byRound.get(m.round_number);
			if (list) list.push(m);
			else byRound.set(m.round_number, [m]);
		}
		return [...byRound.entries()].sort((a, b) => a[0] - b[0]);
	}, [pool.matches]);

	const roundName = useMemo(() => {
		const map = new Map<number, string>();
		for (const r of pool.rounds) map.set(r.number, r.name);
		return map;
	}, [pool.rounds]);

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
							/>
						))}
				</div>
			))}
		</div>
	);
}

const emptyQuery: BracketQuery = {
	ready_match_ids: [],
	standings: [],
	placements: [],
	winner: null,
	is_complete: false
};
