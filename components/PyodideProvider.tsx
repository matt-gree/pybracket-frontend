'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getEngine, type Engine, type LoadStage } from '@/lib/pyodide';

interface PyodideContextValue {
	engine: Engine | null;
	stage: LoadStage | null;
	error: string | null;
	retry: () => void;
}

const PyodideContext = createContext<PyodideContextValue | null>(null);

export function PyodideProvider({ children }: { children: ReactNode }) {
	const [engine, setEngine] = useState<Engine | null>(null);
	const [stage, setStage] = useState<LoadStage | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		let cancelled = false;
		setError(null);
		getEngine((s) => {
			if (!cancelled) setStage(s);
		})
			.then((e) => {
				if (!cancelled) setEngine(e);
			})
			.catch((err: unknown) => {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err));
			});
		return () => {
			cancelled = true;
		};
	}, [attempt]);

	const retry = useCallback(() => {
		setEngine(null);
		setStage(null);
		setAttempt((a) => a + 1);
	}, []);

	return (
		<PyodideContext.Provider value={{ engine, stage, error, retry }}>{children}</PyodideContext.Provider>
	);
}

export function usePyodide(): PyodideContextValue {
	const value = useContext(PyodideContext);
	if (!value) throw new Error('usePyodide must be used within a PyodideProvider.');
	return value;
}
