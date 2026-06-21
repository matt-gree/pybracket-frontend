'use client';

// The phases laid out across the top, click-through (Phase 1 / Phase 2 / …). Each tab carries a
// status chip derived from the bridge's phase query: Locked → Ready → Draft/Preview → Live →
// Complete. A lone phase still gets a tab so the layout is uniform across formats.

import { Badge } from '@/components/ui';
import type { PhaseQuery } from '@/lib/types';

export interface PhaseStatus {
	label: string;
	color: 'court' | 'gold' | 'gray' | 'green';
}

export function phaseStatus(p: PhaseQuery, index: number): PhaseStatus {
	if (p.is_complete) return { label: 'Complete', color: 'green' };
	if (!p.has_brackets) {
		return p.is_draftable ? { label: 'Ready to draft', color: 'gold' } : { label: 'Locked', color: 'gray' };
	}
	if (p.state === 'published') return { label: 'Live', color: 'court' };
	// DRAFT with brackets: a preview, the field phase awaiting start, or a drafted downstream phase.
	if (p.is_preview) return { label: 'Preview', color: 'gray' };
	return { label: index === 0 ? 'Not started' : 'Draft', color: 'court' };
}

function titleCase(id: string): string {
	return id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function PhaseTabs({
	phases,
	active,
	onChange,
	onReset
}: {
	phases: PhaseQuery[];
	active: number;
	onChange: (index: number) => void;
	onReset: () => void;
}) {
	const multi = phases.length > 1;
	return (
		<div className="flex items-end justify-between gap-3 border-b border-night-700">
			<div className="flex flex-wrap gap-1">
				{phases.map((p, i) => {
					const status = phaseStatus(p, i);
					const isActive = i === active;
					return (
						<button
							key={p.id}
							type="button"
							onClick={() => onChange(i)}
							className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 font-display text-xs font-semibold uppercase tracking-wider transition-colors ${
								isActive ? 'border-court-500 text-court-200' : 'border-transparent text-fog-500 hover:text-fog-300'
							}`}
						>
							{multi && <span className="font-mono text-[0.6rem] text-fog-600">{i + 1}</span>}
							<span>{titleCase(p.id)}</span>
							<Badge color={status.color}>{status.label}</Badge>
						</button>
					);
				})}
			</div>
			<button
				type="button"
				onClick={onReset}
				className="mb-1.5 shrink-0 font-display text-[0.65rem] uppercase tracking-widest text-fog-500 hover:text-rose-300"
				title="Discard play and rebuild a fresh draft from the current settings"
			>
				↺ Reset
			</button>
		</div>
	);
}
