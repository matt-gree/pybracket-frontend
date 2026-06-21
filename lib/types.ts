// TypeScript mirror of pybracket's serialization + the bridge's query read-models
// (see pybracket/utils/serialization.py and public/py/bridge.py). Participant ids in this studio
// are always integers (1..N), so id fields are typed as number. JSON object keys are strings, so
// stat dicts keyed by participant id arrive string-keyed.

export type BracketFormat =
	| 'single_elim'
	| 'double_elim'
	| 'round_robin'
	| 'swiss'
	| 'gauntlet'
	| 'league';

export type BracketSide = 'winners' | 'losers' | 'grand_final';

export type MatchStatus =
	| 'pending'
	| 'ready'
	| 'bye'
	| 'completed'
	| 'pending_choice'
	| 'not_needed';

export type AdvancementType = 'result' | 'bye' | 'forfeit' | 'walkover' | 'draw';

export type BracketState = 'draft' | 'published' | 'complete';

export type PairingMethod = 'monrad' | 'dutch';

export interface Participant {
	id: number;
	seed: number;
	name: string;
	stats: Record<string, unknown>;
}

// Per-game record of a best-of series (scoring layer). stats: statName -> {participantId: value}.
export interface Game {
	number: number;
	winner_id: number | null;
	loser_id: number | null;
	stats: Record<string, Record<string, number>>;
	metadata: Record<string, unknown>;
}

export interface Match {
	id: number;
	round_number: number;
	bracket_side: BracketSide;
	participant1_id: number | null;
	participant2_id: number | null;
	winner_id: number | null;
	loser_id: number | null;
	advancement_type: AdvancementType | null;
	next_winner_match_id: number | null;
	next_loser_match_id: number | null;
	status: MatchStatus;
	best_of: number;
	metadata: Record<string, unknown>;
	games: Game[];
	stats: Record<string, Record<string, number>>;
}

export interface Round {
	number: number;
	bracket_side: BracketSide;
	match_ids: number[];
	name: string;
	best_of: number | null;
}

export interface Bracket {
	format: BracketFormat;
	state: BracketState;
	participants: Participant[];
	matches: Match[];
	rounds: Round[];
	config: Record<string, unknown>;
}

export interface Standing {
	participant_id: number;
	rank: number;
	wins: number;
	losses: number;
	draws: number;
	points: number;
	tiebreaker_scores: Record<string, number>;
}

export interface Placement {
	participant_id: number;
	position: number;
	position_label: string;
	eliminated_in: string;
}

export interface PointsSystem {
	win: number;
	draw: number;
	loss: number;
	draws_allowed: boolean;
}

export type CrossDivisionPairing = 'balanced' | 'random' | 'top_seed_favored' | 'round_robin';

export interface CrossDivision {
	games_per_team: number;
	pairing: CrossDivisionPairing;
	repeat_home_away: boolean;
	seed: number;
}

// --- multi-stage tournament -----------------------------------------------------------------

// SlotRef sentinels mirror the library: place=0 = ALL_PLACES, group=-1 = EACH_GROUP.
export const ALL_PLACES = 0;
export const EACH_GROUP = -1;

export interface SlotRef {
	phase: string;
	place: number;
	group: number | null;
}

export type Seeding = 'snake' | 'rank' | 'manual';

export interface Qualification {
	sources: SlotRef[];
	seeding: Seeding;
}

export interface Phase {
	id: string;
	format: BracketFormat;
	config: Record<string, unknown>;
	entrants: Qualification | null;
	groups: number;
	group_assignment: Seeding;
	brackets: Bracket[];
	state: BracketState;
}

export interface Tournament {
	phases: Phase[];
	participants: Participant[];
	config: Record<string, unknown>;
}

export interface Ranked {
	participant_id: number;
	rank: number;
	group: number;
}

// --- league read-model ----------------------------------------------------------------------

export interface Fixture {
	match_id: number;
	home_id: number;
	away_id: number;
	division: number | null; // null = cross-division game
}

export interface Matchweek {
	number: number;
	fixtures: Fixture[];
}

export interface LeagueExtras {
	divisions: number[][];
	division_standings: Standing[][];
	schedule: Matchweek[];
	points_system?: PointsSystem;
}

// --- bridge query read-models ---------------------------------------------------------------

// Per-bracket read model the bridge precomputes so the UI never re-derives library state.
export interface BracketQuery {
	ready_match_ids: number[];
	standings: Standing[];
	placements: Placement[];
	winner: Participant | null;
	is_complete: boolean;
}

export interface PhaseQuery {
	id: string;
	format: BracketFormat;
	state: BracketState;
	groups: number;
	has_brackets: boolean;
	is_complete: boolean;
	is_draftable: boolean;
	is_preview: boolean;
	brackets: BracketQuery[];
	group_results: Ranked[][];
	league?: LeagueExtras;
}

export interface TournamentQuery {
	phases: PhaseQuery[];
}

export interface TournamentBundle {
	tournament: Tournament;
	query: TournamentQuery;
}

export interface UnwindSignal {
	match_id: number;
	metadata: Record<string, unknown>;
}

// Allowable bye configuration for a field size (engine `bye_options`).
export interface ByeOption {
	rounds: number;
	doubles: number;
	singles: number;
	label: string;
	bye_rounds: Record<string, number>;
}

// The bridge's response envelope. Most ops return a tournament + query; the stateless bye helpers
// return their own shapes; all share `ok`.
export type DispatchResult =
	| { ok: true; tournament: Tournament; query: TournamentQuery; signals?: UnwindSignal[] }
	| { ok: true; options: ByeOption[] }
	| { ok: true; completed: Record<string, number>; added: Record<string, number>; rounds: number }
	| { ok: false; error: string };

/** Narrow a dispatch envelope to the tournament shape. */
export function isTournamentResult(
	result: DispatchResult
): result is { ok: true; tournament: Tournament; query: TournamentQuery; signals?: UnwindSignal[] } {
	return result.ok && 'tournament' in result;
}

/** Games won by (participant1, participant2) in a match's series. */
export function seriesScore(match: Match): [number, number] {
	let a = 0;
	let b = 0;
	for (const g of match.games) {
		if (g.winner_id == null) continue;
		if (g.winner_id === match.participant1_id) a++;
		else if (g.winner_id === match.participant2_id) b++;
	}
	return [a, b];
}
