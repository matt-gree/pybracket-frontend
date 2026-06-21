'use client';

import { useState } from 'react';
import { ByeDividerEditor } from '@/components/ByeDividerEditor';
import { usePyodide } from '@/components/PyodideProvider';
import { QualificationEditor, type EarlierPhase } from '@/components/QualificationEditor';
import { TiebreakerEditor } from '@/components/TiebreakerEditor';
import {
	DEFAULT_POINTS,
	FORMATS,
	MAX_PARTICIPANTS,
	MIN_PARTICIPANTS,
	SHAPES,
	buildShape,
	makePhase,
	protectedSeedChoices,
	recommendedSwissRounds,
	resizeNames,
	standardByeRounds,
	type BuilderState,
	type PhaseDraft,
	type PhaseOptions
} from '@/lib/spec';
import type { BracketFormat, ByeOption, CrossDivisionPairing } from '@/lib/types';

interface Props {
	state: BuilderState;
	onChange: (next: BuilderState) => void;
}

export function BuilderForm({ state, onChange }: Props) {
	const [editNames, setEditNames] = useState(false);

	function setShape(id: string) {
		onChange({ ...state, shape: id, phases: buildShape(id) });
	}

	function patchPhase(index: number, patch: Partial<PhaseDraft>) {
		const phases = state.phases.map((p, i) => (i === index ? { ...p, ...patch } : p));
		onChange({ ...state, phases });
	}

	function addPhase() {
		const ids = new Set(state.phases.map((p) => p.id));
		let n = state.phases.length + 1;
		while (ids.has(`phase${n}`)) n++;
		const prev = state.phases[state.phases.length - 1];
		const next = makePhase(`phase${n}`, 'single_elim', { sources: [{ phase: prev.id, kind: 'top', n: 4, group: null }], seeding: 'snake' });
		onChange({ ...state, shape: 'custom', phases: [...state.phases, next] });
	}

	function removePhase(index: number) {
		if (index === 0 || state.phases.length <= 1) return;
		onChange({ ...state, shape: 'custom', phases: state.phases.filter((_, i) => i !== index) });
	}

	function movePhase(index: number, delta: number) {
		const j = index + delta;
		if (j < 1 || j >= state.phases.length) return; // phase 0 stays the field phase
		const phases = state.phases.slice();
		[phases[index], phases[j]] = [phases[j], phases[index]];
		onChange({ ...state, shape: 'custom', phases });
	}

	function setCount(countRaw: number) {
		const count = Math.max(MIN_PARTICIPANTS, Math.min(MAX_PARTICIPANTS, Math.round(countRaw || 0)));
		// A custom bye map is keyed by seed, so changing the field size resets it to standard.
		const phases = state.phases.map((p) => ({ ...p, options: { ...p.options, bye_rounds: null } }));
		onChange({ ...state, participantCount: count, names: resizeNames(state.names, count), phases });
	}

	function setName(index: number, value: string) {
		const names = state.names.slice();
		names[index] = value;
		onChange({ ...state, names });
	}

	return (
		<div className="flex flex-col gap-5">
			{/* Shape */}
			<div>
				<span className="label">Tournament shape</span>
				<div className="grid grid-cols-1 gap-2">
					{SHAPES.map((s) => {
						const active = state.shape === s.id;
						return (
							<button
								key={s.id}
								type="button"
								onClick={() => setShape(s.id)}
								className={`rounded-lg border px-3 py-2 text-left transition-colors ${
									active ? 'border-court-500/70 bg-court-500/10' : 'border-night-700 bg-night-850 hover:border-night-600'
								}`}
							>
								<span className="flex items-center gap-1.5 font-display text-sm font-bold uppercase tracking-wide text-fog-100">
									{s.label}
									{s.multi && <span className="rounded bg-star-500/15 px-1 py-0.5 text-[0.55rem] text-star-400">MULTI</span>}
								</span>
								<span className="mt-0.5 block text-xs leading-snug text-fog-500">{s.blurb}</span>
							</button>
						);
					})}
				</div>
			</div>

			{/* Participants */}
			<div>
				<div className="flex items-center justify-between">
					<span className="label mb-0">Participants</span>
					<button
						type="button"
						onClick={() => setEditNames((v) => !v)}
						className="font-display text-[0.65rem] uppercase tracking-widest text-court-400 hover:text-court-300"
					>
						{editNames ? 'Hide names' : 'Edit names'}
					</button>
				</div>
				<div className="mt-2 flex items-center gap-3">
					<input
						type="range"
						min={MIN_PARTICIPANTS}
						max={MAX_PARTICIPANTS}
						value={state.participantCount}
						onChange={(e) => setCount(Number(e.target.value))}
						className="flex-1 accent-court-500"
					/>
					<input
						type="number"
						min={MIN_PARTICIPANTS}
						max={MAX_PARTICIPANTS}
						value={state.participantCount}
						onChange={(e) => setCount(Number(e.target.value))}
						className="input w-20 text-center"
					/>
				</div>
				{editNames && (
					<div className="mt-3 grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
						{state.names.map((name, i) => (
							<div key={i} className="flex items-center gap-2">
								<span className="w-6 shrink-0 text-right font-mono text-xs text-fog-500">{i + 1}</span>
								<input value={name} onChange={(e) => setName(i, e.target.value)} className="input py-1 text-xs" placeholder={`Seed ${i + 1}`} />
							</div>
						))}
					</div>
				)}
			</div>

			{/* Per-phase configuration */}
			{state.phases.map((phase, i) => (
				<PhaseSection
					key={phase.id}
					phase={phase}
					index={i}
					total={state.phases.length}
					earlier={state.phases.slice(0, i).map((p) => ({ id: p.id, groups: p.groups }))}
					participantCount={state.participantCount}
					onPatch={(patch) => patchPhase(i, patch)}
					onRemove={() => removePhase(i)}
					onMove={(delta) => movePhase(i, delta)}
				/>
			))}

			<button
				type="button"
				onClick={addPhase}
				className="rounded-lg border border-dashed border-night-600 px-3 py-2 font-display text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-court-500 hover:text-court-300"
			>
				+ Add phase
			</button>
		</div>
	);
}

