'use client';

// Detail modal for a single match (spec §5). Surfaces the fields that the compact card hides:
// best-of, per-participant score, advancement type, status, and the rewind action.

import { useState } from 'react';
import { Badge, Modal } from '@/components/ui';
import type { AdvancementType, Match, MatchStatus, Participant } from '@/lib/types';

interface Props {
	match: Match;
	byId: Record<number, Participant>;
	roundName: string;
	onReport: (matchId: number, winnerId: number, metadata?: Record<string, unknown>) => void;
	onUnwind: (matchId: number) => void;
	onUpdate: (matchId: number, patch: { best_of?: number; metadata?: Record<string, unknown> }) => void;
	onClose: () => void;
}

const STATUS_LABEL: Record<MatchStatus, string> = {
	pending: 'Pending',
	ready: 'Ready',
	bye: 'Bye',
	completed: 'Completed',
	pending_choice: 'Awaiting choice',
	not_needed: 'Not needed'
};

const STATUS_COLOR: Record<MatchStatus, 'court' | 'gold' | 'gray' | 'green' | 'rose'> = {
	pending: 'gray',
	ready: 'court',
	bye: 'gold',
	completed: 'green',
	pending_choice: 'rose',
	not_needed: 'gray'
};

const ADVANCEMENT_LABEL: Record<AdvancementType, string> = {
	result: 'Result',
	bye: 'Bye',
	forfeit: 'Forfeit',
	walkover: 'Walkover'
};

function nameOf(byId: Record<number, Participant>, id: number | null): string {
	if (id == null) return 'TBD';
	return byId[id]?.name ?? `#${id}`;
}

export function MatchDetailModal({ match, byId, roundName, onReport, onUnwind, onUpdate, onClose }: Props) {
	const completed = match.status === 'completed';
	const score = (match.metadata?.score as [number, number] | undefined) ?? [0, 0];
	const [bestOf, setBestOf] = useState(match.best_of);
	const [s1, setS1] = useState(score[0]);
	const [s2, setS2] = useState(score[1]);

	const bothKnown = match.participant1_id != null && match.participant2_id != null;
	const canReport = match.status === 'ready' && bothKnown;
	const editableBestOf = match.status === 'pending' || match.status === 'ready';

	const scorePatch = () => ({ metadata: { score: [s1, s2] as [number, number] } });

	return (
		<Modal title={`Match #${match.id}`} onClose={onClose}>
			<dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-2.5 text-sm">
				<Field label="Match ID" value={`#${match.id}`} />
				<Field label="Round" value={roundName || '—'} />

				<dt className="text-fog-500">Best-of</dt>
				<dd>
					{editableBestOf ? (
						<input
							type="number"
							min={1}
							step={2}
							value={bestOf}
							onChange={(e) => setBestOf(Number(e.target.value))}
							onBlur={() => bestOf !== match.best_of && onUpdate(match.id, { best_of: bestOf })}
							className="input w-20 py-1 text-sm"
						/>
					) : (
						<span className="text-fog-100">BO{match.best_of}</span>
					)}
				</dd>

				<dt className="text-fog-500">Score</dt>
				<dd className="flex items-center gap-2">
					<ScoreRow name={nameOf(byId, match.participant1_id)} value={s1} onChange={setS1} />
					<span className="text-fog-600">–</span>
					<ScoreRow name={nameOf(byId, match.participant2_id)} value={s2} onChange={setS2} />
					<button
						type="button"
						onClick={() => onUpdate(match.id, scorePatch())}
						className="btn-secondary px-2 py-1 text-xs"
					>
						Save
					</button>
				</dd>

				<Field
					label="Advancement"
					value={match.advancement_type ? ADVANCEMENT_LABEL[match.advancement_type] : '—'}
				/>

				<dt className="text-fog-500">Status</dt>
				<dd>
					<Badge color={STATUS_COLOR[match.status]}>{STATUS_LABEL[match.status]}</Badge>
				</dd>
			</dl>

			{canReport && (
				<div className="mt-4 border-t border-night-800 pt-3">
					<p className="label">Report winner</p>
					<div className="flex flex-wrap gap-2">
						{[match.participant1_id, match.participant2_id].map((pid) =>
							pid == null ? null : (
								<button
									key={pid}
									type="button"
									onClick={() => onReport(match.id, pid, scorePatch())}
									className="btn-primary px-3 py-1.5 text-xs"
								>
									{nameOf(byId, pid)} wins
								</button>
							)
						)}
					</div>
				</div>
			)}

			{completed && (
				<div className="mt-4 flex items-center justify-between border-t border-night-800 pt-3">
					<span className="text-sm text-fog-400">
						Winner: <span className="font-semibold text-star-400">{nameOf(byId, match.winner_id)}</span>
					</span>
					<button
						type="button"
						onClick={() => onUnwind(match.id)}
						className="font-display text-xs uppercase tracking-widest text-fog-500 hover:text-rose-300"
						title="Clear this result and everything downstream"
					>
						↺ Rewind
					</button>
				</div>
			)}
		</Modal>
	);
}

function Field({ label, value }: { label: string; value: string }) {
	return (
		<>
			<dt className="text-fog-500">{label}</dt>
			<dd className="text-fog-100">{value}</dd>
		</>
	);
}

function ScoreRow({ name, value, onChange }: { name: string; value: number; onChange: (v: number) => void }) {
	return (
		<label className="flex items-center gap-1" title={name}>
			<input
				type="number"
				min={0}
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				className="input w-14 py-1 text-center text-sm"
			/>
		</label>
	);
}
