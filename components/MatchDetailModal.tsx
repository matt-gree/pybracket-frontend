'use client';

// Detail modal for a single match. Surfaces what the compact card hides: best-of, the per-game
// series (report game-by-game; the engine clinches the series), draws + per-game stats for the
// scoring layer, advancement type, status, and the rewind action.

import { useState } from 'react';
import { Badge, Modal } from '@/components/ui';
import { seriesScore, type AdvancementType, type Match, type MatchStatus, type Participant } from '@/lib/types';

interface Props {
	match: Match;
	byId: Record<number, Participant>;
	roundName: string;
	drawsAllowed: boolean;
	onReport: (matchId: number, winnerId: number, metadata?: Record<string, unknown>, stats?: unknown) => void;
	onUnwind: (matchId: number) => void;
	onUpdate: (matchId: number, patch: { best_of?: number; metadata?: Record<string, unknown> }) => void;
	onReportGame: (matchId: number, winnerId: number, opts?: { stats?: unknown }) => void;
	onUnwindGame: (matchId: number) => void;
	onReportDraw: (matchId: number, stats?: unknown) => void;
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
	walkover: 'Walkover',
	draw: 'Draw'
};

function nameOf(byId: Record<number, Participant>, id: number | null): string {
	if (id == null) return 'TBD';
	return byId[id]?.name ?? `#${id}`;
}

export function MatchDetailModal({
	match,
	byId,
	roundName,
	drawsAllowed,
	onReport,
	onUnwind,
	onUpdate,
	onReportGame,
	onUnwindGame,
	onReportDraw,
	onClose
}: Props) {
	const completed = match.status === 'completed';
	const [bestOf, setBestOf] = useState(match.best_of);
	// Optional per-game stat contribution (e.g. runs 7–3) the caller can attach when reporting.
	const [statName, setStatName] = useState('');
	const [stat1, setStat1] = useState(0);
	const [stat2, setStat2] = useState(0);

	const p1 = match.participant1_id;
	const p2 = match.participant2_id;
	const bothKnown = p1 != null && p2 != null;
	const canReport = match.status === 'ready' && bothKnown;
	const editableBestOf = match.status === 'pending' || match.status === 'ready';
	const isSeries = match.best_of > 1;
	const [sa, sb] = seriesScore(match);

	const statsPatch = () => {
		if (!statName.trim()) return undefined;
		return { [statName.trim()]: [stat1, stat2] as [number, number] };
	};

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
							step={1}
							value={bestOf}
							onChange={(e) => setBestOf(Number(e.target.value))}
							onBlur={() => bestOf !== match.best_of && onUpdate(match.id, { best_of: bestOf })}
							className="input w-20 py-1 text-sm"
						/>
					) : (
						<span className="text-fog-100">BO{match.best_of}</span>
					)}
				</dd>

				{isSeries && (
					<Field label="Series" value={`${sa}–${sb}${bothKnown ? `  (${nameOf(byId, p1)} – ${nameOf(byId, p2)})` : ''}`} />
				)}

				<Field label="Advancement" value={match.advancement_type ? ADVANCEMENT_LABEL[match.advancement_type] : '—'} />

				<dt className="text-fog-500">Status</dt>
				<dd>
					<Badge color={STATUS_COLOR[match.status]}>{STATUS_LABEL[match.status]}</Badge>
				</dd>
			</dl>

			{/* Optional per-game / per-match stat contribution. */}
			{(canReport || (isSeries && !completed)) && (
				<div className="mt-3 border-t border-night-800 pt-3">
					<p className="label">Stat (optional)</p>
					<div className="flex items-center gap-2">
						<input
							value={statName}
							onChange={(e) => setStatName(e.target.value)}
							placeholder="e.g. runs"
							className="input w-28 py-1 text-sm"
						/>
						<input type="number" value={stat1} onChange={(e) => setStat1(Number(e.target.value))} className="input w-16 py-1 text-center text-sm" title={nameOf(byId, p1)} />
						<span className="text-fog-600">–</span>
						<input type="number" value={stat2} onChange={(e) => setStat2(Number(e.target.value))} className="input w-16 py-1 text-center text-sm" title={nameOf(byId, p2)} />
					</div>
				</div>
			)}

			{/* Series games log + per-game reporting. */}
			{isSeries && !completed && bothKnown && (
				<div className="mt-3 border-t border-night-800 pt-3">
					<p className="label">Report game {match.games.length + 1}</p>
					<div className="flex flex-wrap gap-2">
						<button type="button" onClick={() => onReportGame(match.id, p1!, { stats: statsPatch() })} className="btn-primary px-3 py-1.5 text-xs">
							{nameOf(byId, p1)}
						</button>
						<button type="button" onClick={() => onReportGame(match.id, p2!, { stats: statsPatch() })} className="btn-primary px-3 py-1.5 text-xs">
							{nameOf(byId, p2)}
						</button>
					</div>
					{match.games.length > 0 && (
						<div className="mt-2 flex items-center justify-between text-xs text-fog-500">
							<span>
								{match.games.map((g) => (g.winner_id == null ? '·' : g.winner_id === p1 ? nameOf(byId, p1)[0] : nameOf(byId, p2)[0])).join(' ')}
							</span>
							<button type="button" onClick={() => onUnwindGame(match.id)} className="font-display uppercase tracking-widest hover:text-rose-300">
								↺ Undo game
							</button>
						</div>
					)}
				</div>
			)}

			{/* BO1 winner / draw reporting. */}
			{!isSeries && canReport && (
				<div className="mt-4 border-t border-night-800 pt-3">
					<p className="label">Report winner</p>
					<div className="flex flex-wrap gap-2">
						{[p1, p2].map((pid) =>
							pid == null ? null : (
								<button
									key={pid}
									type="button"
									onClick={() => onReport(match.id, pid, undefined, statsPatch())}
									className="btn-primary px-3 py-1.5 text-xs"
								>
									{nameOf(byId, pid)} wins
								</button>
							)
						)}
						{drawsAllowed && (
							<button type="button" onClick={() => onReportDraw(match.id, statsPatch())} className="btn-secondary px-3 py-1.5 text-xs">
								Draw
							</button>
						)}
					</div>
				</div>
			)}

			{completed && (
				<div className="mt-4 flex items-center justify-between border-t border-night-800 pt-3">
					<span className="text-sm text-fog-400">
						{match.advancement_type === 'draw' ? (
							<span className="font-semibold text-fog-200">Drawn</span>
						) : (
							<>
								Winner: <span className="font-semibold text-star-400">{nameOf(byId, match.winner_id)}</span>
							</>
						)}
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
