'use client';

// Byes divider editor: instead of a per-seed number grid, the organizer divides the seed list
// into bye tiers with movable "BYE" dividers (drag, or ▲/▼ for precision). The seed list and the
// dividers express a non-increasing seed→byes request, which is exactly the `bye_rounds` map the
// library consumes. Validity is delegated to the engine (op `complete_byes`): a partition that
// can't tile a bracket surfaces the engine's error, and any byes the engine would auto-add are
// shown — so the TO judges the grouping by the real library, never by frontend guesswork.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Engine } from '@/lib/pyodide';

const ROW_H = 28; // px per seed row — dividers snap to multiples of this.

interface LevelStyle {
	band: string;
	dot: string;
	label: string;
}

const LEVEL_STYLES: LevelStyle[] = [
	{ band: 'bg-night-850', dot: 'bg-night-600', label: 'Play-in (no bye)' },
	{ band: 'bg-court-500/10', dot: 'bg-court-400', label: 'Single bye' },
	{ band: 'bg-star-500/10', dot: 'bg-star-400', label: 'Double bye' },
	{ band: 'bg-emerald-500/10', dot: 'bg-emerald-400', label: 'Triple bye' }
];

function styleFor(level: number): LevelStyle {
	return LEVEL_STYLES[Math.min(level, LEVEL_STYLES.length - 1)];
}

interface Feedback {
	ok: boolean;
	rounds?: number;
	added?: Record<string, number>;
	error?: string;
}

interface Props {
	count: number;
	value: Record<number, number>;
	setByeRounds: (map: Record<number, number>) => void;
	engine: Engine | null;
}

