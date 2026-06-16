import type { BracketFormat, PairingMethod, Participant } from './types';

export interface FormatMeta {
	value: BracketFormat;
	label: string;
	blurb: string;
}

export const FORMATS: FormatMeta[] = [
	{
		value: 'single_elim',
		label: 'Single Elimination',
		blurb: 'One loss and you are out. Top seeds receive byes to a power-of-two bracket.'
	},
	{
		value: 'double_elim',
		label: 'Double Elimination',
		blurb: 'Winners and losers brackets feed a grand final, with an optional bracket reset.'
	},
	{
		value: 'round_robin',
		label: 'Round Robin',
		blurb: 'Everyone plays everyone once (circle method). Standings decide the winner.'
	},
	{
		value: 'swiss',
		label: 'Swiss',
		blurb: 'Score-paired rounds with no rematches. Dutch (FIDE) or Monrad pairing.'
	},
	{
		value: 'gauntlet',
		label: 'Gauntlet',
		blurb: 'A single linear ladder, or a dual two-bracket challenge into the top seeds.'
	},
	{
		value: 'pools',
		label: 'Pools',
		blurb: 'Round-robin pools seed survivors into an elimination bracket you confirm before play.'
	}
];

export type SwissRoundsMode = number | 'auto';

export interface BuilderOptions {
	// single / double elim
	third_place_match: boolean;
	grand_final_reset: boolean;
	protected_seeds: number;
	// single elim: explicit per-seed bye rounds, or null for the standard power-of-two strategy
	bye_rounds: Record<number, number> | null;
	// swiss
	swiss_rounds: SwissRoundsMode;
	pairing_method: PairingMethod;
	// gauntlet
	gauntlet_style: 'single' | 'dual';
	opponent_choice: boolean;
	choice_scope: 'round' | 'semifinals';
	// pools
	num_pools: number;
	advancement_count: number;
	pool_bracket_format: 'single_elim' | 'double_elim';
}

export interface BuilderState {
	format: BracketFormat;
	participantCount: number;
	names: string[]; // length === participantCount; blank entries fall back to "Seed N"
	options: BuilderOptions;
}

export const MIN_PARTICIPANTS = 2;
export const MAX_PARTICIPANTS = 32;

export const DEFAULT_OPTIONS: BuilderOptions = {
	third_place_match: false,
	grand_final_reset: true,
	protected_seeds: 0,
	bye_rounds: null,
	swiss_rounds: 'auto',
	pairing_method: 'dutch',
	gauntlet_style: 'dual',
	opponent_choice: false,
	choice_scope: 'round',
	num_pools: 2,
	advancement_count: 2,
	pool_bracket_format: 'double_elim'
};

export function defaultBuilderState(): BuilderState {
	return {
		format: 'single_elim',
		participantCount: 8,
		names: defaultNames(8),
		options: { ...DEFAULT_OPTIONS }
	};
}

export function defaultNames(count: number): string[] {
	return Array.from({ length: count }, (_, i) => `Seed ${i + 1}`);
}

/** Resize a names array, preserving existing custom entries. */
export function resizeNames(names: string[], count: number): string[] {
	const next = defaultNames(count);
	for (let i = 0; i < Math.min(count, names.length); i++) {
		if (names[i] && names[i].trim()) next[i] = names[i];
	}
	return next;
}

export function recommendedSwissRounds(n: number): number {
	if (n < 2) return 0;
	return Math.ceil(Math.log2(n));
}

/** Valid protected-seed choices for a field of `count`: 0 or any power of two < count. */
export function protectedSeedChoices(count: number): number[] {
	const choices = [0];
	for (let p = 2; p < count; p *= 2) choices.push(p);
	return choices;
}

function nextPowerOfTwo(n: number): number {
	let p = 1;
	while (p < n) p *= 2;
	return p;
}

/**
 * The standard single-elim bye strategy as an explicit per-seed map: the top `size - count`
 * seeds receive one bye, everyone else zero. Used to pre-fill the bye-configuration editor.
 */
export function standardByeRounds(count: number): Record<number, number> {
	const byes = nextPowerOfTwo(count) - count;
	const map: Record<number, number> = {};
	for (let seed = 1; seed <= count; seed++) map[seed] = seed <= byes ? 1 : 0;
	return map;
}

export function makeParticipants(state: BuilderState): Participant[] {
	return Array.from({ length: state.participantCount }, (_, i) => {
		const raw = state.names[i]?.trim();
		return {
			id: i + 1,
			seed: i + 1,
			name: raw && raw.length > 0 ? raw : `Seed ${i + 1}`,
			stats: {}
		};
	});
}

export interface CreateAction {
	op: 'create';
	format: BracketFormat;
	participants: Participant[];
	options: Record<string, unknown>;
}

/** Translate the builder state into the `create` action the Python bridge understands. */
export function buildCreateAction(state: BuilderState): CreateAction {
	const o = state.options;
	const participants = makeParticipants(state);
	let options: Record<string, unknown> = {};

	switch (state.format) {
		case 'single_elim':
			options = {
				third_place_match: o.third_place_match,
				// bye_rounds fully determines the structure, so protected_seeds is mutually exclusive.
				protected_seeds: o.bye_rounds ? 0 : o.protected_seeds,
				...(o.bye_rounds ? { bye_rounds: o.bye_rounds } : {})
			};
			break;
		case 'double_elim':
			options = {
				grand_final_reset: o.grand_final_reset,
				// bye_rounds fully determines the structure, so protected_seeds is mutually exclusive.
				protected_seeds: o.bye_rounds ? 0 : o.protected_seeds,
				...(o.bye_rounds ? { bye_rounds: o.bye_rounds } : {})
			};
			break;
		case 'round_robin':
			options = {};
			break;
		case 'swiss':
			options = {
				rounds: o.swiss_rounds === 'auto' ? null : o.swiss_rounds,
				pairing_method: o.pairing_method
			};
			break;
		case 'gauntlet':
			options = {
				style: o.gauntlet_style,
				opponent_choice: o.gauntlet_style === 'dual' ? o.opponent_choice : false,
				choice_scope: o.choice_scope
			};
			break;
		case 'pools':
			options = {
				num_pools: o.num_pools,
				advancement_count: o.advancement_count,
				bracket_format: o.pool_bracket_format,
				grand_final_reset: o.grand_final_reset,
				third_place_match: o.third_place_match
			};
			break;
	}

	return { op: 'create', format: state.format, participants, options };
}
