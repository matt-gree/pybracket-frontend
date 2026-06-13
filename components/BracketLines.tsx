'use client';

// Elbow connector lines between a match and the matches that feed it (spec §7). One SVG covers
// the whole side. Lines route from the centre-right of each feeder to the centre-left of its
// target. Byes are hidden but still connected through their phantom coordinates; connectors
// touching a NOT_NEEDED match are dimmed to match the dimmed card.

import { CARD_WIDTH, type SideLayout } from '@/lib/layout';

interface Props {
	layout: SideLayout;
	dimmed: Set<number>;
}

export function BracketLines({ layout, dimmed }: Props) {
	const { positions, links, width, height } = layout;

	return (
		<svg
			className="pointer-events-none absolute inset-0"
			width={width}
			height={height}
			aria-hidden="true"
		>
			{links.map(({ from, to }) => {
				const a = positions.get(from);
				const b = positions.get(to);
				if (!a || !b) return null;
				const x1 = a.x + CARD_WIDTH;
				const y1 = a.y;
				const x2 = b.x;
				const y2 = b.y;
				const midX = (x1 + x2) / 2;
				const faded = dimmed.has(from) || dimmed.has(to);
				return (
					<polyline
						key={`${from}-${to}`}
						points={`${x1},${y1} ${midX},${y1} ${midX},${y2} ${x2},${y2}`}
						fill="none"
						stroke="currentColor"
						strokeWidth={1.5}
						className={faded ? 'text-night-700/40' : 'text-night-600'}
					/>
				);
			})}
		</svg>
	);
}
