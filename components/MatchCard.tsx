'use client';

import { Badge } from '@/components/ui';
import type { Match, Participant } from '@/lib/types';

interface Props {
	match: Match;
	byId: Record<number, Participant>;
	ready: boolean;
	onReport: (matchId: number, winnerId: number) => void;
	onUnwind: (matchId: number) => void;
	onChoice: (matchId: number, opponentId: number) => void;
}

export function MatchCard({ match, byId, ready, onReport, onUnwind, onChoice }: Props) {
	const completed = match.status === 'completed';
	const isBye = match.status === 'bye';
	const choicePool = (match.metadata?.choice_pool as number[] | undefined) ?? [];
	const choosing = match.status === 'pending_choice';

	return (
		<div
			className={`w-52 rounded-md border bg-night-900 text-sm shadow-sm ${
				ready ? 'border-court-500/60' : 'border-night-700'
			}`}
		>
			<div className="flex items-center justify-between gap-2 border-b border-night-800 px-2 py-1">
				<span className="font-mono text-[0.65rem] text-fog-500">#{match.id}</span>
				<div className="flex items-center gap-1">
					{match.best_of > 1 && <span className="text-[0.6rem] text-fog-500">BO{match.best_of}</span>}
					<StatusBadge status={match.status} />
				</div>
			</div>

			<div className="divide-y divide-night-800">
				<Slot
					match={match}
					slot={1}
					byId={byId}
					ready={ready}
					onReport={onReport}
				/>
				<Slot
					match={match}
					slot={2}
					byId={byId}
					ready={ready}
					onReport={onReport}
				/>
			</div>

			{choosing && choicePool.length > 0 && (
				<div className="border-t border-night-800 px-2 py-1.5">
					<p className="mb-1 font-display text-[0.6rem] uppercase tracking-widest text-court-400">
						Pick opponent
					</p>
					<div className="flex flex-wrap gap-1">
						{choicePool.map((pid) => (
							<button
								key={pid}
								type="button"
								onClick={() => onChoice(match.id, pid)}
								className="rounded border border-night-600 px-1.5 py-0.5 text-xs text-fog-100 hover:border-court-400 hover:text-court-300"
							>
								{byId[pid]?.name ?? pid}
							</button>
						))}
					</div>
				</div>
			)}

			{completed && !isBye && (
				<div className="border-t border-night-800 px-2 py-1 text-right">
					<button
						type="button"
						onClick={() => onUnwind(match.id)}
						className="font-display text-[0.6rem] uppercase tracking-widest text-fog-500 hover:text-rose-300"
						title="Clear this result and everything downstream"
					>
						↺ Unwind
					</button>
				</div>
			)}
		</div>
	);
}

function Slot({
	match,
	slot,
	byId,
	ready,
	onReport
}: {
	match: Match;
	slot: 1 | 2;
	byId: Record<number, Participant>;
	ready: boolean;
	onReport: (matchId: number, winnerId: number) => void;
}) {
	const pid = slot === 1 ? match.participant1_id : match.participant2_id;
	const participant = pid != null ? byId[pid] : undefined;
	const isWinner = pid != null && match.winner_id === pid;
	const isLoser = match.status === 'completed' && pid != null && match.winner_id !== pid;
	const clickable = ready && pid != null && match.status === 'ready';

	const content = participant ? (
		<>
			<span className="truncate">{participant.name}</span>
			<span className="ml-2 shrink-0 font-mono text-[0.65rem] text-fog-500">#{participant.seed}</span>
		</>
	) : (
		<span className="italic text-fog-500">{match.status === 'bye' ? 'bye' : 'TBD'}</span>
	);

	const base = 'flex items-center justify-between px-2 py-1.5';
	const tone = isWinner
		? 'bg-star-500/10 text-star-400 font-semibold'
		: isLoser
			? 'text-fog-500 line-through decoration-night-600'
			: 'text-fog-100';

	if (clickable) {
		return (
			<button
				type="button"
				onClick={() => onReport(match.id, pid!)}
				className={`${base} w-full text-left transition-colors hover:bg-court-500/10`}
				title="Click to advance this participant"
			>
				{content}
			</button>
		);
	}

	return <div className={`${base} ${tone}`}>{content}</div>;
}

function StatusBadge({ status }: { status: Match['status'] }) {
	switch (status) {
		case 'ready':
			return <Badge color="court">Ready</Badge>;
		case 'completed':
			return <Badge color="green">Done</Badge>;
		case 'bye':
			return <Badge color="gold">Bye</Badge>;
		case 'pending_choice':
			return <Badge color="rose">Choice</Badge>;
		default:
			return <Badge color="gray">Pending</Badge>;
	}
}
