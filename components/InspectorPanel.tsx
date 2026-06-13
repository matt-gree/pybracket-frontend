'use client';

import { useMemo, useState } from 'react';
import type { Bracket } from '@/lib/types';

export function InspectorPanel({ bracket }: { bracket: Bracket }) {
	const [copied, setCopied] = useState(false);
	const json = useMemo(() => JSON.stringify(bracket, null, 2), [bracket]);

	async function copy() {
		try {
			await navigator.clipboard.writeText(json);
			setCopied(true);
			setTimeout(() => setCopied(false), 1200);
		} catch {
			// clipboard may be unavailable; ignore.
		}
	}

	return (
		<div>
			<div className="flex items-center justify-between gap-3 border-b border-night-700 bg-night-850 px-4 py-2.5">
				<h2 className="font-display text-sm font-bold uppercase tracking-widest text-fog-300">
					Bracket JSON
				</h2>
				<button
					type="button"
					onClick={copy}
					className="font-display text-[0.65rem] uppercase tracking-widest text-court-400 hover:text-court-300"
				>
					{copied ? 'Copied' : 'Copy'}
				</button>
			</div>
			<pre className="max-h-[28rem] overflow-auto px-4 py-3 font-mono text-[0.7rem] leading-relaxed text-fog-300">
				{json}
			</pre>
		</div>
	);
}