function PhaseSection({
	phase,
	index,
	total,
	earlier,
	participantCount,
	onPatch,
	onRemove,
	onMove
}: {
	phase: PhaseDraft;
	index: number;
	total: number;
	earlier: EarlierPhase[];
	participantCount: number;
	onPatch: (patch: Partial<PhaseDraft>) => void;
	onRemove: () => void;
	onMove: (delta: number) => void;
}) {
	const o = phase.options;
	const multi = total > 1;
	const meta = FORMATS.find((f) => f.value === phase.format) ?? FORMATS[0];
	const setOption = <K extends keyof PhaseOptions>(key: K, value: PhaseOptions[K]) => onPatch({ options: { ...o, [key]: value } });

	const body = (
		<>
			{multi && (
				<div>
					<span className="label">Format</span>
					<select className="select" value={phase.format} onChange={(e) => onPatch({ format: e.target.value as BracketFormat })}>
						{FORMATS.map((f) => (
							<option key={f.value} value={f.value}>
								{f.label}
							</option>
						))}
					</select>
				</div>
			)}

			{meta.grouped && (
				<div>
					<span className="label">{phase.format === 'league' ? 'Divisions' : 'Pools'}</span>
					<select className="select" value={phase.groups} onChange={(e) => onPatch({ groups: Number(e.target.value) })}>
						{Array.from({ length: Math.max(1, Math.floor(participantCount / 2)) }, (_, i) => i + 1).map((n) => (
							<option key={n} value={n}>
								{n === 1 ? (phase.format === 'league' ? 'Single table' : 'No pools') : `${n} (~${Math.floor(participantCount / n)} each)`}
							</option>
						))}
					</select>
				</div>
			)}

			{phase.entrants && earlier.length > 0 && (
				<QualificationEditor entrants={phase.entrants} earlier={earlier} onChange={(entrants) => onPatch({ entrants })} />
			)}

			<FormatOptions format={phase.format} options={o} setOption={setOption} protectedChoices={protectedSeedChoices(participantCount)} participantCount={participantCount} divisions={phase.groups} />
		</>
	);

	if (!multi) return <div className="flex flex-col gap-3">{body}</div>;

	return (
		<div className="rounded-lg border border-night-700 bg-night-900/40 p-3">
			<div className="mb-2 flex items-center gap-2">
				<span className="font-mono text-[0.65rem] text-fog-600">{index + 1}</span>
				<h3 className="flex-1 font-display text-xs font-bold uppercase tracking-[0.2em] text-fog-200">{phase.id}</h3>
				{index > 0 && (
					<>
						<button type="button" onClick={() => onMove(-1)} disabled={index <= 1} className="px-1 text-fog-500 hover:text-court-300 disabled:opacity-30" aria-label="Move up">
							↑
						</button>
						<button type="button" onClick={() => onMove(1)} disabled={index >= total - 1} className="px-1 text-fog-500 hover:text-court-300 disabled:opacity-30" aria-label="Move down">
							↓
						</button>
						<button type="button" onClick={onRemove} className="px-1 text-fog-500 hover:text-rose-300" aria-label="Remove phase">
							✕
						</button>
					</>
				)}
			</div>
			<div className="flex flex-col gap-3">{body}</div>
		</div>
	);
}

