import {
	ALL_PLACES,
	EACH_GROUP,
	type BracketFormat,
	type CrossDivision,
	type PairingMethod,
	type Participant,
	type PointsSystem,
	type Seeding,
	type SlotRef
} from './types';

export interface FormatMeta {
	value: BracketFormat;
	label: string;
	blurb: string;
	/** Grouped formats expose a divisions/pools count; leagues keep divisions in one bracket. */
	grouped?: boolean;
	standings?: boolean;
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
		blurb: 'Everyone plays everyone once (circle method). Standings decide the winner.',
		grouped: true,
		standings: true
	},
	{
		value: 'swiss',
		label: 'Swiss',
		blurb: 'Score-paired rounds with no rematches. Dutch (FIDE) or Monrad pairing.',
		standings: true
	},
	{
		value: 'gauntlet',
		label: 'Gauntlet',
		blurb: 'A single linear ladder, or a dual two-bracket challenge into the top seeds.'
	},
	{
		value: 'league',
		label: 'League',
		blurb: 'A regular season: divisions, home/away, cross-division play, points & a schedule.',
		grouped: true,
		standings: true
	}
];

export function formatMeta(format: BracketFormat): FormatMeta {
	return FORMATS.find((f) => f.value === format) ?? FORMATS[0];
}

export type SwissRoundsMode = number | 'auto';

// One member of a tiebreaker chain — mirrors the library's `type`-discriminated specs.
export type TiebreakerSpec =
	| { type: 'win_count' }
	| { type: 'head_to_head' }
	| { type: 'mini_league' }
	| { type: 'buchholz'; truncated?: boolean }
	| { type: 'accumulated'; input: string; agg: 'for' | 'against' | 'diff' | 'count' | 'avg'; higher_is_better?: boolean };

// All format-specific options live in one bag; only the relevant keys are read per format.
export interface PhaseOptions {
	// single / double elim
	third_place_match: boolean;
	grand_final_reset: boolean;
	protected_seeds: number;
	bye_rounds: Record<number, number> | null;
	survivors: number | null;
	// swiss
	swiss_rounds: SwissRoundsMode;
	pairing_method: PairingMethod;
	// gauntlet
	gauntlet_style: 'single' | 'dual';
	opponent_choice: boolean;
	choice_scope: 'round' | 'semifinals';
	// league / standings scoring
	double: boolean;
	best_of: number;
	points_system: PointsSystem | null;
	cross_division: CrossDivision | null;
	tiebreakers: TiebreakerSpec[] | null;
}

// An editor-side qualifier source (compiled to SlotRef[] at action time). Keeping the authoring
// intent (e.g. "top 2 of each group") avoids the lossy round-trip of reconstructing it from a flat
// SlotRef list. Multiple sources on one phase = a merge; two phases citing the same upstream = a
// split — together these express the full DAG.
export type SourceSpec =
	| { phase: string; kind: 'all'; group: number | null }
	| { phase: string; kind: 'top'; n: number; group: number | null }
	| { phase: string; kind: 'place'; place: number; group: number | null }
	| { phase: string; kind: 'top_each'; n: number }
	| { phase: string; kind: 'place_each'; place: number };

export interface QualificationDraft {
	sources: SourceSpec[];
	seeding: Seeding;
}

/** Compile an editor source list into the flat SlotRef array the bridge consumes. */
export function sourcesToSlotRefs(sources: SourceSpec[]): SlotRef[] {
	const out: SlotRef[] = [];
	for (const s of sources) {
		if (s.kind === 'all') out.push({ phase: s.phase, place: ALL_PLACES, group: s.group });
		else if (s.kind === 'top') for (let k = 1; k <= s.n; k++) out.push({ phase: s.phase, place: k, group: s.group });
		else if (s.kind === 'place') out.push({ phase: s.phase, place: s.place, group: s.group });
		else if (s.kind === 'top_each') for (let k = 1; k <= s.n; k++) out.push({ phase: s.phase, place: k, group: EACH_GROUP });
		else out.push({ phase: s.phase, place: s.place, group: EACH_GROUP });
	}
	return out;
}

export interface PhaseDraft {
	id: string;
	format: BracketFormat;
	groups: number; // pools count, or divisions for a league
	options: PhaseOptions;
	entrants: QualificationDraft | null; // null only for the first phase
}

export interface BuilderState {
	participantCount: number;
	names: string[]; // length === participantCount; blank entries fall back to "Seed N"
	shape: string; // a SHAPES id (a single format, a preset chain, or 'custom')
	phases: PhaseDraft[];
	tiebreakers: TiebreakerSpec[] | null; // tournament-level default chain
}

// Authoring shortcuts: each single format, plus a few common multi-stage chains. 'custom' lets the
// phase-list editor compose arbitrary phases.
export interface ShapeMeta {
	id: string;
	label: string;
	blurb: string;
	multi?: boolean;
}

export const SHAPES: ShapeMeta[] = [
	...FORMATS.map((f) => ({ id: f.value, label: f.label, blurb: f.blurb })),
	{ id: 'pools_bracket', label: 'Pools → Bracket', blurb: 'Round-robin pools seed survivors into an elimination bracket you confirm before play.', multi: true },
	{ id: 'league_playoffs', label: 'League → Playoffs', blurb: 'A league season seeds its top finishers into a knockout playoff bracket.', multi: true },
	{ id: 'swiss_cut', label: 'Swiss → Top Cut', blurb: 'Swiss rounds seed a single-elimination top cut.', multi: true },
	{ id: 'custom', label: 'Custom (multi-phase)', blurb: 'Compose arbitrary phases and wire the qualifiers between them yourself.', multi: true }
];

