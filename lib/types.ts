// TypeScript mirror of pybracket's serialization shape (see pybracket/utils/serialization.py).
// Participant ids in this studio are always integers (1..N), so id fields are typed as number.

export type BracketFormat =
	| 'single_elim'
	| 'double_elim'
	| 'round_robin'
	| 'swiss'
	| 'gauntlet';

export type BracketSide = 'winners' | 'losers' | 'grand_final';

export type MatchStatus =
	| 'pending'
	| 'ready'
	| 'bye'
	| 'completed'
	| 'pending_choice'
	| 'not_needed';

export type AdvancementType = 'result' | 'bye' | 'forfeit' | 'walkover';

export type BracketState = 'draft' | 'published' | 'complete';

export type PairingMethod = 'monrad' | 'dutch';

export interface Participant {
	id: number;
	seed: number;
	name: string;
	stats: Record<string, unknown>;
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
	tiebreaker_scores: Record<string, number>;
}

export interface Placement {
	participant_id: number;
	position: number;
	position_label: string;
	eliminated_in: string;
}

// Pre-computed read models the bridge returns alongside every bracket mutation, so the UI
// never has to re-derive them (and they always reflect the real library's view).
export interface BracketQuery {
	ready_match_ids: number[];
	standings: Standing[];
	placements: Placement[];
	winner: Participant | null;
	is_complete: boolean;
}

export interface UnwindSignal {
	match_id: number;
	metadata: Record<string, unknown>;
}

// The bridge's single response envelope.
export type DispatchResult =
	| {
			ok: true;
			bracket: Bracket;
			query: BracketQuery;
			signals?: UnwindSignal[];
	  }
	| { ok: false; error: string };

export interface BracketBundle {
	bracket: Bracket;
	query: BracketQuery;
}
