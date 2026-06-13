'use client';

import { Badge } from '@/components/ui';
import type { BracketQuery, Participant } from '@/lib/types';

interface Props {
	query: BracketQuery;
	byId: Record<number, Participant>;
}

export function StandingsPanel({ query, byId }: Props) {
	const name = (id: number) => byId[id]?.name ?? `#${id}`;

	if (query.placements.length > 0) {
		return (
			<table className="stat-table">
				<thead>
					<tr>
						<th className="w-16">Place</th>
						<th>Participant</th>
						<th>Out</th>
					</tr>
				</thead>
				<tbody>
					{query.placements.map((p) => (
						<tr key={p.participant_id}>
							<td>
								{p.position === 1 ? (
									<Badge color="gold">{p.position_label}</Badge>
								) : (
									<span className="font-display font-semibold text-fog-300">{p.position_label}</span>
								)}
							</td>
							<td className="text-fog-100">{name(p.participant_id)}</td>
							<td className="text-fog-500">{p.eliminated_in || '—'}</td>
						</tr>
					))}
				</tbody>
			</table>
		);
	}

	if (query.standings.length > 0) {
		const tbKeys = Object.keys(query.standings[0].tiebreaker_scores);
		return (
			<table className="stat-table">
				<thead>
					<tr>
						<th className="w-10">#</th>
						<th>Participant</th>
						<th className="w-10">W</th>
						<th className="w-10">L</th>
						{tbKeys.map((k) => (
							<th key={k} title={k}>
								{shortTb(k)}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{query.standings.map((s) => (
						<tr key={s.participant_id}>
							<td className="font-mono text-fog-500">{s.rank}</td>
							<td className="text-fog-100">{name(s.participant_id)}</td>
							<td>{s.wins}</td>
							<td>{s.losses}</td>
							{tbKeys.map((k) => (
								<td key={k} className="font-mono text-fog-300">
									{formatScore(s.tiebreaker_scores[k])}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		);
	}

	return (
		<p className="px-4 py-6 text-center text-sm text-fog-500">
			Standings appear here for round-robin and Swiss formats.
		</p>
	);
}

function shortTb(key: string): string {
	const map: Record<string, string> = {
		win_count: 'Wins',
		buchholz: 'Buch',
		buchholz_truncated: 'Buch*',
		head_to_head: 'H2H'
	};
	return map[key] ?? key;
}

function formatScore(v: number): string {
	return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
