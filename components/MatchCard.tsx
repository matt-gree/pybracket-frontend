'use client';

// Compact two-row match card (spec §5). The left edge is a full-height click zone that opens
// the detail modal; each player row is the click target for reporting a winner. Advancement is
// shown with colour, not badges. NOT_NEEDED matches (spec §1) render dimmed and inert.

import { CARD_HEIGHT, CARD_WIDTH } from '@/lib/layout';
import type { Match, Participant } from '@/lib/types';

interface Props {
	match: Match;
	byId: Record<number, Participant>;
	ready: boolean;
	onReport: (matchId: number, winnerId: number) => void;
	onChoice: (matchId: number, opponentId: number) => void;
	onOpenDetail: (matchId: number) => void;
}

export function MatchCard({ match, byId, ready, onReport, onChoice, onOpenDetail }: Props) {
	const notNeeded = match.status === 'not_needed';
	const choosing = match.status === 'pending_choice';
	const choicePool = (match.metadata?.choice_pool as number[] | undefined) ?? [];

	return (
		<div
			style={{ width: CARD_WIDTH, minHeight: CARD_HEIGHT }}
			className={`flex overflow-hidden rounded-md border bg-night-900 text-sm shadow-sm ${
				notNeeded ? 'border-night-800 opacity-30' : ready ? 'border-court-500/60' : 'border-night-700'
			}`}
		>
			{/* Left click zone -> detail modal */}
			<button
				type="button"
				disabled={notNeeded}
				onClick={() => onOpenDetail(match.id)}
				title="Match details"
				className={`group flex w-[22px] shrink-0 items-center justify-center border-r border-night-800 bg-night-850 ${
					notNeeded ? '' : 'cursor-pointer hover:bg-night-700'
				}`}
			>
				<span className="font-mono text-[0.6rem] leading-none text-fog-500 [writing-mode:vertical-rl] rotate-180 group-hover:text-court-300">
					#{match.id}
				</span>
			</button>

			<div className="flex min-w-0 flex-1 flex-col justify-center">
				<Slot match={match} slot={1} byId={byId} ready={ready} notNeeded={notNeeded} onReport={onReport} />
				<div className="border-t border-night-800" />
				<Slot match={match} slot={2} byId={byId} ready={ready} notNeeded={notNeeded} onReport={onReport} />

				{choosing && choicePool.length > 0 && (
					<div className="border-t border-night-800 px-1.5 py-1">
						<p className="mb-1 font-display text-[0.55rem] uppercase tracking-widest text-court-400">
							Pick opponent
						</p>
						<div className="flex flex-wrap gap-1">
							{choicePool.map((pid) => (
								<button
									key={pid}
									type="button"
									onClick={() => onChoice(match.id, pid)}
									className="truncate rounded border border-night-600 px-1.5 py-0.5 text-xs text-fog-100 hover:border-court-400 hover:text-court-300"
								>
									{byId[pid]?.name ?? pid}
								</button>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function Slot({
	match,
	slot,
	byId,
	ready,
	notNeeded,
	onReport
}: {
	match: Match;
	slot: 1 | 2;
	byId: Record<number, Participant>;
	ready: boolean;
	notNeeded: boolean;
	onReport: (matchId: number, winnerId: number) => void;
}) {
	const pid = slot === 1 ? match.participant1_id : match.participant2_id;
	const participant = pid != null ? byId[pid] : undefined;
	const isWinner = pid != null && match.winner_id === pid;
	const isLoser = match.status === 'completed' && pid != null && match.winner_id !== pid;
	const clickable = ready && pid != null && match.status === 'ready';

	const base = 'flex items-center gap-2 px-2 py-1 leading-tight';
	const tone = isWinner
		? 'bg-star-500/10 text-star-400 font-semibold'
		: isLoser
			? 'text-fog-500 line-through decoration-night-600'
			: 'text-fog-100';

	let content;
	if (notNeeded) {
		content = <span className="text-fog-600">—</span>;
	} else if (participant) {
		content = <span className="truncate">{participant.name}</span>;
	} else {
		content = <span className="italic text-fog-500">TBD</span>;
	}

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
