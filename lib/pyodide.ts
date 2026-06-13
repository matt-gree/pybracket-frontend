// Loads Pyodide from the CDN, installs the real pybracket wheel via micropip, and exposes a
// single `dispatch(action)` entry point backed by public/py/bridge.py. Memoised so the heavy
// runtime download happens exactly once per page load.

import type { DispatchResult } from './types';

const PYODIDE_VERSION = '0.27.7';
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const WHEEL_PATH = '/pybracket-0.1.0-py3-none-any.whl';
const BRIDGE_PATH = '/py/bridge.py';

export type LoadStage = 'runtime' | 'package' | 'bridge' | 'ready';

export const STAGE_LABEL: Record<LoadStage, string> = {
	runtime: 'Downloading Python runtime…',
	package: 'Installing pybracket…',
	bridge: 'Wiring up the library…',
	ready: 'Ready'
};

export interface Engine {
	dispatch(action: unknown): DispatchResult;
}

interface PyodideInterface {
	loadPackage(name: string): Promise<void>;
	pyimport(name: string): { install(url: string): Promise<void> };
	runPython(code: string): unknown;
	globals: { get(name: string): (arg: string) => string };
}

declare global {
	interface Window {
		loadPyodide?: (config: { indexURL: string }) => Promise<PyodideInterface>;
	}
}

let enginePromise: Promise<Engine> | null = null;

export function getEngine(onStage?: (stage: LoadStage) => void): Promise<Engine> {
	if (!enginePromise) {
		enginePromise = loadEngine(onStage).catch((err) => {
			// Allow a later retry if the first attempt failed (e.g. offline CDN).
			enginePromise = null;
			throw err;
		});
	}
	return enginePromise;
}

async function loadEngine(onStage?: (stage: LoadStage) => void): Promise<Engine> {
	onStage?.('runtime');
	await injectScript(`${PYODIDE_INDEX}pyodide.js`, 'pyodide-cdn');
	if (!window.loadPyodide) throw new Error('Pyodide runtime did not register window.loadPyodide.');
	const pyodide = await window.loadPyodide({ indexURL: PYODIDE_INDEX });

	onStage?.('package');
	await pyodide.loadPackage('micropip');
	const micropip = pyodide.pyimport('micropip');
	const wheelUrl = new URL(WHEEL_PATH, window.location.origin).toString();
	await micropip.install(wheelUrl);

	onStage?.('bridge');
	const bridgeSource = await fetchText(BRIDGE_PATH);
	pyodide.runPython(bridgeSource);
	const dispatchFn = pyodide.globals.get('dispatch');

	onStage?.('ready');
	return {
		dispatch(action: unknown): DispatchResult {
			const raw = dispatchFn(JSON.stringify(action));
			return JSON.parse(raw) as DispatchResult;
		}
	};
}

function injectScript(src: string, id: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const existing = document.getElementById(id) as HTMLScriptElement | null;
		if (existing) {
			if (existing.dataset.loaded === 'true') resolve();
			else {
				existing.addEventListener('load', () => resolve());
				existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
			}
			return;
		}
		const script = document.createElement('script');
		script.id = id;
		script.src = src;
		script.async = true;
		script.addEventListener('load', () => {
			script.dataset.loaded = 'true';
			resolve();
		});
		script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
		document.head.appendChild(script);
	});
}

async function fetchText(path: string): Promise<string> {
	const res = await fetch(path);
	if (!res.ok) throw new Error(`Failed to fetch ${path} (${res.status})`);
	return res.text();
}
