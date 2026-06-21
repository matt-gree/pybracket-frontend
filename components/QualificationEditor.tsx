'use client';

// Edits a phase's qualifiers as a list of sources, each pulling finishers from any earlier phase.
// Multiple sources = a merge (e.g. high pool + low pool → top cut); the same upstream cited by two
// phases = a split (championship + consolation). Compiled to SlotRef[] in spec.ts.

import type { QualificationDraft, SourceSpec } from '@/lib/spec';
import type { Seeding } from '@/lib/types';

export interface EarlierPhase {
	id: string;
	groups: number;
}

type Kind = SourceSpec['kind'];

const KIND_LABEL: Record<Kind, string> = {
	all: 'All finishers',
	top: 'Top N',
	place: 'Single place',
	top_each: 'Top N of each group',
	place_each: 'Place of each group'
};

function groupOf(s: SourceSpec): number | null {
	return s.kind === 'top_each' || s.kind === 'place_each' ? null : s.group;
}

function remakeSource(phase: string, kind: Kind, n: number, group: number | null): SourceSpec {
	switch (kind) {
		case 'all':
			return { phase, kind, group };
		case 'top':
			return { phase, kind, n, group };
		case 'place':
			return { phase, kind, place: n, group };
		case 'top_each':
			return { phase, kind, n };
		case 'place_each':
			return { phase, kind, place: n };
	}
}

function countOf(s: SourceSpec): number {
	if (s.kind === 'top' || s.kind === 'top_each') return s.n;
	if (s.kind === 'place' || s.kind === 'place_each') return s.place;
	return 1;
}

export function QualificationEditor({
	entrants,
	earlier,
	onChange
}: {
	entrants: QualificationDraft;
	earlier: EarlierPhase[];
	onChange: (next: QualificationDraft) => void;
}) {
	const setSource = (i: number, s: SourceSpec) => onChange({ ...entrants, sources: entrants.sources.map((x, j) => (j === i ? s : x)) });
	const addSource = () => onChange({ ...entrants, sources: [...entrants.sources, { phase: earlier[earlier.length - 1].id, kind: 'top', n: 4, group: null }] });
	const removeSource = (i: number) => onChange({ ...entrants, sources: entrants.sources.filter((_, j) => j !== i) });

	return (
		<div className="rounded border border-court-500/30 bg-court-500/5 p-2">
			<span className="label mb-1">Qualifiers</span>
			<div className="flex flex-col gap-2">
				{entrants.sources.map((s, i) => {
					const srcPhase = earlier.find((p) => p.id === s.phase) ?? earlier[0];
					const grouped = srcPhase.groups > 1;
					const showN = s.kind !== 'all';
					const showGroup = s.kind === 'top' || s.kind === 'place' || s.kind === 'all';
					return (
						<div key={i} className="flex flex-col gap-1 rounded border border-night-700 bg-night-900 p-1.5">
							<div className="flex items-center gap-1">
								<select className="select py-1 text-xs" value={s.phase} onChange={(e) => setSource(i, remakeSource(e.target.value, s.kind, countOf(s), groupOf(s)))}>
									{earlier.map((p) => (
										<option key={p.id} value={p.id}>
											{p.id}
										</option>
									))}
								</select>
								{entrants.sources.length > 1 && (
									<button type="button" onClick={() => removeSource(i)} className="shrink-0 px-1 text-fog-500 hover:text-rose-300" aria-label="Remove source">
										✕
									</button>
								)}
							</div>
							<div className="flex items-center gap-1">
								<select className="select py-1 text-xs" value={s.kind} onChange={(e) => setSource(i, remakeSource(s.phase, e.target.value as Kind, countOf(s), groupOf(s)))}>
									{(Object.keys(KIND_LABEL) as Kind[])
										.filter((k) => grouped || (k !== 'top_each' && k !== 'place_each'))
										.map((k) => (
											<option key={k} value={k}>
												{KIND_LABEL[k]}
											</option>
										))}
								</select>
								{showN && (
									<input
										type="number"
										min={1}
										value={countOf(s)}
										onChange={(e) => setSource(i, remakeSource(s.phase, s.kind, Math.max(1, Number(e.target.value)), groupOf(s)))}
										className="input w-16 py-1 text-center text-xs"
									/>
								)}
							</div>
							{showGroup && grouped && (
								<select
									className="select py-1 text-xs"
									value={s.group ?? 'overall'}
									onChange={(e) => setSource(i, remakeSource(s.phase, s.kind, countOf(s), e.target.value === 'overall' ? null : Number(e.target.value)))}
								>
									<option value="overall">Overall ranking</option>
									{Array.from({ length: srcPhase.groups }, (_, g) => (
										<option key={g} value={g}>
											Group {String.fromCharCode(65 + g)}
										</option>
									))}
								</select>
							)}
						</div>
					);
				})}
			</div>
			<div className="mt-1.5 flex items-center justify-between gap-2">
				<button type="button" onClick={addSource} className="rounded border border-night-600 px-2 py-0.5 text-[0.7rem] text-fog-300 hover:border-court-400 hover:text-court-300">
					+ Add source
				</button>
				<select className="select w-auto py-1 text-xs" value={entrants.seeding} onChange={(e) => onChange({ ...entrants, seeding: e.target.value as Seeding })}>
					<option value="snake">Snake</option>
					<option value="rank">Rank</option>
					<option value="manual">Manual</option>
				</select>
			</div>
		</div>
	);
}
