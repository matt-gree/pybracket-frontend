'use client';

// DRAFT seeding editor for the pools -> elimination transition (spec §2). Lists the advancing
// participants in seed order; the organizer can reorder them (which re-drafts the bracket) and
// then publish to lock the bracket in for play.

import { useState } from 'react';
import type { Bracket, Participant } from '@/lib/types';

interface Props {
	elimination: Bracket;
	byId: Record<number, Participant>;
	onReorder: (orderIds: number[]) => void;
	onPublish: () => void;
	busy: boolean;
}

export function SeedingPanel({ elimination, byId, onReorder, onPublish, busy }: Props) {
	// Track the organizer's intended seed order locally so the arrows are simple swaps. (Re-
	// drafting renumbers seeds by bracket slot, so re-deriving order from props would shuffle.)
	const [order, setOrder] = useState<number[]>(() =>
		[...elimination.participants].sort((a, b) => a.seed - b.seed).map((p) => p.id)
	);

	function move(index: number, delta: number) {
		const j = index + delta;
		if (j < 0 || j >= order.length) return;
		const next = order.slice();
		[next[index], next[j]] = [next[j], next[index]];
		setOrder(next);
		onReorder(next);
	}

	return (
		<div className="rounded-lg border border-star-500/40 bg-star-500/5 p-3">
			<div className="mb-2 flex items-center justify-between gap-3">
				<div>
					<p className="font-display text-xs font-bold uppercase tracking-widest text-star-400">
						Seeding — Draft
					</p>
					<p className="text-xs text-fog-500">
						Reorder the survivors, then confirm to lock the bracket and start play.
					</p>
				</div>
				<button
					type="button"
					onClick={onPublish}
					disabled={busy}
					className="btn-primary shrink-0 px-3 py-1.5 text-xs"
				>
					Confirm bracket &amp; go live
				</button>
			</div>

			<ol className="flex flex-col gap-1">
				{order.map((id, i) => (
					<li
						key={id}
						className="flex items-center gap-2 rounded border border-night-700 bg-night-900 px-2 py-1"
					>
						<span className="w-6 shrink-0 text-center font-mono text-xs text-star-400">{i + 1}</span>
						<span className="min-w-0 flex-1 truncate text-sm text-fog-100">
							{byId[id]?.name ?? `#${id}`}
						</span>
						<button
							type="button"
							onClick={() => move(i, -1)}
							disabled={i === 0 || busy}
							className="rounded border border-night-600 px-1.5 text-fog-300 hover:border-court-400 hover:text-court-300 disabled:opacity-30"
							aria-label="Move up"
						>
							↑
						</button>
						<button
							type="button"
							onClick={() => move(i, 1)}
							disabled={i === order.length - 1 || busy}
							className="rounded border border-night-600 px-1.5 text-fog-300 hover:border-court-400 hover:text-court-300 disabled:opacity-30"
							aria-label="Move down"
						>
							↓
						</button>
					</li>
				))}
			</ol>
		</div>
	);
}
