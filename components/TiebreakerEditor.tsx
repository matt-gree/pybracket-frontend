'use client';

// Composes an ordered tiebreaker chain for a standings phase (or the tournament default). Emits
// the library's `type`-discriminated specs; the bridge injects them into config["tiebreakers"],
// which get_standings reads. Order = priority. A points system, when set, is the implicit primary.

import type { TiebreakerSpec } from '@/lib/spec';

type Kind = TiebreakerSpec['type'];

const KIND_LABEL: Record<Kind, string> = {
	accumulated: 'Accumulated stat',
	head_to_head: 'Head-to-head',
	mini_league: 'Mini-league',
	buchholz: 'Buchholz',
	win_count: 'Win count'
};

const AGGS = ['for', 'against', 'diff', 'count', 'avg'] as const;
const BUILTIN_INPUTS = ['points', 'wins', 'games', 'draws'];

function makeSpec(kind: Kind): TiebreakerSpec {
	switch (kind) {
		case 'accumulated':
			return { type: 'accumulated', input: 'games', agg: 'diff', higher_is_better: true };
		case 'buchholz':
			return { type: 'buchholz', truncated: false };
		default:
			return { type: kind };
	}
}

export function TiebreakerEditor({ chain, onChange }: { chain: TiebreakerSpec[]; onChange: (next: TiebreakerSpec[]) => void }) {
	const set = (i: number, s: TiebreakerSpec) => onChange(chain.map((x, j) => (j === i ? s : x)));
	const add = () => onChange([...chain, makeSpec('accumulated')]);
	const remove = (i: number) => onChange(chain.filter((_, j) => j !== i));
	const move = (i: number, d: number) => {
		const j = i + d;
		if (j < 0 || j >= chain.length) return;
		const next = chain.slice();
		[next[i], next[j]] = [next[j], next[i]];
		onChange(next);
	};

	return (
		<div className="flex flex-col gap-2">
			{chain.map((tb, i) => (
				<div key={i} className="flex flex-col gap-1 rounded border border-night-700 bg-night-900 p-1.5">
					<div className="flex items-center gap-1">
						<span className="w-4 shrink-0 text-center font-mono text-[0.6rem] text-fog-600">{i + 1}</span>
						<select className="select py-1 text-xs" value={tb.type} onChange={(e) => set(i, makeSpec(e.target.value as Kind))}>
							{(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
								<option key={k} value={k}>
									{KIND_LABEL[k]}
								</option>
							))}
						</select>
						<button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-1 text-fog-500 hover:text-court-300 disabled:opacity-30" aria-label="Move up">
							↑
						</button>
						<button type="button" onClick={() => move(i, 1)} disabled={i === chain.length - 1} className="px-1 text-fog-500 hover:text-court-300 disabled:opacity-30" aria-label="Move down">
							↓
						</button>
						<button type="button" onClick={() => remove(i)} className="px-1 text-fog-500 hover:text-rose-300" aria-label="Remove">
							✕
						</button>
					</div>

					{tb.type === 'accumulated' && (
						<div className="flex flex-wrap items-center gap-1 pl-5">
							<input
								list="tb-inputs"
								value={tb.input}
								onChange={(e) => set(i, { ...tb, input: e.target.value })}
								placeholder="stat (e.g. runs)"
								className="input w-24 py-1 text-xs"
							/>
							<select className="select w-auto py-1 text-xs" value={tb.agg} onChange={(e) => set(i, { ...tb, agg: e.target.value as (typeof AGGS)[number] })}>
								{AGGS.map((a) => (
									<option key={a} value={a}>
										{a}
									</option>
								))}
							</select>
							<button
								type="button"
								onClick={() => set(i, { ...tb, higher_is_better: !(tb.higher_is_better ?? true) })}
								className="rounded border border-night-600 px-1.5 py-0.5 text-[0.7rem] text-fog-300 hover:border-court-400"
								title="Sort direction"
							>
								{(tb.higher_is_better ?? true) ? 'higher ↑' : 'lower ↓'}
							</button>
						</div>
					)}

					{tb.type === 'buchholz' && (
						<label className="flex items-center gap-1.5 pl-5 text-[0.7rem] text-fog-400">
							<input type="checkbox" checked={!!tb.truncated} onChange={(e) => set(i, { ...tb, truncated: e.target.checked })} className="h-3 w-3 accent-court-500" />
							Truncated (drop the worst opponent)
						</label>
					)}
				</div>
			))}
			<datalist id="tb-inputs">
				{BUILTIN_INPUTS.map((x) => (
					<option key={x} value={x} />
				))}
			</datalist>
			<button type="button" onClick={add} className="self-start rounded border border-night-600 px-2 py-0.5 text-[0.7rem] text-fog-300 hover:border-court-400 hover:text-court-300">
				+ Add tiebreaker
			</button>
		</div>
	);
}