export function ByeDividerEditor({ count, value, setByeRounds, engine }: Props) {
	// Per-seed requested byes (0-based: levels[i] is seed i+1). Non-increasing by construction.
	const levels = useMemo(
		() => Array.from({ length: count }, (_, i) => Math.max(0, value[i + 1] ?? 0)),
		[count, value]
	);

	const maxAllowed = Math.min(3, Math.max(1, Math.floor(Math.log2(Math.max(2, count)))));
	const valueMax = levels.reduce((a, b) => Math.max(a, b), 0);
	const [maxLevel, setMaxLevel] = useState(() => Math.max(1, valueMax));
	// If a preset pushes the request above the current tier count, grow to fit.
	useEffect(() => {
		if (valueMax > maxLevel) setMaxLevel(valueMax);
	}, [valueMax, maxLevel]);

	// Divider d (0 = topmost) sits below bye level (maxLevel - d); its position is the count of
	// seeds at-or-above that level. Positions are non-decreasing and may coincide (empty tier).
	const positions = useMemo(() => {
		const pos: number[] = [];
		for (let d = 0; d < maxLevel; d++) {
			const level = maxLevel - d;
			pos.push(levels.filter((l) => l >= level).length);
		}
		return pos;
	}, [levels, maxLevel]);

	const commitPositions = useCallback(
		(pos: number[]) => {
			const map: Record<number, number> = {};
			for (let i = 0; i < count; i++) {
				const dropped = pos.filter((p) => p <= i).length;
				map[i + 1] = maxLevel - dropped;
			}
			setByeRounds(map);
		},
		[count, maxLevel, setByeRounds]
	);

	// --- dragging ---------------------------------------------------------------------------
	const listRef = useRef<HTMLDivElement>(null);
	const [dragging, setDragging] = useState<number | null>(null);

	const moveDivider = useCallback(
		(d: number, clientY: number) => {
			const el = listRef.current;
			if (!el) return;
			const rect = el.getBoundingClientRect();
			const raw = Math.round((clientY - rect.top + el.scrollTop) / ROW_H);
			const lo = d > 0 ? positions[d - 1] : 0;
			const hi = d < positions.length - 1 ? positions[d + 1] : count;
			const next = positions.slice();
			next[d] = Math.max(lo, Math.min(hi, raw));
			commitPositions(next);
		},
		[positions, count, commitPositions]
	);

	useEffect(() => {
		if (dragging == null) return;
		const onMove = (e: PointerEvent) => moveDivider(dragging, e.clientY);
		const onUp = () => setDragging(null);
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		return () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		};
	}, [dragging, moveDivider]);

	function nudge(d: number, delta: number) {
		const lo = d > 0 ? positions[d - 1] : 0;
		const hi = d < positions.length - 1 ? positions[d + 1] : count;
		const next = positions.slice();
		next[d] = Math.max(lo, Math.min(hi, positions[d] + delta));
		commitPositions(next);
	}

	function setTiers(m: number) {
		setMaxLevel(m);
		// Default each new tier to a single seed (a clean staircase); the TO drags from there.
		const pos = Array.from({ length: m }, (_, d) => d + 1);
		const map: Record<number, number> = {};
		for (let i = 0; i < count; i++) map[i + 1] = m - pos.filter((p) => p <= i).length;
		setByeRounds(map);
	}

	// --- live engine validation -------------------------------------------------------------
	const [feedback, setFeedback] = useState<Feedback | null>(null);
	useEffect(() => {
		if (!engine) return;
		const handle = setTimeout(() => {
			const res = engine.dispatch({ op: 'complete_byes', count, bye_rounds: value }) as
				| { ok: true; rounds: number; added: Record<string, number> }
				| { ok: false; error: string };
			setFeedback(
				res.ok
					? { ok: true, rounds: res.rounds, added: res.added }
					: { ok: false, error: res.error }
			);
		}, 250);
		return () => clearTimeout(handle);
	}, [engine, count, value]);

	return (
		<div className="mt-2">
			<div className="mb-2 flex items-center gap-2">
				<span className="font-display text-[0.65rem] uppercase tracking-widest text-fog-500">
					Bye tiers
				</span>
				<div className="flex gap-1">
					{Array.from({ length: maxAllowed }, (_, i) => i + 1).map((m) => (
						<button
							key={m}
							type="button"
							onClick={() => setTiers(m)}
							className={`rounded border px-2 py-0.5 text-[0.7rem] ${
								m === maxLevel
									? 'border-court-500/70 bg-court-500/10 text-court-200'
									: 'border-night-600 text-fog-400 hover:border-court-400 hover:text-court-300'
							}`}
						>
							{m}
						</button>
					))}
				</div>
			</div>

			{/* Seed list with bye bands and draggable dividers. */}
			<div
				ref={listRef}
				className="relative max-h-64 overflow-y-auto rounded border border-night-700"
				style={{ height: count * ROW_H }}
			>
				{levels.map((level, i) => {
					const s = styleFor(level);
					return (
						<div
							key={i}
							className={`absolute flex w-full items-center gap-2 border-b border-night-800/60 px-2 text-xs ${s.band}`}
							style={{ top: i * ROW_H, height: ROW_H }}
						>
							<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
							<span className="w-7 shrink-0 font-mono text-fog-400">#{i + 1}</span>
							<span className="truncate text-fog-300">
								{level > 0 ? `${level} bye${level > 1 ? 's' : ''}` : 'plays round 1'}
							</span>
						</div>
					);
				})}

				{positions.map((p, d) => {
					const level = maxLevel - d; // the tier that sits above this divider
					return (
						<div
							key={d}
							className="group absolute left-0 z-10 flex w-full -translate-y-1/2 items-center"
							style={{ top: p * ROW_H, height: 14, cursor: 'row-resize', touchAction: 'none' }}
							onPointerDown={(e) => {
								e.preventDefault();
								setDragging(d);
							}}
						>
							<div className="h-px flex-1 bg-court-500/70" />
							<div className="mx-1 flex items-center gap-1 rounded bg-court-600 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider text-white shadow">
								<button
									type="button"
									aria-label="Move up"
									className="leading-none hover:text-court-200"
									onPointerDown={(e) => e.stopPropagation()}
									onClick={() => nudge(d, -1)}
								>
									▲
								</button>
								<span>bye {level}</span>
								<button
									type="button"
									aria-label="Move down"
									className="leading-none hover:text-court-200"
									onPointerDown={(e) => e.stopPropagation()}
									onClick={() => nudge(d, 1)}
								>
									▼
								</button>
							</div>
							<div className="h-px flex-1 bg-court-500/70" />
						</div>
					);
				})}
			</div>

			{/* Engine verdict for the current partition. */}
			<ByeFeedback feedback={feedback} />
			<p className="mt-1.5 text-[0.7rem] text-fog-500">
				Drag a divider (or use ▲/▼) to set where each bye tier ends. The engine validates the
				grouping and fills any remaining byes on generate.
			</p>
		</div>
	);
}

function ByeFeedback({ feedback }: { feedback: Feedback | null }) {
	if (!feedback) return null;
	if (!feedback.ok) {
		return (
			<p className="mt-2 rounded border border-rose-700/60 bg-rose-700/10 px-2 py-1 text-[0.7rem] text-rose-300">
				{feedback.error}
			</p>
		);
	}
	const added = feedback.added ?? {};
	const addedSeeds = Object.keys(added)
		.map(Number)
		.sort((a, b) => a - b);
	return (
		<p
			className={`mt-2 rounded border px-2 py-1 text-[0.7rem] ${
				addedSeeds.length
					? 'border-amber-700/60 bg-amber-700/10 text-amber-200'
					: 'border-emerald-700/50 bg-emerald-700/10 text-emerald-300'
			}`}
		>
			Valid · {feedback.rounds} rounds
			{addedSeeds.length > 0 &&
				` · engine adds ${addedSeeds.map((s) => `#${s}+${added[String(s)]}`).join(', ')}`}
		</p>
	);
}