function FormatOptions({
	format,
	options: o,
	setOption,
	protectedChoices,
	participantCount,
	divisions
}: {
	format: BracketFormat;
	options: PhaseOptions;
	setOption: <K extends keyof PhaseOptions>(k: K, v: PhaseOptions[K]) => void;
	protectedChoices: number[];
	participantCount: number;
	divisions: number;
}) {
	return (
		<div className="flex flex-col gap-3">
			{format === 'single_elim' && (
				<>
					<Toggle label="Third-place match" checked={o.third_place_match} onChange={(v) => setOption('third_place_match', v)} />
					{!o.bye_rounds && <ProtectedSeeds value={o.protected_seeds} choices={protectedChoices} setOption={setOption} />}
					<ByeConfig value={o.bye_rounds} count={participantCount} setOption={setOption} />
				</>
			)}

			{format === 'double_elim' && (
				<>
					<Toggle
						label="Grand final reset"
						hint="Losers-bracket finalist gets a second set if they win the first."
						checked={o.grand_final_reset}
						onChange={(v) => setOption('grand_final_reset', v)}
					/>
					{!o.bye_rounds && <ProtectedSeeds value={o.protected_seeds} choices={protectedChoices} setOption={setOption} />}
					<ByeConfig value={o.bye_rounds} count={participantCount} setOption={setOption} presetsOnly maxLevel={2} />
				</>
			)}

			{format === 'swiss' && (
				<>
					<div>
						<span className="label">Rounds</span>
						<select
							className="select"
							value={String(o.swiss_rounds)}
							onChange={(e) => setOption('swiss_rounds', e.target.value === 'auto' ? 'auto' : Number(e.target.value))}
						>
							<option value="auto">Auto — recommended ({recommendedSwissRounds(participantCount)})</option>
							{Array.from({ length: 8 }, (_, i) => i + 1).map((r) => (
								<option key={r} value={r}>
									{r} round{r > 1 ? 's' : ''}
								</option>
							))}
						</select>
					</div>
					<div>
						<span className="label">Pairing method</span>
						<select className="select" value={o.pairing_method} onChange={(e) => setOption('pairing_method', e.target.value as 'dutch' | 'monrad')}>
							<option value="dutch">Dutch (FIDE)</option>
							<option value="monrad">Monrad</option>
						</select>
					</div>
				</>
			)}

			{format === 'gauntlet' && (
				<>
					<div>
						<span className="label">Style</span>
						<select className="select" value={o.gauntlet_style} onChange={(e) => setOption('gauntlet_style', e.target.value as 'single' | 'dual')}>
							<option value="single">Single — linear ladder</option>
							<option value="dual">Dual — two-bracket challenge</option>
						</select>
					</div>
					{o.gauntlet_style === 'dual' && (
						<>
							<Toggle
								label="Opponent choice"
								hint="The higher-seeded waiting player picks which challenger to face."
								checked={o.opponent_choice}
								onChange={(v) => setOption('opponent_choice', v)}
							/>
							{o.opponent_choice && (
								<div>
									<span className="label">Choice scope</span>
									<select className="select" value={o.choice_scope} onChange={(e) => setOption('choice_scope', e.target.value as 'round' | 'semifinals')}>
										<option value="semifinals">Semifinals only</option>
										<option value="round">Every round</option>
									</select>
								</div>
							)}
						</>
					)}
				</>
			)}

			{format === 'round_robin' && (
				<p className="text-xs text-fog-500">Everyone in a pool plays everyone once. Use the pool count above to split the field.</p>
			)}

			{format === 'league' && <LeagueOptions o={o} setOption={setOption} divisions={divisions} />}

			{(FORMATS.find((f) => f.value === format)?.standings ?? false) && <TiebreakersConfig value={o.tiebreakers} setOption={setOption} />}
		</div>
	);
}

