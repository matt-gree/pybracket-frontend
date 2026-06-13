'use client';

import { useState } from 'react';
import {
	FORMATS,
	MAX_PARTICIPANTS,
	MIN_PARTICIPANTS,
	protectedSeedChoices,
	recommendedSwissRounds,
	resizeNames,
	type BuilderState
} from '@/lib/spec';
import type { BracketFormat } from '@/lib/types';

interface Props {
	state: BuilderState;
	onChange: (next: BuilderState) => void;
	onGenerate: () => void;
	busy: boolean;
	disabled: boolean;
}

export function BuilderForm({ state, onChange, onGenerate, busy, disabled }: Props) {
	const [editNames, setEditNames] = useState(false);
	const o = state.options;

	function setFormat(format: BracketFormat) {
		onChange({ ...state, format });
	}

	function setCount(countRaw: number) {
		const count = Math.max(MIN_PARTICIPANTS, Math.min(MAX_PARTICIPANTS, Math.round(countRaw || 0)));
		onChange({ ...state, participantCount: count, names: resizeNames(state.names, count) });
	}

	function setOption<K extends keyof BuilderState['options']>(key: K, value: BuilderState['options'][K]) {
		onChange({ ...state, options: { ...state.options, [key]: value } });
	}

	function setName(index: number, value: string) {
		const names = state.names.slice();
		names[index] = value;
		onChange({ ...state, names });
	}

	const protectedChoices = protectedSeedChoices(state.participantCount);

	return (
		<div className="flex flex-col gap-5">
			{/* Format */}
			<div>
				<span className="label">Format</span>
				<div className="grid grid-cols-1 gap-2">
					{FORMATS.map((f) => {
						const active = state.format === f.value;
						return (
							<button
								key={f.value}
								type="button"
								onClick={() => setFormat(f.value)}
								className={`rounded-lg border px-3 py-2 text-left transition-colors ${
									active
										? 'border-court-500/70 bg-court-500/10'
										: 'border-night-700 bg-night-850 hover:border-night-600'
								}`}
							>
								<span className="font-display text-sm font-bold uppercase tracking-wide text-fog-100">
									{f.label}
								</span>
								<span className="mt-0.5 block text-xs leading-snug text-fog-500">{f.blurb}</span>
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
								<input
									value={name}
									onChange={(e) => setName(i, e.target.value)}
									className="input py-1 text-xs"
									placeholder={`Seed ${i + 1}`}
								/>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Format-specific options */}
			<FormatOptions
				format={state.format}
				options={o}
				setOption={setOption}
				protectedChoices={protectedChoices}
				participantCount={state.participantCount}
			/>

			<button
				type="button"
				onClick={onGenerate}
				disabled={disabled || busy}
				className="btn-primary w-full"
			>
				{busy ? 'Generating…' : 'Generate bracket'}
			</button>
		</div>
	);
}

function FormatOptions({
	format,
	options: o,
	setOption,
	protectedChoices,
	participantCount
}: {
	format: BracketFormat;
	options: BuilderState['options'];
	setOption: <K extends keyof BuilderState['options']>(k: K, v: BuilderState['options'][K]) => void;
	protectedChoices: number[];
	participantCount: number;
}) {
	if (format === 'round_robin') {
		return (
			<p className="text-xs text-fog-500">
				Round robin has no extra options — every participant plays every other once.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<span className="label mb-0">Options</span>

			{format === 'single_elim' && (
				<>
					<Toggle
						label="Third-place match"
						checked={o.third_place_match}
						onChange={(v) => setOption('third_place_match', v)}
					/>
					<ProtectedSeeds value={o.protected_seeds} choices={protectedChoices} setOption={setOption} />
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
					<ProtectedSeeds value={o.protected_seeds} choices={protectedChoices} setOption={setOption} />
				</>
			)}

			{format === 'swiss' && (
				<>
					<div>
						<span className="label">Rounds</span>
						<select
							className="select"
							value={String(o.swiss_rounds)}
							onChange={(e) =>
								setOption('swiss_rounds', e.target.value === 'auto' ? 'auto' : Number(e.target.value))
							}
						>
							<option value="auto">
								Auto — recommended ({recommendedSwissRounds(participantCount)})
							</option>
							{Array.from({ length: 8 }, (_, i) => i + 1).map((r) => (
								<option key={r} value={r}>
									{r} round{r > 1 ? 's' : ''}
								</option>
							))}
						</select>
					</div>
					<div>
						<span className="label">Pairing method</span>
						<select
							className="select"
							value={o.pairing_method}
							onChange={(e) => setOption('pairing_method', e.target.value as 'dutch' | 'monrad')}
						>
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
						<select
							className="select"
							value={o.gauntlet_style}
							onChange={(e) => setOption('gauntlet_style', e.target.value as 'single' | 'dual')}
						>
							<option value="single">Single — linear ladder</option>
							<option value="dual">Dual — two-bracket challenge</option>
						</select>
					</div>
					{o.gauntlet_style === 'dual' && (
						<Toggle
							label="Opponent choice"
							hint="Top seed picks which survivor to face in the semifinal."
							checked={o.opponent_choice}
							onChange={(v) => setOption('opponent_choice', v)}
						/>
					)}
				</>
			)}
		</div>
	);
}

function Toggle({
	label,
	hint,
	checked,
	onChange
}: {
	label: string;
	hint?: string;
	checked: boolean;
	onChange: (v: boolean) => void;
}) {
	return (
		<label className="flex cursor-pointer items-start gap-2.5">
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
				className="mt-0.5 h-4 w-4 shrink-0 accent-court-500"
			/>
			<span>
				<span className="block text-sm text-fog-100">{label}</span>
				{hint && <span className="block text-xs text-fog-500">{hint}</span>}
			</span>
		</label>
	);
}

function ProtectedSeeds({
	value,
	choices,
	setOption
}: {
	value: number;
	choices: number[];
	setOption: <K extends keyof BuilderState['options']>(k: K, v: BuilderState['options'][K]) => void;
}) {
	return (
		<div>
			<span className="label">Protected seeds</span>
			<select
				className="select"
				value={value}
				onChange={(e) => setOption('protected_seeds', Number(e.target.value))}
			>
				{choices.map((c) => (
					<option key={c} value={c}>
						{c === 0 ? 'None' : `Top ${c} kept apart`}
					</option>
				))}
			</select>
		</div>
	);
}
