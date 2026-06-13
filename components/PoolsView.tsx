'use client';

// Pools format view (spec §2). Three phases driven by the elimination bracket's state:
//   1. Play the round-robin pools.
//   2. Once every pool is complete, draft the survivors into a DRAFT elimination bracket and
//      let the organizer reorder the seeds (SeedingPanel).
//   3. Publish to lock the bracket in, then play it like any elimination bracket.

import { useMemo, useState } from 'react';
import { BracketCanvas } from '@/components/BracketCanvas';
import { MatchDetailModal } from '@/components/MatchDetailModal';
import { SeedingPanel } from '@/components/SeedingPanel';
import { Badge, Panel } from '@/components/ui';
import type { Engine } from '@/lib/pyodide';
import { isPoolsResult, type Bracket, type Participant, type PoolsBundle } from '@/lib/types';

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

export function PoolsView({ engine, bundle, onChange, onError }: Props) {
	const [detail, setDetail] = useState<DetailRef>(null);

	const byId = useMemo<Record<number, Participant>>(() => {
		const map: Record<number, Participant> = {};
		for (const p of bundle.pools.participants) map[p.id] = p;
		return map;
	}, [bundle.pools.participants]);

	const { pools, elimination, config } = bundle.pools;
	const q = bundle.query;
	const phase: 'pools' | 'draft' | 'live' =
		elimination.matches.length === 0 ? 'pools' : q.elimination_state === 'draft' ? 'draft' : 'live';

	// --- mutations -------------------------------------------------------------------------
	function poolsData() {
		return bundle.pools;
	}

	function updatePool(index: number, bracket: Bracket, query: PoolsBundle['query']['pools'][number]) {
		const nextPools = pools.slice();
		nextPools[index] = bracket;
		const nextPoolQueries = q.pools.slice();
		nextPoolQueries[index] = query;
		onChange({
			pools: { ...bundle.pools, pools: nextPools },
			query: { ...q, pools: nextPoolQueries, pools_complete: nextPoolQueries.every((x) => x.is_complete) }
		});
	}

	function updateElim(bracket: Bracket, query: PoolsBundle['query']['elimination']) {
		onChange({
			pools: { ...bundle.pools, elimination: bracket },
			query: { ...q, elimination: query, elimination_state: bracket.state }
		});
	}

	function runOnSub(
		bracket: Bracket,
		action: Record<string, unknown>,
		commit: (b: Bracket, query: PoolsBundle['query']['elimination']) => void
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

	const draftBracket = () => applyPools(engine.dispatch({ op: 'draft_pools', pools_bracket: poolsData() }));
	const reseed = (order: number[]) =>
		applyPools(engine.dispatch({ op: 'reseed_pools', pools_bracket: poolsData(), new_seed_order: order }));
	const publish = () => applyPools(engine.dispatch({ op: 'publish_bracket', pools_bracket: poolsData() }));

	// --- detail modal ----------------------------------------------------------------------
	const detailSub: Bracket | null = detail ? (detail.src === 'elim' ? elimination : pools[detail.src]) : null;
	const detailMatch = detailSub?.matches.find((m) => m.id === detail?.matchId);
	const detailHandlers = detail?.src === 'elim' ? elimHandlers : detail ? poolHandlers(detail.src) : null;
	const detailRound = detailMatch
		? (detailSub!.rounds.find((r) => r.match_ids.includes(detailMatch.id))?.name ?? '')
		: '';

	return (
		<div className="flex flex-col gap-4">
			{/* Pools */}
			<Panel className="p-4">
				<div className="mb-3 flex items-center gap-2">
					<Badge color={q.pools_complete ? 'green' : 'court'}>
						{q.pools_complete ? 'Pools complete' : 'Pools in progress'}
					</Badge>
					<span className="text-xs text-fog-500">
						{pools.length} pools · top {Number(config.advancement_count) || ''} advance
					</span>
				</div>
				<div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
					{pools.map((pool, i) => (
						<div key={i}>
							<h3 className="mb-2 font-display text-xs font-bold uppercase tracking-[0.2em] text-fog-400">
								Pool {poolLabel(i)}
							</h3>
							<BracketCanvas
								bracket={pool}
								readyIds={q.pools[i]?.ready_match_ids ?? []}
								onReport={poolHandlers(i).onReport}
								onChoice={poolHandlers(i).onChoice}
								onOpenDetail={(matchId) => setDetail({ src: i, matchId })}
							/>
						</div>
					))}
				</div>
			</Panel>

			{/* Draft seeding */}
			{phase === 'pools' && q.pools_complete && (
				<div className="flex justify-center">
					<button type="button" onClick={draftBracket} className="btn-primary px-4 py-2">
						Seed elimination bracket →
					</button>
				</div>
			)}

			{phase === 'draft' && (
				<>
					<SeedingPanel
						elimination={elimination}
						byId={byId}
						onReorder={reseed}
						onPublish={publish}
						busy={false}
					/>
					<Panel className="p-4">
						<BracketCanvas
							bracket={elimination}
							readyIds={[]}
							onReport={() => {}}
							onChoice={() => {}}
							onOpenDetail={() => {}}
							draft
						/>
					</Panel>
				</>
			)}

			{phase === 'live' && (
				<Panel className="p-4">
					<div className="mb-3 flex items-center gap-2">
						<Badge color={q.elimination.is_complete ? 'green' : 'court'}>
							Elimination · {q.elimination_state}
						</Badge>
						{q.elimination.is_complete && q.elimination.winner && (
							<Badge color="gold">🏆 {q.elimination.winner.name}</Badge>
						)}
					</div>
					<BracketCanvas
						bracket={elimination}
						readyIds={q.elimination.ready_match_ids}
						onReport={elimHandlers.onReport}
						onChoice={elimHandlers.onChoice}
						onOpenDetail={(matchId) => setDetail({ src: 'elim', matchId })}
					/>
				</Panel>
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