function TiebreakersConfig({
	value,
	setOption
}: {
	value: PhaseOptions['tiebreakers'];
	setOption: <K extends keyof PhaseOptions>(k: K, v: PhaseOptions[K]) => void;
}) {
	const [open, setOpen] = useState(false);
	const custom = value !== null;
	return (
		<div className="rounded-lg border border-night-700 bg-night-850">
			<button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-3 py-2 text-left">
				<span className="text-sm text-fog-100">Tiebreakers</span>
				<span className="font-display text-[0.65rem] uppercase tracking-widest text-fog-500">
					{custom ? 'Custom' : 'Default'} {open ? '▴' : '▾'}
				</span>
			</button>
			{open && (
				<div className="border-t border-night-800 px-3 py-2.5">
					<Toggle
						label="Custom tiebreakers"
						hint="A points system, if set, ranks first; this chain breaks the remaining ties in order."
						checked={custom}
						onChange={(v) => setOption('tiebreakers', v ? [{ type: 'accumulated', input: 'games', agg: 'diff', higher_is_better: true }] : null)}
					/>
					{custom && (
						<div className="mt-2">
							<TiebreakerEditor chain={value} onChange={(c) => setOption('tiebreakers', c)} />
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function LeagueOptions({
	o,
	setOption,
	divisions
}: {
	o: PhaseOptions;
	setOption: <K extends keyof PhaseOptions>(k: K, v: PhaseOptions[K]) => void;
	divisions: number;
}) {
	const cd = o.cross_division;
	return (
		<>
			<Toggle label="Home & away" hint="Double round-robin — every pairing twice with venues swapped." checked={o.double} onChange={(v) => setOption('double', v)} />
			<Toggle
				label="Points system"
				hint="Rank by points (win/draw/loss) instead of raw record; enables draws."
				checked={!!o.points_system}
				onChange={(v) => setOption('points_system', v ? { ...DEFAULT_POINTS } : null)}
			/>
			{o.points_system && (
				<div className="grid grid-cols-3 gap-2">
					{(['win', 'draw', 'loss'] as const).map((k) => (
						<label key={k} className="flex flex-col gap-1">
							<span className="font-display text-[0.6rem] uppercase tracking-widest text-fog-500">{k}</span>
							<input
								type="number"
								value={o.points_system![k]}
								onChange={(e) => setOption('points_system', { ...o.points_system!, [k]: Number(e.target.value) })}
								className="input py-1 text-center text-sm"
							/>
						</label>
					))}
				</div>
			)}
			{divisions > 1 && (
				<Toggle
					label="Cross-division play"
					hint="Layer inter-division games on top of each division's round-robin."
					checked={!!cd}
					onChange={(v) => setOption('cross_division', v ? { games_per_team: 1, pairing: 'balanced', repeat_home_away: false, seed: 0 } : null)}
				/>
			)}
			{divisions > 1 && cd && (
				<>
					<div>
						<span className="label">Cross games / team</span>
						<input
							type="number"
							min={1}
							value={cd.games_per_team}
							onChange={(e) => setOption('cross_division', { ...cd, games_per_team: Math.max(1, Number(e.target.value)) })}
							className="input w-20 py-1 text-center text-sm"
						/>
					</div>
					<div>
						<span className="label">Cross pairing</span>
						<select className="select" value={cd.pairing} onChange={(e) => setOption('cross_division', { ...cd, pairing: e.target.value as CrossDivisionPairing })}>
							<option value="balanced">Balanced (matching rank)</option>
							<option value="top_seed_favored">Top-seed favored</option>
							<option value="random">Random</option>
							<option value="round_robin">Full interleague</option>
						</select>
					</div>
				</>
			)}
		</>
	);
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
	return (
		<label className="flex cursor-pointer items-start gap-2.5">
			<input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-court-500" />
			<span>
				<span className="block text-sm text-fog-100">{label}</span>
				{hint && <span className="block text-xs text-fog-500">{hint}</span>}
			</span>
		</label>
	);
}

function ByeConfig({
	value,
	count,
	setOption,
	presetsOnly = false,
	maxLevel
}: {
	value: Record<number, number> | null;
	count: number;
	setOption: <K extends keyof PhaseOptions>(k: K, v: PhaseOptions[K]) => void;
	presetsOnly?: boolean;
	maxLevel?: number;
}) {
	const { engine } = usePyodide();
	const [open, setOpen] = useState(false);
	const [options, setOptions] = useState<ByeOption[] | null>(null);
	const custom = value !== null;
	const map = value ?? standardByeRounds(count);

	function loadOptions() {
		if (!engine) return;
		const res = engine.dispatch({ op: 'bye_options', count, ...(maxLevel != null ? { max_bye_level: maxLevel } : {}) });
		setOptions(res.ok && 'options' in res ? res.options : []);
	}

	function applyOption(opt: ByeOption) {
		const next: Record<number, number> = {};
		for (let s = 1; s <= count; s++) next[s] = opt.bye_rounds[String(s)] ?? 0;
		setOption('bye_rounds', next);
	}

	function toggleCustom(v: boolean) {
		setOption('bye_rounds', v ? standardByeRounds(count) : null);
		if (v && presetsOnly) loadOptions();
	}

	return (
		<div className="rounded-lg border border-night-700 bg-night-850">
			<button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-3 py-2 text-left">
				<span className="text-sm text-fog-100">Bye configuration</span>
				<span className="font-display text-[0.65rem] uppercase tracking-widest text-fog-500">
					{custom ? 'Custom' : 'Standard'} {open ? '▴' : '▾'}
				</span>
			</button>

			{open && (
				<div className="border-t border-night-800 px-3 py-2.5">
					<Toggle
						label="Customize byes"
						hint={
							presetsOnly
								? 'Pick a curated bye setup (up to double byes for the top seeds).'
								: 'Give top seeds multiple rounds of byes. Counts must not increase as seeds get worse.'
						}
						checked={custom}
						onChange={toggleCustom}
					/>

					{custom && (
						<>
							{!presetsOnly && <ByeDividerEditor count={count} value={map} setByeRounds={(m) => setOption('bye_rounds', m)} engine={engine} />}

							<div className={presetsOnly ? '' : 'mt-2 border-t border-night-800 pt-2'}>
								<button
									type="button"
									className="mr-1.5 rounded border border-night-600 px-2 py-0.5 text-[0.7rem] text-fog-300 hover:border-court-400 hover:text-court-300"
									onClick={() => setOption('bye_rounds', presetsOnly ? null : standardByeRounds(count))}
								>
									Reset to standard
								</button>
								<button
									type="button"
									className="rounded border border-night-600 px-2 py-0.5 text-[0.7rem] text-fog-300 hover:border-court-400 hover:text-court-300 disabled:opacity-40"
									disabled={!engine}
									onClick={loadOptions}
								>
									{options ? 'Refresh suggested setups' : 'Suggest setups'}
								</button>
								{options && options.length === 0 && <p className="mt-1.5 text-[0.7rem] text-fog-500">No bye setups for this field size.</p>}
								{options && options.length > 0 && (
									<div className="mt-1.5 flex max-h-40 flex-col gap-1 overflow-y-auto pr-1">
										{options.map((opt, i) => (
											<button
												key={i}
												type="button"
												onClick={() => applyOption(opt)}
												className="flex items-center justify-between rounded border border-night-700 px-2 py-1 text-left text-[0.7rem] text-fog-300 hover:border-court-400 hover:text-court-200"
											>
												<span>{opt.label}</span>
												<span className="ml-2 shrink-0 font-mono text-fog-500">{opt.rounds} rds</span>
											</button>
										))}
									</div>
								)}
							</div>
						</>
					)}
				</div>
			)}
		</div>
	);
}

function ProtectedSeeds({
	value,
	choices,
	setOption
}: {
	value: number;
	choices: number[];
	setOption: <K extends keyof PhaseOptions>(k: K, v: PhaseOptions[K]) => void;
}) {
	return (
		<div>
			<span className="label">Protected seeds</span>
			<select className="select" value={value} onChange={(e) => setOption('protected_seeds', Number(e.target.value))}>
				{choices.map((c) => (
					<option key={c} value={c}>
						{c === 0 ? 'None' : `Top ${c} kept apart`}
					</option>
				))}
			</select>
		</div>
	);
}
