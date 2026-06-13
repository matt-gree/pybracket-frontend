'use client';

import { useEffect, type ReactNode } from 'react';

export function Modal({
	title,
	onClose,
	children
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
}) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [onClose]);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-night-950/70 p-4"
			role="dialog"
			aria-modal="true"
			onClick={onClose}
		>
			<div
				className="panel w-full max-w-md overflow-hidden"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between gap-3 border-b border-night-700 bg-night-850 px-4 py-2.5">
					<h2 className="font-display text-sm font-bold uppercase tracking-widest text-fog-300">
						{title}
					</h2>
					<button
						type="button"
						onClick={onClose}
						className="text-fog-500 hover:text-fog-100"
						aria-label="Close"
					>
						✕
					</button>
				</div>
				<div className="p-4">{children}</div>
			</div>
		</div>
	);
}

export function PageHeader({
	kicker,
	title,
	children
}: {
	kicker?: string;
	title: string;
	children?: ReactNode;
}) {
	return (
		<div className="mb-6 flex flex-wrap items-end justify-between gap-4">
			<div>
				{kicker && <p className="kicker">{kicker}</p>}
				<h1 className="mt-1 text-3xl uppercase sm:text-4xl">{title}</h1>
			</div>
			{children && <div className="flex items-center gap-3">{children}</div>}
		</div>
	);
}

export function Panel({ className = '', children }: { className?: string; children: ReactNode }) {
	return <div className={`panel ${className}`}>{children}</div>;
}

export function PanelHeader({ title, action }: { title: string; action?: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-3 border-b border-night-700 bg-night-850 px-4 py-2.5">
			<h2 className="font-display text-sm font-bold uppercase tracking-widest text-fog-300">{title}</h2>
			{action}
		</div>
	);
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
	return (
		<div className="flex flex-col items-center justify-center gap-3 py-12 text-fog-500" role="status">
			<div className="h-9 w-9 animate-spin rounded-full border-4 border-night-600 border-t-court-500" />
			<span className="text-sm">{label}</span>
		</div>
	);
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
	return (
		<div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
			<p className="font-display text-lg font-semibold uppercase tracking-wider text-fog-300">{title}</p>
			{detail && <p className="max-w-md text-sm text-fog-500">{detail}</p>}
		</div>
	);
}

export function ErrorState({ message }: { message: string }) {
	return (
		<div className="rounded-lg border border-rose-700 bg-rose-700/10 px-4 py-3 text-sm text-rose-300">
			{message}
		</div>
	);
}

const BADGE_COLORS = {
	court: 'bg-court-500/15 text-court-300 border-court-500/40',
	gold: 'bg-star-500/15 text-star-400 border-star-500/40',
	gray: 'bg-night-700/50 text-fog-300 border-night-600',
	green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
	rose: 'bg-rose-500/15 text-rose-300 border-rose-500/40'
} as const;

export function Badge({
	color = 'gray',
	children
}: {
	color?: keyof typeof BADGE_COLORS;
	children: ReactNode;
}) {
	return (
		<span
			className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-2 py-0.5 font-display text-[0.65rem] font-semibold uppercase tracking-wider ${BADGE_COLORS[color]}`}
		>
			{children}
		</span>
	);
}