/** The phase list for a shape id (a single format, or a preset chain). */
export function buildShape(id: string): PhaseDraft[] {
	switch (id) {
		case 'pools_bracket': {
			const pools = makePhase('pools', 'round_robin');
			pools.groups = 2;
			return [pools, makePhase('cut', 'single_elim', { sources: [{ phase: 'pools', kind: 'top_each', n: 2 }], seeding: 'snake' })];
		}
		case 'league_playoffs': {
			const season = makePhase('season', 'league');
			season.groups = 2;
			season.options.points_system = { ...DEFAULT_POINTS };
			return [season, makePhase('playoffs', 'single_elim', { sources: [{ phase: 'season', kind: 'top', n: 4, group: null }], seeding: 'snake' })];
		}
		case 'swiss_cut':
			return [makePhase('swiss', 'swiss'), makePhase('cut', 'single_elim', { sources: [{ phase: 'swiss', kind: 'top', n: 4, group: null }], seeding: 'snake' })];
		case 'custom':
			return [makePhase('phase1', 'round_robin'), makePhase('phase2', 'single_elim', { sources: [{ phase: 'phase1', kind: 'top', n: 4, group: null }], seeding: 'snake' })];
		default:
			return [makePhase('main', id as BracketFormat)];
	}
}

export const MIN_PARTICIPANTS = 2;
export const MAX_PARTICIPANTS = 64;

export const DEFAULT_POINTS: PointsSystem = { win: 3, draw: 1, loss: 0, draws_allowed: true };

export function defaultPhaseOptions(): PhaseOptions {
	return {
		third_place_match: false,
		grand_final_reset: true,
		protected_seeds: 0,
		bye_rounds: null,
		survivors: null,
		swiss_rounds: 'auto',
		pairing_method: 'dutch',
		gauntlet_style: 'dual',
		opponent_choice: false,
		choice_scope: 'round',
		double: false,
		best_of: 1,
		points_system: null,
		cross_division: null,
		tiebreakers: null
	};
}

export function makePhase(id: string, format: BracketFormat, entrants: QualificationDraft | null = null): PhaseDraft {
	return { id, format, groups: format === 'league' ? 2 : 1, options: defaultPhaseOptions(), entrants };
}

export function defaultBuilderState(): BuilderState {
	return {
		participantCount: 8,
		names: defaultNames(8),
		shape: 'single_elim',
		phases: [makePhase('main', 'single_elim')],
		tiebreakers: null
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

// --- SlotRef constructors (mirror pybracket.tournament.all_of/top/...) -----------------------

export function allOf(phase: string, group: number | null = null): SlotRef[] {
	return [{ phase, place: ALL_PLACES, group }];
}
export function topN(phase: string, n: number, group: number | null = null): SlotRef[] {
	return Array.from({ length: n }, (_, i) => ({ phase, place: i + 1, group }));
}
export function topOfEachGroup(phase: string, n: number): SlotRef[] {
	return Array.from({ length: n }, (_, i) => ({ phase, place: i + 1, group: EACH_GROUP }));
}
export function placeOf(phase: string, p: number, group: number | null = null): SlotRef {
	return { phase, place: p, group };
}

// --- bridge action --------------------------------------------------------------------------

/** Translate a phase's options into the bridge's per-format options dict. */
function phaseOptions(format: BracketFormat, o: PhaseOptions): Record<string, unknown> {
	const scoring: Record<string, unknown> = {};
	if (o.points_system) scoring.points_system = o.points_system;
	if (o.tiebreakers && o.tiebreakers.length) scoring.tiebreakers = o.tiebreakers;

	switch (format) {
		case 'single_elim':
			return {
				third_place_match: o.third_place_match,
				protected_seeds: o.bye_rounds ? 0 : o.protected_seeds,
				...(o.bye_rounds ? { bye_rounds: o.bye_rounds } : {}),
				...(o.survivors ? { survivors: o.survivors } : {})
			};
		case 'double_elim':
			return {
				grand_final_reset: o.grand_final_reset,
				protected_seeds: o.bye_rounds ? 0 : o.protected_seeds,
				...(o.bye_rounds ? { bye_rounds: o.bye_rounds } : {})
			};
		case 'round_robin':
			return scoring;
		case 'swiss':
			return {
				rounds: o.swiss_rounds === 'auto' ? null : o.swiss_rounds,
				pairing_method: o.pairing_method,
				...scoring
			};
		case 'gauntlet':
			return {
				style: o.gauntlet_style,
				opponent_choice: o.gauntlet_style === 'dual' ? o.opponent_choice : false,
				choice_scope: o.choice_scope
			};
		case 'league':
			return {
				double: o.double,
				best_of: o.best_of,
				...(o.cross_division ? { cross_division: o.cross_division } : {}),
				...scoring
			};
	}
}

export interface PhasePayload {
	id: string;
	format: BracketFormat;
	groups: number;
	group_assignment: Seeding;
	options: Record<string, unknown>;
	entrants: { sources: SlotRef[]; seeding: Seeding } | null;
}

export interface CreateAction {
	op: 'create';
	participants: Participant[];
	phases: PhasePayload[];
	config: Record<string, unknown>;
}

/** Translate the builder state into the `create` action the Python bridge understands. */
export function buildCreateAction(state: BuilderState): CreateAction {
	const participants = makeParticipants(state);
	const phases: PhasePayload[] = state.phases.map((p) => ({
		id: p.id,
		format: p.format,
		groups: p.groups,
		group_assignment: 'snake',
		options: phaseOptions(p.format, p.options),
		entrants: p.entrants ? { sources: sourcesToSlotRefs(p.entrants.sources), seeding: p.entrants.seeding } : null
	}));
	const config: Record<string, unknown> = {};
	if (state.tiebreakers && state.tiebreakers.length) config.tiebreakers = state.tiebreakers;
	return { op: 'create', participants, phases, config };
}
