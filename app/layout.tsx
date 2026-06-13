import type { Metadata } from 'next';
import { Inter, Rajdhani } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const rajdhani = Rajdhani({
	subsets: ['latin'],
	weight: ['500', '600', '700'],
	variable: '--font-rajdhani'
});

export const metadata: Metadata = {
	title: {
		default: 'pybracket Studio',
		template: '%s | pybracket Studio'
	},
	description:
		'An in-browser studio for the pybracket tournament library. Generate single/double elimination, round robin, Swiss, and gauntlet brackets and watch how they are built — running the real Python library via Pyodide.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className={`${inter.variable} ${rajdhani.variable}`}>
			<body className="flex min-h-screen flex-col">
				<header className="border-b border-night-700 bg-night-900/60 backdrop-blur">
					<div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
						<div className="flex items-baseline gap-3">
							<span className="font-display text-xl font-bold uppercase tracking-wide text-fog-100">
								py<span className="text-court-400">bracket</span>
							</span>
							<span className="hidden font-display text-xs uppercase tracking-[0.25em] text-fog-500 sm:inline">
								Studio
							</span>
						</div>
						<a
							href="https://github.com/ProjectRio/pybracket"
							target="_blank"
							rel="noreferrer"
							className="font-display text-xs uppercase tracking-widest text-fog-500 transition-colors hover:text-court-300"
						>
							Library&nbsp;↗
						</a>
					</div>
				</header>
				<main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6">{children}</main>
				<footer className="border-t border-night-700 px-4 py-4 text-center text-xs text-fog-500">
					Runs the real <span className="text-fog-300">pybracket</span> Python library in your browser via
					Pyodide. No backend.
				</footer>
			</body>
		</html>
	);
}
